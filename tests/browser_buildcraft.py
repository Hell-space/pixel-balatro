"""1.4 buildcraft UI checks; isolated headless Quark and local server only.

    python -B tests/browser_buildcraft.py --app-dir . --output-dir .qa/v140/results

Game actions use touch. Rare or late-game setups are identified in result JSON.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import traceback
from pathlib import Path
from playwright.sync_api import sync_playwright
from browser_extended import enter_shop, start_server
from browser_smoke import (ROOT, assert_reachable, assert_viewport, context_for,
                           read_number, reload_and_resume, require, request_new_solo,
                           screenshot, start_blind, swipe_up_within, touch_at, watch_page)

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(errors="backslashreplace")

PROFILES={"small":{"width":320,"height":568,"mobile":True},
          "portrait":{"width":390,"height":844,"mobile":True},
          "landscape":{"width":640,"height":360,"mobile":True}}


def fresh(browser, seed, spec):
    context=context_for(browser,spec,seed)
    page=context.new_page()
    return context,page,watch_page(page)


def open_workshop(page,service="copy"):
    tab=page.locator("#shopTabWorkshop");assert_reachable(tab,"workshop tab");tab.tap()
    require(tab.get_attribute("aria-selected")=="true","workshop tab did not activate")
    service_button=page.locator(f"#shopWorkshop [data-service='{service}']")
    assert_reachable(service_button,f"{service} service");service_button.tap()
    page.locator("#ovWorkshop").wait_for(state="visible")


def inspect_workshop(page):
    return page.evaluate("""() => {
      const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
      const grid=document.querySelector('#workshopCards'),g=rect(grid);
      const cards=[...grid.querySelectorAll('.card')].map(e=>{
        const c=rect(e);return {id:e.dataset.cardId,card:c,parts:[...e.querySelectorAll('.facePip,.facePip svg,.pips,.pips i,.pips svg,.rk,.st2,.st,.en,.seal')]
          .map(p=>({cls:p.className,rect:rect(p),hidden:getComputedStyle(p).display==='none'}))};
      });
      const preview=document.querySelector('#workshopPreview');
      return {grid:g,cards,confirm:rect(document.querySelector('#workshopConfirm')),
        cancel:rect(document.querySelector('.workshopActions button')),
        preview:{...rect(preview),text:preview.innerText,scrollHeight:preview.scrollHeight,clientHeight:preview.clientHeight,scrollTop:preview.scrollTop}};
    }""")


def workshop_visual(browser,url,out,seed,profile):
    context,page,errors=fresh(browser,seed,PROFILES[profile]);issues=[]
    try:
        plays=enter_shop(page,url,True);assert_viewport(page,PROFILES[profile]["width"])
        tabs=page.locator('.shopTabs [role="tab"]')
        tab_rects=[]
        for i in range(tabs.count()):
            tab=tabs.nth(i);assert_reachable(tab,f"shop tab {i+1}")
            box=tab.bounding_box();tab_rects.append({"text":tab.inner_text(),**box})
        require(len(tab_rects)==5,"expected five shop tabs")
        screenshot(page,out,f"shop-tabs-{profile}")
        open_workshop(page)
        screenshot(page,out,f"workshop-grid-{profile}")
        layout=inspect_workshop(page)
        for selector in ("#workshopSuit","#workshopConfirm",".workshopActions button:first-child"):
            assert_reachable(page.locator(selector),selector)
        require(page.locator("#workshopConfirm").is_disabled(),"confirm enabled with no selection")
        for card in layout["cards"]:
            cr=card["card"]
            for part in card["parts"]:
                r=part["rect"]
                if not part["hidden"] and (r["left"]<cr["left"]-2 or r["right"]>cr["right"]+2 or r["top"]<cr["top"]-2 or r["bottom"]>cr["bottom"]+2):
                    issues.append({"requirement":"card artwork stays inside card","id":card["id"],"part":part,"card":cr})
        selected=page.locator("#workshopCards .card").first
        selected.tap()
        require(page.locator("#workshopConfirm").is_enabled(),"selected card did not enable confirm")
        screenshot(page,out,f"workshop-selected-{profile}")
        page.locator('#ovWorkshop button[onclick="closeWorkshop()"]',).tap()
        require(not page.evaluate("() => S.shop.workshopUsed"),"cancel completed workshop operation")
        require(not errors,f"page errors: {errors}")
        return {"status":"failed" if issues else "passed","fixture":"normal first blind and shop, real touches",
                "plays":plays,"tabs":tab_rects,"layout":layout,"issues":issues,"page_errors":errors}
    finally:
        context.close()


def workshop_transaction(browser,url,out,seed,service,free=False,double=False):
    context,page,errors=fresh(browser,seed,PROFILES['small']);issues=[]
    try:
        enter_shop(page,url,True)
        card_id=page.evaluate("""free => {
          if(free)S.workshopCredits=2;
          const c=S.deckAll.find(x=>x.rank===14&&x.suit===0);
          Object.assign(c,{bonus:30,multB:4,wild:true,steel:true,ed:3,seal:'red'});
          renderShop();persistRun();return c.id;
        }""",free)
        before=page.evaluate("id => ({money:S.money,credits:S.workshopCredits,count:S.deckAll.length,added:S.cardsAdded,card:{...S.deckAll.find(c=>c.id===id)}})",card_id)
        open_workshop(page,service)
        selected=page.locator(f'#workshopCards .card[data-card-id="{card_id}"]')
        selected.tap()
        details=page.locator('#workshopPreview').inner_text()
        screenshot(page,out,f'{service}-{"free" if free else "paid"}-details-top')
        for word in ('百搭花色','点数不变','奖励','倍率','钢铁','多彩','红蜡封'):
            if word not in details:issues.append({'requirement':'complete enhancement details','missing':word,'details':details})
        preview=page.locator('#workshopPreview')
        before_scroll=preview.evaluate("el => ({top:el.scrollTop,max:el.scrollHeight-el.clientHeight})")
        if before_scroll['max']>1:
            for _ in range(3):
                swipe_up_within(page,preview)
                if preview.evaluate('el=>el.scrollTop')>=before_scroll['max']-2:break
            after_scroll=preview.evaluate('el=>el.scrollTop')
            if after_scroll<before_scroll['max']-2:
                issues.append({'requirement':'full enhancement details readable by touch scroll','before':before_scroll,'after':after_scroll})
        else:after_scroll=before_scroll['top']
        screenshot(page,out,f'{service}-{"free" if free else "paid"}-details-bottom')
        confirm=page.locator('#workshopConfirm');assert_reachable(confirm,'workshop confirmation')
        expected_price=0 if free else {'remove':4,'copy':6,'polish':5}[service]
        label=confirm.inner_text()
        if ('免费' if free else '$'+str(expected_price)) not in label:
            issues.append({'requirement':'confirmation displays actual cost','label':label})
        page.locator('#ovWorkshop button[onclick="closeWorkshop()"]',).tap()
        cancelled=page.evaluate("() => ({money:S.money,credits:S.workshopCredits,count:S.deckAll.length,used:S.shop.workshopUsed})")
        if cancelled!={'money':before['money'],'credits':before['credits'],'count':before['count'],'used':False}:
            issues.append({'requirement':'cancel does not charge or use service','after':cancelled})
        # After a dialog closes, allow the deliberate double-tap guard to expire.
        page.wait_for_timeout(400)
        open_workshop(page,service);page.locator(f'#workshopCards .card[data-card-id="{card_id}"]').tap()
        box=page.locator('#workshopConfirm').bounding_box();require(box,'confirm not visible')
        x=box['x']+box['width']/2;y=box['y']+box['height']/2
        touch_at(page,x,y)
        if double:touch_at(page,x,y)
        page.locator('#ovWorkshop').wait_for(state='hidden')
        after=page.evaluate("""id => ({money:S.money,credits:S.workshopCredits,count:S.deckAll.length,added:S.cardsAdded,screen:S.screen,
          used:S.shop?.workshopUsed??null,card:S.deckAll.find(c=>c.id===id)||null,
          copies:S.deckAll.filter(c=>c.id!==id&&c.rank===14&&c.suit===0).map(c=>({...c})),
          refs:S.hand.filter(c=>c.id===id).length+S.drawPile.filter(c=>c.id===id).length})""",card_id)
        expected_money=before['money']-expected_price
        if after['money']!=expected_money or after['credits']!=before['credits']-(1 if free else 0) or not after['used']:
            issues.append({'requirement':'exactly one payment or free credit','before':before,'after':after})
        if service=='copy':
            copies=after['copies']
            if after['count']!=before['count']+1 or after['added']!=before['added']+1 or len(copies)!=1:
                issues.append({'requirement':'exactly one copied card with new identity','after':after})
            elif any(copies[0].get(k)!=before['card'].get(k) for k in ('rank','suit','bonus','multB','wild','steel','ed','seal')):
                issues.append({'requirement':'copy preserves every enhancement','before':before['card'],'copy':copies[0]})
        elif service=='polish':
            if after['count']!=before['count'] or not after['card'] or after['card']['bonus']!=before['card']['bonus']+30:
                issues.append({'requirement':'polish adds 30 chips once','before':before,'after':after})
        elif after['count']!=before['count']-1 or after['card'] is not None or after['refs']:
            issues.append({'requirement':'removal updates all card references once','after':after})
        screenshot(page,out,f'{service}-{"free" if free else "paid"}-after')
        if after['screen']!='shop':
            issues.append({'requirement':'second tap does not trigger control under closed dialog','screen':after['screen']})
            require(not errors,f'page errors: {errors}')
            return {'status':'failed','fixture':'normal shop, complex card fixture, two actual touch sequences',
                    'before':before,'after':after,'issues':issues,'page_errors':errors}
        if double:
            page.wait_for_timeout(400)
            page.locator('#ovShop button[onclick="leaveShop()"]',).tap()
            page.locator('#ovBlinds').wait_for(state='visible')
            next_state=page.evaluate("() => ({screen:S.screen,money:S.money,credits:S.workshopCredits,count:S.deckAll.length})")
            if next_state['screen']!='select' or next_state['count']!=after['count'] or next_state['money']!=after['money']:
                issues.append({'requirement':'next blind available after double-tap guard expires','observed':next_state})
            require(not errors,f'page errors: {errors}')
            return {'status':'failed' if issues else 'passed','fixture':'normal shop, complex card fixture, two actual touch sequences and next blind after 400ms',
                    'before':before,'cancelled':cancelled,'after':after,'next_state':next_state,'issues':issues,'page_errors':errors}
        reload_and_resume(page,True,'#ovShop')
        resumed=page.evaluate("""id => ({money:S.money,credits:S.workshopCredits,count:S.deckAll.length,added:S.cardsAdded,
          used:S.shop.workshopUsed,card:S.deckAll.find(c=>c.id===id)||null})""",card_id)
        for k in ('money','credits','count','added','used','card'):
            if resumed[k]!=after[k]:issues.append({'requirement':'workshop transaction survives refresh','field':k,'after':after[k],'resumed':resumed[k]})
        page.locator('#shopTabWorkshop').tap()
        if any(page.locator(f"#shopWorkshop [data-service='{name}']").is_enabled() for name in ('remove','copy','polish')):
            issues.append({'requirement':'only one service per shop'})
        require(not errors,f'page errors: {errors}')
        return {'status':'failed' if issues else 'passed','fixture':'normal first blind/shop, then one complex enhanced card'+(' and two free credits' if free else '')+' assigned; UI actions by touch'+(' including double tap' if double else ''),
                'before':before,'cancelled':cancelled,'after':after,'resumed':resumed,'details':details,
                'preview_scroll':{'before':before_scroll,'after':after_scroll},'issues':issues,'page_errors':errors}
    finally:context.close()


def workshop_filter_keyboard(browser,url,out,seed,profile):
    context,page,errors=fresh(browser,seed,PROFILES[profile]);issues=[]
    try:
        enter_shop(page,url,True);open_workshop(page,'copy')
        select=page.locator('#workshopSuit')
        if select.evaluate('e=>e.tagName')=='SELECT':
            select.tap();page.keyboard.press('End');page.keyboard.press('Enter');selected_value=select.input_value()
        else:
            select.locator('[data-suit="3"]').tap();selected_value='3'
        actual=page.evaluate("() => [...document.querySelectorAll('#workshopCards .card')].map(e=>{const c=S.deckAll.find(x=>String(x.id)===e.dataset.cardId);return {suit:c.suit,wild:c.wild}})")
        screenshot(page,out,f'workshop-filter-{profile}')
        if selected_value!='3' or any(c['suit']!=3 and not c['wild'] for c in actual) or len(actual)!=13:
            issues.append({'requirement':'suit filter shows exactly diamond cards plus wilds','value':selected_value,'cards':actual})
        page.locator('#workshopCards .card').first.tap()
        before=page.evaluate('() => ({money:S.money,count:S.deckAll.length,used:S.shop.workshopUsed})')
        page.keyboard.press('Escape')
        if page.locator('#ovWorkshop').is_visible():issues.append({'requirement':'Escape cancels workshop'})
        after=page.evaluate('() => ({money:S.money,count:S.deckAll.length,used:S.shop.workshopUsed})')
        if before!=after:issues.append({'requirement':'Escape does not commit transaction','before':before,'after':after})
        require(not errors,f'page errors: {errors}')
        return {'status':'failed' if issues else 'passed','fixture':'normal shop, suit filter selected with real input; target tapped and Escape tested',
                'filter_value':selected_value,'cards':actual,'before':before,'after':after,'issues':issues,'page_errors':errors}
    finally:context.close()


def start_selection(page,url):
    page.goto(url,wait_until='domcontentloaded')
    request_new_solo(page,True)
    page.locator('#ovBlinds').wait_for(state='visible')


def start_selected_blind(page):
    page.locator('#blindCols .cur .bbtn:not(.skip)').tap()
    page.locator('#handRow .card').first.wait_for(state='visible')


def set_hand(page,specs):
    return page.evaluate("""specs => {
      const cards=specs.map(([rank,suit])=>S.deckAll.find(c=>c.rank===rank&&c.suit===suit));
      if(cards.some(c=>!c))throw Error('fixture card missing');cards.forEach(c=>c.sel=false);
      S.hand=cards;S.drawPile=S.deckAll.filter(c=>!cards.includes(c));S.jokers=[];
      renderAll();return cards.map(c=>c.id);
    }""",specs)


def play_ids(page,ids):
    for card_id in ids:page.locator(f'#handRow .card[data-card-id="{card_id}"]').tap()
    estimate=read_number(page,'#scoreEstimate');name=page.locator('#prevName').inner_text()
    score=read_number(page,'#scoreVal')
    page.locator('#btnPlay').tap()
    page.wait_for_function('before => S && !S.busy && S.score>before',arg=score,timeout=20000)
    return {'name':name,'estimate':estimate,'actual':read_number(page,'#scoreVal')-score}


def boss_rewards(browser,url,out,seed):
    issues=[];all_errors=[]
    context,page,errors=fresh(browser,seed,PROFILES['portrait'])
    try:
        start_selection(page,url)
        page.locator('#blindCols .cur .bbtn.skip').tap()
        page.locator('#blindCols .cur .bbtn.skip').tap()
        boss=page.evaluate("() => ({id:S.anteBoss.id,ante:S.ante,blind:S.blindIdx})")
        require(boss['blind']==2,'two real skips did not open boss')
        page.locator('#blindCols .cur .bbtn:not(.skip)').tap()
        page.locator('#handRow .card').first.wait_for(state='visible')
        ids=set_hand(page,[[14,0],[14,1],[14,2],[14,3],[2,0],[3,0],[4,0],[5,0]])
        played=play_ids(page,ids[:4]);page.locator('#ovCash').wait_for(state='visible')
        raw=page.evaluate("() => localStorage.getItem('pixel-balatro.run.v1')")
        pending=page.evaluate('() => ({money:S.money,credits:S.workshopCredits,levels:{...S.levels},bossReward:S.bossReward})')
        require(pending['bossReward'] and raw,'boss reward was not prepared and saved')
        screenshot(page,out,'boss-real-cash')
        page.locator('#ovCash button').filter(has_text='前往商店').tap()
        page.locator('#ovReward').wait_for(state='visible')
        screenshot(page,out,'boss-real-reward')
        require(not errors,f'page errors: {errors}');all_errors.extend(errors)
    finally:context.close()
    branches=[]
    for profile,choice in (('small','cash'),('portrait','level'),('landscape','workshop')):
        context,page,errors=fresh(browser,seed,PROFILES[profile])
        try:
            page.goto(url,wait_until='domcontentloaded')
            page.evaluate("raw => {localStorage.setItem('pixel-balatro.run.v1',raw);localStorage.removeItem('pixel-balatro.run.v1.backup');}",raw)
            page.reload(wait_until='domcontentloaded');page.locator('#resumeBtn').tap()
            page.locator('#ovReward').wait_for(state='visible')
            assert_viewport(page,PROFILES[profile]['width'])
            if choice=='level':
                select=page.locator('#rewardHand');select.tap()
                if select.evaluate('e=>e.tagName')=='SELECT':
                    page.keyboard.press('Home');page.keyboard.press('ArrowDown');page.keyboard.press('Enter');key=select.input_value()
                else:
                    page.locator('#rewardHandChoices [data-hand="pair"]').tap();page.wait_for_timeout(400);key=page.evaluate('()=>S.bossReward.handKey')
                if key!='pair':issues.append({'requirement':'reward hand can be selected','profile':profile,'actual':key})
                page.reload(wait_until='domcontentloaded');page.locator('#resumeBtn').tap()
                page.locator('#ovReward').wait_for(state='visible')
                if page.evaluate('()=>S.bossReward.handKey')!='pair':
                    issues.append({'requirement':'selected reward hand persists before choosing','profile':profile})
                # This calls the native wrapper's JS back handler; it is not a hardware Android key test.
                back_result=page.evaluate('() => nativeBack()')
                page.locator('#ovMenu').wait_for(state='visible')
                page.locator('#returnTitleBtn').tap();page.locator('#ovStart').wait_for(state='visible')
                page.locator('#resumeBtn').tap();page.locator('#ovReward').wait_for(state='visible')
                if back_result is not False or page.evaluate('()=>S.bossReward.handKey')!='pair':
                    issues.append({'requirement':'pending reward survives menu return to title and resume','profile':profile})
            for selector in ("[data-reward='cash']",'#rewardHand',"[data-reward='level']","[data-reward='workshop']"):
                assert_reachable(page.locator(selector),f'{profile} reward control {selector}')
            screenshot(page,out,f'reward-{profile}-choices')
            before=page.evaluate("() => ({money:S.money,credits:S.workshopCredits,pair:S.levels.pair,jokers:S.jokers.length,cons:S.cons.length})")
            button=page.locator(f"[data-reward='{choice}']")
            rect=button.bounding_box();require(rect,'reward button has no bounds')
            x=rect['x']+rect['width']/2;y=rect['y']+rect['height']/2
            touch_at(page,x,y);touch_at(page,x,y)
            state=page.evaluate("""() => ({screen:S.screen,money:S.money,credits:S.workshopCredits,pair:S.levels.pair,
              bossReward:S.bossReward,jokers:S.jokers.length,cons:S.cons.length,
              sold:S.shop?[...S.shop.jokers,...S.shop.cons,...S.shop.packs].filter(x=>x.sold).length:null})""")
            expected={'money':before['money']+(8 if choice=='cash' else 0),
                      'credits':before['credits']+(2 if choice=='workshop' else 0),
                      'pair':before['pair']+(2 if choice=='level' else 0)}
            if state['screen']!='shop' or state['bossReward'] is not None or any(state[k]!=v for k,v in expected.items()):
                issues.append({'requirement':'reward claimed once and double tap stays in shop','profile':profile,'choice':choice,
                               'before':before,'expected':expected,'after':state})
            if state['screen']=='shop':
                if state['jokers']!=before['jokers'] or state['cons']!=before['cons'] or state['sold']:
                    issues.append({'requirement':'second touch does not purchase underneath reward','profile':profile,'state':state})
                page.wait_for_timeout(400)
                page.locator('#ovShop button[onclick="leaveShop()"]',).tap()
                page.locator('#ovBlinds').wait_for(state='visible')
                reload_and_resume(page,True,'#ovBlinds')
                resumed=page.evaluate('() => ({money:S.money,credits:S.workshopCredits,pair:S.levels.pair,bossReward:S.bossReward})')
                if resumed!={**expected,'bossReward':None}:
                    issues.append({'requirement':'reward survives exit and resume exactly once','profile':profile,'expected':expected,'resumed':resumed})
            else:resumed=None
            screenshot(page,out,f'reward-{profile}-after')
            require(not errors,f'page errors: {errors}')
            branches.append({'profile':profile,'choice':choice,'before':before,'after':state,'resumed':resumed})
            all_errors.extend(errors)
        finally:context.close()
    return {'status':'failed' if issues else 'passed','fixture':'two real skips and actual boss victory after assigning four aces; actual saved cash state cloned into three isolated contexts; reward controls use touch and native keyboard select',
            'boss':boss,'played':played,'pending':pending,'branches':branches,'issues':issues,'page_errors':all_errors}


def workshop_cancel_double(browser,url,out,seed):
    context,page,errors=fresh(browser,seed,PROFILES['small']);issues=[]
    try:
        enter_shop(page,url,True);open_workshop(page,'copy')
        page.locator('#workshopCards .card').first.tap()
        before=page.evaluate("""() => ({money:S.money,count:S.deckAll.length,used:S.shop.workshopUsed,reroll:S.shop.rerollCost,
          stock:S.shop.jokers.map(j=>j.id)})""")
        button=page.locator('#ovWorkshop button[onclick="closeWorkshop()"]');box=button.bounding_box();require(box,'cancel has no area')
        x=box['x']+box['width']/2;y=box['y']+box['height']/2
        touch_at(page,x,y);touch_at(page,x,y)
        after=page.evaluate("""() => ({money:S.money,count:S.deckAll.length,used:S.shop?.workshopUsed??null,
          reroll:S.shop?.rerollCost??null,stock:S.shop?.jokers.map(j=>j.id)??[],screen:S.screen})""")
        if after!={**before,'screen':'shop'}:
            issues.append({'requirement':'double cancel does not trigger a shop action underneath','before':before,'after':after})
        screenshot(page,out,'workshop-double-cancel')
        page.wait_for_timeout(400)
        page.locator('#shopTabCards').tap()
        if page.locator('#shopTabCards').get_attribute('aria-selected')!='true':
            issues.append({'requirement':'shop controls work after cancel guard'})
        require(not errors,f'page errors: {errors}')
        return {'status':'failed' if issues else 'passed','fixture':'normal first blind/shop, two real touches on cancel, normal tab after 400ms',
                'before':before,'after':after,'issues':issues,'page_errors':errors}
    finally:context.close()


def workshop_cross_store(browser,url,out,seed):
    context,page,errors=fresh(browser,seed,PROFILES['portrait']);issues=[]
    try:
        enter_shop(page,url,True)
        page.evaluate("() => {S.workshopCredits=2;renderShop();persistRun();}")
        open_workshop(page,'copy');page.locator('#workshopCards .card').first.tap()
        before=page.evaluate('() => ({money:S.money,credits:S.workshopCredits,count:S.deckAll.length})')
        require('免费' in page.locator('#workshopConfirm').inner_text(),'first service did not show free')
        page.locator('#workshopConfirm').tap();page.locator('#ovWorkshop').wait_for(state='hidden')
        first=page.evaluate('() => ({money:S.money,credits:S.workshopCredits,count:S.deckAll.length,used:S.shop.workshopUsed})')
        if first!={'money':before['money'],'credits':1,'count':before['count']+1,'used':True}:
            issues.append({'requirement':'first free operation uses one credit and no money','before':before,'after':first})
        page.wait_for_timeout(400);page.locator('#ovShop button[onclick="leaveShop()"]',).tap()
        page.locator('#blindCols .cur .bbtn:not(.skip)').tap();page.locator('#handRow .card').first.wait_for(state='visible')
        page.evaluate('() => {S.target=1;renderAll();}')
        page.locator('#handRow .card').first.tap();page.locator('#btnPlay').tap()
        page.locator('#ovCash').wait_for(state='visible',timeout=20000)
        page.locator('#ovCash button').filter(has_text='前往商店').tap();page.locator('#ovShop').wait_for(state='visible')
        open_workshop(page,'remove');page.locator('#workshopCards .card').first.tap()
        before_second=page.evaluate('() => ({money:S.money,credits:S.workshopCredits,count:S.deckAll.length})')
        require('免费' in page.locator('#workshopConfirm').inner_text(),'remaining credit did not carry to next shop')
        page.locator('#workshopConfirm').tap();page.locator('#ovWorkshop').wait_for(state='hidden')
        second=page.evaluate('() => ({money:S.money,credits:S.workshopCredits,count:S.deckAll.length,used:S.shop.workshopUsed})')
        if second!={'money':before_second['money'],'credits':0,'count':before_second['count']-1,'used':True}:
            issues.append({'requirement':'remaining credit works in next shop','before':before_second,'after':second})
        screenshot(page,out,'workshop-second-free-shop')
        reload_and_resume(page,True,'#ovShop')
        restored=page.evaluate('() => ({money:S.money,credits:S.workshopCredits,count:S.deckAll.length,used:S.shop.workshopUsed})')
        if restored!=second:issues.append({'requirement':'second free operation survives refresh','after':second,'restored':restored})
        require(not errors,f'page errors: {errors}')
        return {'status':'failed' if issues else 'passed','fixture':'normal first shop; two credits assigned; second blind target assigned 1, real play to next shop; two free services by touch',
                'before':before,'first':first,'before_second':before_second,'second':second,'restored':restored,'issues':issues,'page_errors':errors}
    finally:context.close()


def workshop_tab_focus(browser,url,out,seed):
    context,page,errors=fresh(browser,seed,PROFILES['small']);issues=[]
    try:
        enter_shop(page,url,True);open_workshop(page,'copy')
        page.locator('#workshopCards .card').first.tap()
        trace=[]
        for _ in range(16):
            page.keyboard.press('Tab')
            active=page.evaluate("""() => ({tag:document.activeElement.tagName,id:document.activeElement.id,
              within:!!document.activeElement.closest('#ovWorkshop')})""")
            trace.append(active)
            if not active['within']:issues.append({'requirement':'Tab focus stays in workshop','active':active})
        before=page.evaluate('() => ({money:S.money,count:S.deckAll.length})')
        page.keyboard.press('Escape')
        if page.locator('#ovWorkshop').is_visible():issues.append({'requirement':'Escape cancels workshop'})
        after=page.evaluate('() => ({money:S.money,count:S.deckAll.length})')
        if before!=after:issues.append({'requirement':'keyboard cancel does not spend','before':before,'after':after})
        screenshot(page,out,'workshop-focus-escape')
        require(not errors,f'page errors: {errors}')
        return {'status':'failed' if issues else 'passed','fixture':'normal shop, actual touch selection and 16 Tab presses then Escape',
                'trace':trace,'before':before,'after':after,'issues':issues,'page_errors':errors}
    finally:context.close()


def standard_pack_refresh(browser,url,out,seed):
    context,page,errors=fresh(browser,seed,PROFILES['portrait']);issues=[]
    try:
        enter_shop(page,url,True);page.locator('#shopTabPacks').tap()
        pack=page.locator('#shopPacks .shopItem').filter(has_text='标准包')
        require(pack.count()==1 and pack.is_enabled(),'standard pack not affordable in seeded shop')
        before=page.evaluate('() => ({money:S.money,count:S.deckAll.length})')
        pack.tap();page.locator('#ovPack').wait_for(state='visible')
        options=page.evaluate('() => S.pack.options.map(c=>({...c}))')
        paid=page.evaluate('() => S.money')
        screenshot(page,out,'standard-pack-open')
        reload_and_resume(page,True,'#ovPack')
        restored=page.evaluate('() => ({money:S.money,options:S.pack.options.map(c=>({...c}))})')
        if restored!={'money':paid,'options':options}:
            issues.append({'requirement':'open standard pack survives refresh with same candidates and price',
                           'before':{'money':paid,'options':options},'restored':restored})
        page.locator('#packCards button').first.tap();page.locator('#ovPack').wait_for(state='hidden')
        chosen=page.evaluate("""id => ({money:S.money,count:S.deckAll.length,card:S.deckAll.find(c=>c.id===id)||null,
          sold:S.shop.packs.find(p=>p.id==='standard').sold})""",options[0]['id'])
        if chosen['money']!=paid or chosen['count']!=before['count']+1 or not chosen['card'] or not chosen['sold']:
            issues.append({'requirement':'standard choice adds the selected card once','before':before,'chosen':chosen})
        reload_and_resume(page,True,'#ovShop')
        resumed=page.evaluate("""id => ({money:S.money,count:S.deckAll.length,card:S.deckAll.find(c=>c.id===id)||null,
          sold:S.shop.packs.find(p=>p.id==='standard').sold})""",options[0]['id'])
        if resumed!=chosen:issues.append({'requirement':'completed standard purchase survives refresh','chosen':chosen,'resumed':resumed})
        screenshot(page,out,'standard-pack-purchased-resumed')
        require(not errors,f'page errors: {errors}')
        return {'status':'failed' if issues else 'passed','fixture':'normal first blind and actual standard pack purchase, selection and refresh by touch',
                'before':before,'paid':paid,'options':options,'restored':restored,'chosen':chosen,'resumed':resumed,'issues':issues,'page_errors':errors}
    finally:context.close()


def boss_hud(browser,url,out,seed,profile):
    context,page,errors=fresh(browser,seed,PROFILES[profile]);issues=[]
    try:
        start_selection(page,url);start_selected_blind(page)
        page.evaluate("""() => { S.blindIdx=2;S.boss=BOSSES.find(b=>b.id==='hook');
          S.anteBoss=S.boss;S.target=600;renderAll(); }""")
        assert_viewport(page,PROFILES[profile]['width'])
        geometry=page.evaluate("""() => {
          const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,
            width:r.width,height:r.height,text:e.innerText,scrollWidth:e.scrollWidth,clientWidth:e.clientWidth,
            display:getComputedStyle(e).display};};
          const hit=e=>{const r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
            const target=x>=0&&x<innerWidth&&y>=0&&y<innerHeight?document.elementFromPoint(x,y):null;
            return !!target&&(target===e||e.contains(target));};
          return {boss:rect(document.querySelector('#bossDesc')),
            hand:rect(document.querySelector('#handRow')),play:rect(document.querySelector('#btnPlay')),
            discard:rect(document.querySelector('#btnDiscard')),
            firstCardHit:hit(document.querySelector('#handRow .card')),
            playHit:hit(document.querySelector('#btnPlay')),discardHit:hit(document.querySelector('#btnDiscard'))};
        }""")
        screenshot(page,out,f'boss-hud-{profile}')
        for name in ('boss','play','discard'):
            r=geometry[name]
            if (r['display']=='none' or r['left']<-1 or r['top']<-1 or
                r['right']>PROFILES[profile]['width']+1 or r['bottom']>PROFILES[profile]['height']+1 or
                r['scrollWidth']>r['clientWidth']+1):
                issues.append({'requirement':'HUD text and action buttons fit viewport','element':name,'rect':r})
        if not all(geometry[k] for k in ('firstCardHit','playHit','discardHit')):
            issues.append({'requirement':'hand and play/discard controls are touchable','geometry':geometry})
        before=page.evaluate('() => ({hands:S.handsLeft,discards:S.discLeft})')
        page.locator('#handRow .card').first.tap();page.locator('#btnDiscard').tap()
        page.locator('#handRow .card').first.tap();page.locator('#btnPlay').tap()
        page.wait_for_function('() => S && !S.busy && S.score>0',timeout=20000)
        after=page.evaluate('() => ({hands:S.handsLeft,discards:S.discLeft,score:S.score})')
        if after['hands']!=before['hands']-1 or after['discards']!=before['discards']-1:
            issues.append({'requirement':'actual discard and play both work','before':before,'after':after})
        screenshot(page,out,f'boss-played-{profile}')
        require(not errors,f'page errors: {errors}')
        return {'status':'failed' if issues else 'passed','fixture':'normal new game; hook boss assigned after blind starts; discard/play by touch',
                'geometry':geometry,'before':before,'after':after,'issues':issues,'page_errors':errors}
    finally:context.close()


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
                cases={**{f'workshop_visual_{name}':(lambda n=name:workshop_visual(browser,url,args.output_dir,args.seed,n)) for name in PROFILES},
                       **{f'workshop_{service}':(lambda s=service:workshop_transaction(browser,url,args.output_dir,args.seed,s)) for service in ('copy','polish','remove')},
                       'workshop_free':lambda:workshop_transaction(browser,url,args.output_dir,args.seed,'copy',True),
                       'workshop_double_paid':lambda:workshop_transaction(browser,url,args.output_dir,args.seed,'copy',False,True),
                       'workshop_double_free':lambda:workshop_transaction(browser,url,args.output_dir,args.seed,'copy',True,True),
                       **{f'workshop_filter_{name}':(lambda n=name:workshop_filter_keyboard(browser,url,args.output_dir,args.seed,n)) for name in PROFILES},
                       'boss_rewards':lambda:boss_rewards(browser,url,args.output_dir,args.seed),
                       'workshop_cancel_double':lambda:workshop_cancel_double(browser,url,args.output_dir,args.seed),
                       'workshop_cross_store':lambda:workshop_cross_store(browser,url,args.output_dir,args.seed),
                       'workshop_tab_focus':lambda:workshop_tab_focus(browser,url,args.output_dir,args.seed),
                       'standard_pack_refresh':lambda:standard_pack_refresh(browser,url,args.output_dir,args.seed),
                       **{f'boss_hud_{name}':(lambda n=name:boss_hud(browser,url,args.output_dir,args.seed,n)) for name in PROFILES}}
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
    return int(any(c['status']!='passed' for c in results['cases'].values()))


if __name__=='__main__':sys.exit(main())
