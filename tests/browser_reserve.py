"""Isolated Quark 1.5 reserve-card interaction and regression tests.

    python -B tests/browser_reserve.py --app-dir .qa/v150/candidate --output-dir .qa/v150/browser

Mobile profiles use touch; the desktop profile uses mouse/keyboard. Every case
records whether a game state was injected, and runs against a hashed HTML file.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import traceback
from pathlib import Path
from playwright.sync_api import sync_playwright
from browser_extended import create_room, enter_shop, open_lobby, start_server
from browser_smoke import (ROOT, activate, assert_reachable, assert_viewport, center_hit, context_for,
                           read_number, reload_and_resume, require, screenshot,
                           start_blind, swipe_up_within, touch_at, watch_page,
                           score_unmodified_hand, cards_on_screen, play_best_first_blind)

if hasattr(sys.stdout, 'reconfigure'):sys.stdout.reconfigure(errors='backslashreplace')
PROFILES={'small':{'width':320,'height':568,'mobile':True},
          'portrait':{'width':390,'height':844,'mobile':True},
          'landscape':{'width':640,'height':360,'mobile':True},
          'desktop':{'width':1280,'height':720,'mobile':False}}


def fresh(browser,seed,spec):
    context=context_for(browser,spec,seed);page=context.new_page()
    return context,page,watch_page(page)


def press(locator,mobile):activate(locator,mobile)


def open_reserve(page,mobile):
    button=page.locator('#reserveBtn');assert_reachable(button,'reserve button');press(button,mobile)
    page.locator('#ovReserve').wait_for(state='visible')


def state(page):
    return page.evaluate("""() => ({screen:S.screen,reserve:{...S.reserve},hand:S.hand.map(c=>c.id),
      draw:S.drawPile.map(c=>c.id),deck:S.deckAll.map(c=>c.id),money:S.money,hands:S.handsLeft,
      discard:S.discLeft,score:S.score,rhythm:{...S.rhythm},contract:S.contract})""")


def double_at(page,locator,mobile):
    box=locator.bounding_box();require(box,'control has no bounding box')
    x=box['x']+box['width']/2;y=box['y']+box['height']/2
    if mobile:touch_at(page,x,y);touch_at(page,x,y)
    else:page.mouse.click(x,y);page.mouse.click(x,y)


def reserve_geometry(page):
    return page.evaluate("""() => {
      const rect=el=>{const r=el.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,
        width:r.width,height:r.height,text:el.innerText,scrollHeight:el.scrollHeight,clientHeight:el.clientHeight}};
      const reach=el=>{const r=el.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
        const hit=x>=0&&x<innerWidth&&y>=0&&y<innerHeight?document.elementFromPoint(x,y):null;
        return !!hit&&(hit===el||el.contains(hit));};
      return {box:rect(document.querySelector('#ovReserve .box')),hand:rect(document.querySelector('#reserveHand')),
        pocket:rect(document.querySelector('#reservePocket')),preview:rect(document.querySelector('#reservePreview')),
        cancel:rect(document.querySelector('.reserveActions button:first-child')),confirm:rect(document.querySelector('#reserveConfirm')),
        cancelHit:reach(document.querySelector('.reserveActions button:first-child')),
        confirmHit:reach(document.querySelector('#reserveConfirm'))};
    }""")


def reserve_flow(browser,url,out,seed,profile):
    spec=PROFILES[profile];mobile=spec['mobile'];context,page,errors=fresh(browser,seed,spec);issues=[]
    try:
        page.goto(url,wait_until='domcontentloaded');start_blind(page,mobile);assert_viewport(page,spec['width'])
        initial=state(page);screenshot(page,out,f'{profile}-table')
        open_reserve(page,mobile)
        geometry=reserve_geometry(page)
        screenshot(page,out,f'{profile}-picker-empty')
        require(page.locator('#reserveConfirm').is_disabled(),'reserve confirm enabled before selection')
        for name in ('cancel','confirm'):
            r=geometry[name]
            if r['left']<0 or r['top']<0 or r['right']>spec['width'] or r['bottom']>spec['height'] or not geometry[name+'Hit']:
                issues.append({'requirement':'fixed reserve controls visible and touchable','name':name,'geometry':geometry})
        press(page.locator('#ovReserve button[onclick="closeReserve()"]'),mobile)
        page.locator('#ovReserve').wait_for(state='hidden')
        if state(page)!=initial:issues.append({'requirement':'cancel leaves state intact','before':initial,'after':state(page)})
        page.wait_for_timeout(400);open_reserve(page,mobile)
        selected_id=int(page.locator('#reserveHand .card').first.get_attribute('data-card-id'))
        press(page.locator('#reserveHand .card').first,mobile)
        screenshot(page,out,f'{profile}-picker-selected')
        require(page.locator('#reserveConfirm').is_enabled(),'reserve selection did not enable confirm')
        double_at(page,page.locator('#reserveConfirm'),mobile)
        page.locator('#ovReserve').wait_for(state='hidden')
        stored=state(page);expected_draw=initial['draw'][:-1]
        if (stored['reserve']!={'cardId':selected_id,'used':False} or
            set(stored['hand'])!=set(initial['hand'])-{selected_id}|{initial['draw'][-1]} or stored['draw']!=expected_draw or
            any(stored[k]!=initial[k] for k in ('money','hands','discard','score','rhythm','contract','deck'))):
            issues.append({'requirement':'store and replace exactly one card without advancing resources','initial':initial,'stored':stored})
        screenshot(page,out,f'{profile}-stored')
        reload_and_resume(page,mobile,'#handRow .card')
        reloaded=state(page)
        if reloaded!=stored:issues.append({'requirement':'stored card survives reload','before':stored,'after':reloaded})
        page.wait_for_timeout(400);open_reserve(page,mobile)
        pocket=page.locator('#reservePocket .card')
        require(pocket.count()==1,'stored card missing from pocket')
        replacement_id=int(page.locator('#reserveHand .card').first.get_attribute('data-card-id'))
        press(page.locator('#reserveHand .card').first,mobile)
        screenshot(page,out,f'{profile}-retrieve-selected')
        double_at(page,page.locator('#reserveConfirm'),mobile)
        page.locator('#ovReserve').wait_for(state='hidden');swapped=state(page)
        if (swapped['reserve']!={'cardId':None,'used':True} or selected_id not in swapped['hand'] or
            replacement_id in swapped['hand'] or replacement_id in swapped['draw'] or
            any(swapped[k]!=stored[k] for k in ('money','hands','discard','score','rhythm','contract','deck'))):
            issues.append({'requirement':'retrieve exactly once without advancing resources','stored':stored,'swapped':swapped,'replaced':replacement_id})
        reload_and_resume(page,mobile,'#handRow .card')
        resumed=state(page)
        if resumed!=swapped or not page.locator('#reserveBtn').is_disabled():
            issues.append({'requirement':'used state survives reload','before':swapped,'after':resumed,'disabled':page.locator('#reserveBtn').is_disabled()})
        screenshot(page,out,f'{profile}-used-resumed')
        require(not errors,f'page errors: {errors}')
        return {'status':'failed' if issues else 'passed','fixture':'normal new game; actual touch/mouse inputs and actual reload',
                'geometry':geometry,'initial':initial,'selected_id':selected_id,'stored':stored,'reloaded':reloaded,
                'replacement_id':replacement_id,'swapped':swapped,'resumed':resumed,'issues':issues,'page_errors':errors}
    except Exception:
        try:screenshot(page,out,f'{profile}-failure')
        except Exception:pass
        raise
    finally:context.close()


def dense_reserve(browser,url,out,seed,profile):
    spec=PROFILES[profile];mobile=spec['mobile'];context,page,errors=fresh(browser,seed,spec);issues=[]
    try:
        page.goto(url,wait_until='domcontentloaded');start_blind(page,mobile)
        fixture=page.evaluate("""() => {
          S.handSize=10;while(S.hand.length<10)S.hand.push(S.drawPile.pop());
          const c=S.hand[0];Object.assign(c,{bonus:30,multB:4,wild:true,steel:true,ed:3,seal:'red'});
          S.jokerSlots=6;S.jokers=[];JDEFS.slice(0,6).forEach(addJoker);
          S.consSlots=3;S.cons=TAROTS.slice(0,3).map(t=>({...t,kind:'tarot',price:3}));
          S.blindIdx=2;S.boss=BOSSES.find(b=>b.id==='hook');S.anteBoss=S.boss;
          S.rhythmMode='focus';S.rhythm={lastKey:'pair',chain:3};
          S.contract={id:'variety',discards:0,settled:false};S.blindPlayed=['high','pair'];
          S.target=99999999;S.score=12345678;renderAll();persistRun();
          return {id:c.id,card:{...c},hand:S.hand.length,jokers:S.jokers.length,cons:S.cons.length};
        }""")
        assert_viewport(page,spec['width']);screenshot(page,out,f'dense-{profile}-table')
        data=page.evaluate("""() => {
          const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
          const hit=e=>{const r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
            const h=x>=0&&x<innerWidth&&y>=0&&y<innerHeight?document.elementFromPoint(x,y):null;return !!h&&(h===e||e.contains(h));};
          return Object.fromEntries(['#bossDesc','#tacticsStatus','#reserveBtn','#handRow','#btnPlay','#btnDiscard','#targetVal','#scoreVal'].map(s=>[s,{...rect(document.querySelector(s)),hit:hit(document.querySelector(s))}]));
        }""")
        boss,tactics=data['#bossDesc'],data['#tacticsStatus']
        overlap=max(0,min(boss['right'],tactics['right'])-max(boss['left'],tactics['left']))*max(0,min(boss['bottom'],tactics['bottom'])-max(boss['top'],tactics['top']))
        if overlap>1:issues.append({'requirement':'boss and tactics text do not overlap','area':overlap,'geometry':data})
        for selector in ('#reserveBtn','#btnPlay','#btnDiscard'):
            r=data[selector]
            if r['left']<0 or r['top']<0 or r['right']>spec['width'] or r['bottom']>spec['height'] or not r['hit']:
                issues.append({'requirement':'dense table controls remain visible and reachable','element':selector,'rect':r})
        open_reserve(page,mobile)
        require(page.locator('#reserveHand .card').count()==10,'ten-card hand did not display ten candidates')
        first=page.locator(f'#reserveHand .card[data-card-id="{fixture["id"]}"]');press(first,mobile)
        preview=page.locator('#reservePreview').inner_text()
        for word in ('百搭花色','点数不变','奖励','倍率','钢铁','多彩','红蜡封'):
            if word not in preview:issues.append({'requirement':'all enhancements appear in selection detail','missing':word,'preview':preview})
        geom_before=reserve_geometry(page);screenshot(page,out,f'dense-{profile}-picker-top')
        last=page.locator('#reserveHand .card').last
        swipes=0
        if mobile:
            while not center_hit(last)['visible'] and swipes<10:
                swipe_up_within(page,page.locator('#reserveHand'));swipes+=1
        else:last.scroll_into_view_if_needed()
        if not center_hit(last)['visible']:issues.append({'requirement':'last of ten cards is reachable by scrolling','swipes':swipes})
        geom_after=reserve_geometry(page)
        for name in ('cancel','confirm'):
            if abs(geom_before[name]['top']-geom_after[name]['top'])>1 or not geom_after[name+'Hit']:
                issues.append({'requirement':'actions remain fixed while the hand scrolls','name':name,'before':geom_before[name],'after':geom_after[name]})
        screenshot(page,out,f'dense-{profile}-picker-scrolled')
        preview_el=page.locator('#reservePreview')
        scroll=preview_el.evaluate('el=>({max:el.scrollHeight-el.clientHeight,top:el.scrollTop})')
        if mobile and scroll['max']>1:
            for _ in range(4):swipe_up_within(page,preview_el)
            if preview_el.evaluate('el=>el.scrollTop')<scroll['max']-2:
                issues.append({'requirement':'full enhancement text scrolls into view','scroll':scroll,'after':preview_el.evaluate('el=>el.scrollTop')})
        press(page.locator('#reserveConfirm'),mobile);page.locator('#ovReserve').wait_for(state='hidden')
        retained=page.evaluate("id => ({reserve:S.reserve.cardId,card:{...S.deckAll.find(c=>c.id===id)}})",fixture['id'])
        for k in ('id','rank','suit','bonus','multB','wild','steel','ed','seal'):
            if retained['card'].get(k)!=fixture['card'].get(k):issues.append({'requirement':'stored card keeps enhancements','field':k})
        page.wait_for_timeout(400);open_reserve(page,mobile)
        pocket=page.locator('#reservePocket').inner_text()
        for word in ('百搭花色','倍率','钢铁','多彩','红蜡封'):
            if word not in pocket:issues.append({'requirement':'stored card detail includes all enhancements','missing':word,'pocket':pocket})
        screenshot(page,out,f'dense-{profile}-pocket')
        press(page.locator('#reserveHand .card').first,mobile)
        press(page.locator('#reserveConfirm'),mobile);page.locator('#ovReserve').wait_for(state='hidden')
        restored=page.evaluate("""id => ({reserve:{...S.reserve},hand:S.hand.map(c=>c.id),
          card:{...S.deckAll.find(c=>c.id===id)}})""",fixture['id'])
        if restored['reserve']!={'cardId':None,'used':True} or fixture['id'] not in restored['hand']:
            issues.append({'requirement':'enhanced pocket returns to hand once','restored':restored})
        for k in ('id','rank','suit','bonus','multB','wild','steel','ed','seal'):
            if restored['card'].get(k)!=fixture['card'].get(k):issues.append({'requirement':'retrieved card keeps enhancements','field':k})
        reload_and_resume(page,mobile,'#handRow .card')
        resumed=page.evaluate("""id => ({reserve:{...S.reserve},hand:S.hand.map(c=>c.id),
          card:{...S.deckAll.find(c=>c.id===id)}})""",fixture['id'])
        if resumed!=restored:issues.append({'requirement':'retrieved enhanced card survives reload','before':restored,'after':resumed})
        require(not errors,f'page errors: {errors}')
        return {'status':'failed' if issues else 'passed','fixture':'normal first blind; 10-card hand, full six jokers/three consumables, enhanced card, boss/tactics and high scores directly assigned; touch/mouse thereafter',
                'loadout':fixture,'table_geometry':data,'picker_before':geom_before,'picker_after':geom_after,
                'hand_swipes':swipes,'preview':preview,'stored':retained,'pocket':pocket,'restored':restored,'resumed':resumed,'issues':issues,'page_errors':errors}
    except Exception:
        try:screenshot(page,out,f'dense-{profile}-failure')
        except Exception:pass
        raise
    finally:context.close()


def empty_deck(browser,url,out,seed):
    issues=[];results=[];all_errors=[]
    for stored_first in (False,True):
        context,page,errors=fresh(browser,seed,PROFILES['portrait'])
        try:
            page.goto(url,wait_until='domcontentloaded');start_blind(page,True)
            if stored_first:
                open_reserve(page,True);page.locator('#reserveHand .card').first.tap();page.locator('#reserveConfirm').tap()
                page.locator('#ovReserve').wait_for(state='hidden');page.wait_for_timeout(400)
            page.evaluate('() => {S.drawPile=[];renderAll();persistRun();}')
            info=state(page);button=page.locator('#reserveBtn');enabled=button.is_enabled();label=button.inner_text()
            screenshot(page,out,'empty-deck-'+('stored' if stored_first else 'no-pocket'))
            if enabled!=stored_first:
                issues.append({'requirement':'empty deck disables store but allows existing pocket retrieval','stored_first':stored_first,'enabled':enabled,'label':label})
            if stored_first:
                open_reserve(page,True);page.locator('#reserveHand .card').first.tap();page.locator('#reserveConfirm').tap()
                page.locator('#ovReserve').wait_for(state='hidden');after=state(page)
                if after['reserve']!={'cardId':None,'used':True} or info['reserve']['cardId'] not in after['hand']:
                    issues.append({'requirement':'empty-deck pocket can be retrieved','before':info,'after':after})
            else:after=info
            require(not errors,f'page errors: {errors}');all_errors.extend(errors)
            results.append({'stored_first':stored_first,'label':label,'enabled':enabled,'before':info,'after':after})
        finally:context.close()
    return {'status':'failed' if issues else 'passed','fixture':'normal first blind; draw pile directly set empty; actual reserve touches',
            'cases':results,'issues':issues,'page_errors':all_errors}


def scoring_visibility(browser,url,out,seed):
    context,page,errors=fresh(browser,seed,PROFILES['portrait']);issues=[]
    try:
        page.goto(url,wait_until='domcontentloaded');start_blind(page,True)
        open_reserve(page,True);page.locator('#reserveHand .card').first.tap();page.locator('#reserveConfirm').tap()
        page.locator('#ovReserve').wait_for(state='hidden');page.wait_for_timeout(400)
        cards=cards_on_screen(page);expected=score_unmodified_hand([cards[0]])[0]
        page.locator('#handRow .card').first.tap();preview=read_number(page,'#scoreEstimate')
        page.locator('#btnPlay').tap();page.wait_for_function('() => S && S.busy',timeout=5000)
        during=page.evaluate("() => ({busy:S.busy,buttonVisibility:getComputedStyle(document.querySelector('#reserveBtn')).visibility})")
        screenshot(page,out,'scoring-reserve-hidden')
        page.wait_for_function('() => S && !S.busy && S.score>0',timeout=20000)
        score=read_number(page,'#scoreVal')
        if during['buttonVisibility']!='hidden' or not during['busy']:
            issues.append({'requirement':'reserve entry yields during scoring','during':during})
        if preview!=expected or score!=expected:
            issues.append({'requirement':'independent selected card scoring still matches','expected':expected,'preview':preview,'score':score})
        require(not errors,f'page errors: {errors}')
        return {'status':'failed' if issues else 'passed','fixture':'normal first blind, actual reserve and score by touch',
                'cards':cards,'expected':expected,'preview':preview,'during':during,'score':score,'issues':issues,'page_errors':errors}
    finally:context.close()


def next_blind_reset(browser,url,out,seed):
    context,page,errors=fresh(browser,seed,PROFILES['portrait']);issues=[]
    try:
        page.goto(url,wait_until='domcontentloaded');start_blind(page,True)
        open_reserve(page,True);page.locator('#reserveHand .card').first.tap();page.locator('#reserveConfirm').tap()
        page.locator('#ovReserve').wait_for(state='hidden');page.wait_for_timeout(400)
        open_reserve(page,True);page.locator('#reserveHand .card').first.tap();page.locator('#reserveConfirm').tap()
        page.locator('#ovReserve').wait_for(state='hidden');page.wait_for_timeout(400)
        previous=state(page);plays=[]
        for _ in range(4):
            plays.append(play_best_first_blind(page,True))
            if page.locator('#ovCash').is_visible():break
            require(not page.locator('#ovOver').is_visible(),'normal first blind was lost')
        page.locator('#ovCash').wait_for(state='visible',timeout=10000)
        page.locator('#ovCash button').filter(has_text='前往商店').tap()
        page.locator('#ovShop button[onclick="leaveShop()"]',).tap()
        page.locator('#blindCols .cur .bbtn:not(.skip)').tap();page.locator('#handRow .card').first.wait_for(state='visible')
        next_state=state(page)
        if next_state['reserve']!={'cardId':None,'used':False} or next_state['deck']!=previous['deck'] or not page.locator('#reserveBtn').is_enabled():
            issues.append({'requirement':'next blind resets reserve and restores full deck','previous':previous,'next':next_state})
        screenshot(page,out,'next-blind-reserve-reset')
        require(not errors,f'page errors: {errors}')
        return {'status':'failed' if issues else 'passed','fixture':'normal seeded first blind, reserve store/retrieve, normal play to shop then next blind by touch',
                'plays':plays,'previous':previous,'next':next_state,'issues':issues,'page_errors':errors}
    finally:context.close()


def reserve_keyboard(browser,url,out,seed):
    context,page,errors=fresh(browser,seed,PROFILES['portrait']);issues=[]
    try:
        page.goto(url,wait_until='domcontentloaded');start_blind(page,True)
        page.locator('#handRow .card').first.tap()
        selected=page.locator('#handRow .card').first.get_attribute('data-card-id')
        before=state(page);open_reserve(page,True)
        if page.locator(f'#reserveHand .card[data-card-id="{selected}"]').get_attribute('aria-pressed')!='true':
            issues.append({'requirement':'one preselected table card appears selected in reserve'})
        trace=[]
        for _ in range(15):
            page.keyboard.press('Tab')
            item=page.evaluate("() => ({id:document.activeElement.id,within:!!document.activeElement.closest('#ovReserve')})")
            trace.append(item)
            if not item['within']:issues.append({'requirement':'Tab stays in reserve dialog','active':item})
        page.keyboard.press('Escape');page.locator('#ovReserve').wait_for(state='hidden')
        after=state(page)
        if after!=before:issues.append({'requirement':'Escape cancels without changing game state','before':before,'after':after})
        if page.locator(f'#handRow .card[data-card-id="{selected}"]').get_attribute('aria-pressed')!='true':
            issues.append({'requirement':'cancel keeps original table selection'})
        page.wait_for_timeout(400);open_reserve(page,True)
        cancel=page.locator('#ovReserve button[onclick="closeReserve()"]')
        double_at(page,cancel,True);page.locator('#ovReserve').wait_for(state='hidden')
        if state(page)!=before:issues.append({'requirement':'double cancel does not activate underlying control','before':before,'after':state(page)})
        screenshot(page,out,'keyboard-cancel')
        require(not errors,f'page errors: {errors}')
        return {'status':'failed' if issues else 'passed','fixture':'normal first blind, real selection, 15 Tab presses, Escape and real double tap cancel',
                'before':before,'after':after,'focus_trace':trace,'issues':issues,'page_errors':errors}
    finally:context.close()


def sort_deck_tutorial(browser,url,out,seed):
    context,page,errors=fresh(browser,seed,PROFILES['portrait']);issues=[]
    try:
        page.goto(url,wait_until='domcontentloaded');start_blind(page,True)
        page.locator('#btnSortSuit').tap()
        if page.locator('#btnSortSuit').get_attribute('aria-pressed')!='true' or page.locator('#btnSortRank').get_attribute('aria-pressed')!='false':
            issues.append({'requirement':'sort selection is reflected in controls'})
        reload_and_resume(page,True,'#handRow .card')
        sort=page.evaluate('() => ({mode:S.sortMode,rank:document.querySelector("#btnSortRank").getAttribute("aria-pressed"),suit:document.querySelector("#btnSortSuit").getAttribute("aria-pressed")})')
        if sort!={'mode':'suit','rank':'false','suit':'true'}:issues.append({'requirement':'sort persists after refresh','actual':sort})
        open_reserve(page,True);page.locator('#reserveHand .card').first.tap();page.locator('#reserveConfirm').tap()
        page.locator('#ovReserve').wait_for(state='hidden');page.wait_for_timeout(400)
        removed=page.evaluate("""() => {
          const c=S.drawPile.pop();S.deckAll=S.deckAll.filter(x=>x!==c);renderAll();persistRun();
          return {rank:c.rank,suit:c.suit,id:c.id};
        }""")
        page.locator('#menuBtn').tap()
        page.locator('#ovMenu button').filter(has_text='查看剩余牌库').tap()
        page.locator('#ovDeck').wait_for(state='visible')
        deck=page.evaluate("() => ({summary:document.querySelector('#deckSummary').innerText,absent:document.querySelectorAll('#deckGrid .absent').length,reserved:document.querySelectorAll('#deckGrid .reserved').length})")
        screenshot(page,out,'deck-absent-and-reserved')
        if '底牌' not in deck['summary'] or deck['absent']<1 or deck['reserved']<1:
            issues.append({'requirement':'deck distinguishes absent card and reserved card','data':deck})
        page.locator('#ovDeck button').filter(has_text='关闭').tap();page.locator('#menuBtn').tap()
        page.locator('#ovMenu button').filter(has_text='新手教程').tap();page.locator('#tutBox').wait_for(state='visible')
        for _ in range(20):
            if page.locator('#tutTitle').inner_text()=='底牌与主动构筑':break
            page.locator('#tutNext').tap()
        title=page.locator('#tutTitle').inner_text();body=page.locator('#tutBody').inner_text()
        screenshot(page,out,'tutorial-reserve')
        for word in ('袖中底牌','换回','底牌不触发留手效果','不耗弃牌次数','工坊','悬赏'):
            if word not in body:issues.append({'requirement':'tutorial explains current reserve/buildcraft rules','missing':word,'body':body})
        if title!='底牌与主动构筑':issues.append({'requirement':'reserve tutorial step reached','title':title})
        page.locator('#tutBox button').filter(has_text='跳过').tap()
        require(not errors,f'page errors: {errors}')
        return {'status':'failed' if issues else 'passed','fixture':'normal first blind and actual UI, one drawn-pile card removed directly for deck absence display',
                'sort':sort,'removed':removed,'deck':deck,'tutorial_title':title,'tutorial_body':body,'issues':issues,'page_errors':errors}
    finally:context.close()


def shop_regression(browser,url,out,seed):
    context,page,errors=fresh(browser,seed,PROFILES['portrait']);issues=[]
    try:
        plays=enter_shop(page,url,True)
        page.evaluate("""() => {S.jokers=[];addJoker(JDEFS.find(j=>j.id==='joker'));
          S.cons=[{...TAROTS.find(t=>t.id==='magician'),kind:'tarot',price:3}];
          S.workshopCredits=2;renderShop();persistRun();}""")
        tab_results=[]
        for tab in ('Cards','Cons','Packs','Voucher','Workshop'):
            b=page.locator('#shopTab'+tab);assert_reachable(b,'shop '+tab);b.tap()
            tab_results.append({'tab':tab,'selected':b.get_attribute('aria-selected'),'label':b.inner_text()})
            if tab_results[-1]['selected']!='true':issues.append({'requirement':'shop tab selectable','tab':tab})
        status=page.locator('#shopWorkshop .workshopStatus').inner_text()
        screenshot(page,out,'shop-workshop-credits')
        if '2' not in status or '免费' not in status:issues.append({'requirement':'remaining free workshop credits visible','text':status})
        for kind in ('joker','cons'):
            item=page.locator(f"#shopOwned .ownedItem[data-kind='{kind}']").first;item.tap()
            page.locator('#ovOwned').wait_for(state='visible')
            screenshot(page,out,'shop-owned-'+kind)
            page.locator('#ovOwned button[onclick="hide(\'ovOwned\')"]').tap()
            page.locator('#ovOwned').wait_for(state='hidden')
            page.wait_for_timeout(400)
        before=page.evaluate('() => ({money:S.money,jokers:S.jokers.length,cons:S.cons.length,credits:S.workshopCredits})')
        page.locator('#shopTabPacks').tap()
        pack=page.locator('#shopPacks .shopItem').first;pack.tap();page.locator('#ovPack').wait_for(state='visible')
        options=page.evaluate('() => JSON.stringify(S.pack.options)')
        screenshot(page,out,'shop-pack-open')
        page.locator('#ovPack button[onclick="closePack()"]',).tap();page.locator('#ovPack').wait_for(state='hidden')
        after=page.evaluate('() => ({money:S.money,jokers:S.jokers.length,cons:S.cons.length,credits:S.workshopCredits})')
        if after!=before:issues.append({'requirement':'cancel pack refunds and keeps inventory','before':before,'after':after})
        page.wait_for_timeout(400)
        page.locator('#shopPacks .shopItem').first.tap();page.locator('#ovPack').wait_for(state='visible')
        if page.evaluate('() => JSON.stringify(S.pack.options)')!=options:
            issues.append({'requirement':'cancelled pack retains candidate choices'})
        require(not errors,f'page errors: {errors}')
        return {'status':'failed' if issues else 'passed','fixture':'normal first blind/shop; one owned joker, one tarot and two workshop credits assigned; all controls touched',
                'plays':plays,'tabs':tab_results,'workshop_status':status,'before':before,'after':after,'issues':issues,'page_errors':errors}
    finally:context.close()


def ordinary_small(browser,url,out,seed):
    context,page,errors=fresh(browser,seed,PROFILES['small']);issues=[]
    try:
        page.goto(url,wait_until='domcontentloaded');start_blind(page,True)
        cards=cards_on_screen(page);first=cards[0];expected=score_unmodified_hand([first])[0]
        geometry=page.locator('#handRow .card').evaluate_all("""cards=>cards.map(c=>{
          const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
          const rank=c.querySelector('.rk'),suit=c.querySelector('.st2 .suitIcon');
          return {card:rect(c),rank:rect(rank),suit:rect(suit),rankFont:parseFloat(getComputedStyle(rank).fontSize),label:c.getAttribute('aria-label')};
        })""")
        for card in geometry:
            outer=card['card']
            for name in ('rank','suit'):
                r=card[name]
                if r['width']<=0 or r['height']<=0 or r['left']<outer['left']-1 or r['right']>outer['right']+1 or r['top']<outer['top']-1 or r['bottom']>outer['bottom']+1:
                    issues.append({'requirement':'rank and top-corner suit fit the card','card':card,'part':name})
            if card['rankFont']<10:issues.append({'requirement':'small card rank is readable','card':card})
        screenshot(page,out,'ordinary-small-table')
        page.locator('#handRow .card').first.tap()
        btn=page.locator('#btnPlay');assert_reachable(btn,'play after card selection')
        preview=read_number(page,'#scoreEstimate');btn.tap()
        page.wait_for_function('() => S && !S.busy && S.score>0',timeout=20000)
        actual=read_number(page,'#scoreVal')
        if preview!=expected or actual!=expected:issues.append({'requirement':'ordinary selected card preview and play','expected':expected,'preview':preview,'actual':actual})
        screenshot(page,out,'ordinary-small-scored')
        require(not errors,f'page errors: {errors}')
        return {'status':'failed' if issues else 'passed','fixture':'normal seeded first blind, real select and play by touch',
                'cards':cards,'geometry':geometry,'expected':expected,'preview':preview,'actual':actual,'issues':issues,'page_errors':errors}
    finally:context.close()


def tutorial_info(browser,url,out,seed):
    context,page,errors=fresh(browser,seed,PROFILES['portrait']);issues=[]
    try:
        page.goto(url,wait_until='domcontentloaded');start_blind(page,True)
        page.evaluate("""() => {S.handSize=10;S.jokerSlots=6;S.baseHands=5;S.baseDisc=3;
          S.workshopCredits=2;S.rhythmMode='focus';renderAll();}""")
        page.locator('#menuBtn').tap();page.locator('#ovMenu button').filter(has_text='本局信息').tap()
        page.locator('#ovInfo').wait_for(state='visible');info=page.locator('#infoBody').inner_text()
        screenshot(page,out,'info-dynamic')
        for pattern in (r'手牌上限\s*10',r'工坊免费次数\s*2',r'出牌节奏\s*专注',r'出牌/盲注\s*5',r'弃牌/盲注\s*3'):
            if not re.search(pattern,info):issues.append({'requirement':'run information reflects active state','pattern':pattern,'text':info})
        page.locator('#ovInfo button').filter(has_text='关闭').tap();page.locator('#menuBtn').tap()
        page.locator('#ovMenu button').filter(has_text='新手教程').tap();page.locator('#tutBox').wait_for(state='visible')
        found={}
        for _ in range(20):
            title=page.locator('#tutTitle').inner_text();body=page.locator('#tutBody').inner_text()
            if '你的手牌' in title:found['hand']=body;screenshot(page,out,'tutorial-dynamic-hand')
            if '出牌与弃牌' in title:found['turns']=body
            if '小丑牌' in title:found['slots']=body;screenshot(page,out,'tutorial-dynamic-slots')
            if title=='底牌与主动构筑':found['reserve']=body;break
            page.locator('#tutNext').tap()
        for key,patterns in {'hand':(r'10\s*张牌',),'turns':(r'5\s*次',r'3\s*次'),
                             'slots':(r'6\s*个槽位',),'reserve':('袖中底牌','换回','不触发留手效果')}.items():
            for pattern in patterns:
                if not re.search(pattern,found.get(key,'')):issues.append({'requirement':'tutorial reflects active state or reserve rules','section':key,'pattern':pattern,'body':found.get(key)})
        screenshot(page,out,'tutorial-dynamic-reserve')
        page.locator('#tutBox button').filter(has_text='跳过').tap()
        require(not errors,f'page errors: {errors}')
        return {'status':'failed' if issues else 'passed','fixture':'normal first blind; hand limit, joker slots, per-blind counters, workshop credits and rhythm directly assigned; menus and tutorial by touch',
                'info':info,'tutorial':found,'issues':issues,'page_errors':errors}
    finally:context.close()


def shop_double_close(browser,url,out,seed):
    context,page,errors=fresh(browser,seed,PROFILES['portrait']);issues=[]
    try:
        enter_shop(page,url,True)
        page.evaluate("() => {S.jokers=[];addJoker(JDEFS.find(j=>j.id==='joker'));renderShop();persistRun();}")
        snapshot="() => ({screen:S.screen,money:S.money,reroll:S.shop?.rerollCost??null,stock:S.shop?.jokers.map(x=>x.id)??[],owned:S.jokers.length})"
        before=page.evaluate(snapshot)
        page.locator("#shopOwned .ownedItem[data-kind='joker']").first.tap();page.locator('#ovOwned').wait_for(state='visible')
        double_at(page,page.locator('#ovOwned button[onclick="hide(\'ovOwned\')"]'),True)
        page.locator('#ovOwned').wait_for(state='hidden');after_owned=page.evaluate(snapshot)
        if before!=after_owned:issues.append({'requirement':'double-closing owned detail cannot hit shop underneath','before':before,'after':after_owned})
        page.wait_for_timeout(400);page.locator('#shopTabPacks').tap();page.locator('#shopPacks .shopItem').first.tap()
        page.locator('#ovPack').wait_for(state='visible')
        double_at(page,page.locator('#ovPack button[onclick="closePack()"]'),True)
        page.locator('#ovPack').wait_for(state='hidden');after_pack=page.evaluate(snapshot)
        if before!=after_pack:issues.append({'requirement':'double-closing pack refunds once and cannot hit shop underneath','before':before,'after':after_pack})
        screenshot(page,out,'shop-double-close')
        page.wait_for_timeout(400);page.locator('#shopTabCards').tap()
        if page.locator('#shopTabCards').get_attribute('aria-selected')!='true':issues.append({'requirement':'shop works after close guard'})
        require(not errors,f'page errors: {errors}')
        return {'status':'failed' if issues else 'passed','fixture':'normal first blind/shop; one owned joker assigned, actual paired touches on detail/pack close',
                'before':before,'after_owned':after_owned,'after_pack':after_pack,'issues':issues,'page_errors':errors}
    finally:context.close()


def multiplayer_no_reserve(browser,url,out,seed):
    contexts=[context_for(browser,PROFILES['desktop'],seed+i) for i in range(2)]
    host,guest=[c.new_page() for c in contexts];errors=[watch_page(p) for p in (host,guest)];issues=[]
    try:
        open_lobby(host,url,'甲');open_lobby(guest,url,'乙');code=create_room(host)
        guest.locator('#mpCode').fill(code);guest.locator('#ovMpLobby button[onclick="mpJoin()"]',).click()
        for page in (host,guest):page.locator('#ovBlinds').wait_for(state='visible',timeout=15000)
        host.locator('#blindCols .cur .bbtn:not(.skip)').click();host.locator('#handRow .card').first.wait_for(state='visible')
        observed=host.evaluate("""() => ({on:MP.on,hidden:document.querySelector('#reserveBtn').hidden,
          showTactics:!document.querySelector('#tacticsEntry').hidden,hands:S.baseHands,discards:S.baseDisc})""")
        screenshot(host,out,'multiplayer-no-reserve')
        if not observed['on'] or not observed['hidden'] or observed['showTactics'] or (observed['hands'],observed['discards'])!=(4,3):
            issues.append({'requirement':'multiplayer keeps classic 4/3 and no reserve/tactics','observed':observed})
        require(not any(errors),f'page errors: {errors}')
        return {'status':'failed' if issues else 'passed','fixture':'two isolated real browser clients, local relay, actual multiplayer lobby and blind start by mouse',
                'room':code,'observed':observed,'issues':issues,'page_errors':errors}
    finally:
        for context in contexts:context.close()


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--browser',default=r'D:\Quark\quark.exe')
    p.add_argument('--app-dir',type=Path,default=ROOT)
    p.add_argument('--output-dir',type=Path,required=True)
    p.add_argument('--seed',type=int,default=1)
    p.add_argument('--only',action='append')
    args=p.parse_args();args.app_dir=args.app_dir.resolve();args.output_dir=args.output_dir.resolve()
    args.output_dir.mkdir(parents=True,exist_ok=True)
    raw=(args.app_dir/'balatro.html').read_bytes()
    results={'app_dir':str(args.app_dir),'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),
             'browser':args.browser,'seed':args.seed,'cases':{}}
    process,url=start_server(args.app_dir)
    try:
        with sync_playwright() as pw:
            browser=pw.chromium.launch(executable_path=args.browser,headless=True,
                   args=['--disable-extensions','--disable-background-networking'])
            try:
                cases={**{f'reserve_{name}':(lambda n=name:reserve_flow(browser,url,args.output_dir,args.seed,n)) for name in PROFILES},
                       **{f'dense_{name}':(lambda n=name:dense_reserve(browser,url,args.output_dir,args.seed,n)) for name in PROFILES},
                       'empty_deck':lambda:empty_deck(browser,url,args.output_dir,args.seed),
                       'scoring_visibility':lambda:scoring_visibility(browser,url,args.output_dir,args.seed),
                       'next_blind_reset':lambda:next_blind_reset(browser,url,args.output_dir,args.seed),
                       'reserve_keyboard':lambda:reserve_keyboard(browser,url,args.output_dir,args.seed),
                       'sort_deck_tutorial':lambda:sort_deck_tutorial(browser,url,args.output_dir,args.seed),
                       'shop_regression':lambda:shop_regression(browser,url,args.output_dir,args.seed),
                       'ordinary_small':lambda:ordinary_small(browser,url,args.output_dir,args.seed),
                       'tutorial_info':lambda:tutorial_info(browser,url,args.output_dir,args.seed),
                       'shop_double_close':lambda:shop_double_close(browser,url,args.output_dir,args.seed),
                       'multiplayer_no_reserve':lambda:multiplayer_no_reserve(browser,url,args.output_dir,args.seed)}
                require(not args.only or not (set(args.only)-set(cases)),f'unknown cases: {args.only}')
                for name,run in cases.items():
                    if args.only and name not in args.only:continue
                    try:data=run()
                    except Exception as exc:data={'status':'failed','error':f'{type(exc).__name__}: {exc}','traceback':traceback.format_exc()}
                    results['cases'][name]=data
                    print(name.upper()+' '+data['status']+' '+data.get('error',''),flush=True)
            finally:browser.close()
    finally:
        process.terminate()
        try:process.wait(timeout=5)
        except Exception:process.kill()
        (args.output_dir/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
    return int(any(case['status']!='passed' for case in results['cases'].values()))


if __name__=='__main__':sys.exit(main())
