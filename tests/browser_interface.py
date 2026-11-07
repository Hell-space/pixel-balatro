"""1.6 interface tests in isolated, headless Quark against a local server.

    python -B tests/browser_interface.py --app-dir .qa/v160/candidate --output-dir .qa/v160/browser

Phone profiles use touch, desktop uses mouse/keyboard. State fixtures are
labelled in the resulting JSON; HTML length and SHA-256 bind each run.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import time
import traceback
from pathlib import Path

from playwright.sync_api import sync_playwright
from browser_extended import enter_shop, start_server
from browser_smoke import (ROOT, activate, assert_reachable, assert_viewport, center_hit,
                           context_for, read_number, reload_and_resume, request_new_solo, require,
                           screenshot, start_blind, swipe_up_within, touch_at, watch_page,
                           play_best_first_blind)

if hasattr(sys.stdout,'reconfigure'):sys.stdout.reconfigure(errors='backslashreplace')
PROFILES={'small':{'width':320,'height':568,'mobile':True},
          'portrait':{'width':390,'height':844,'mobile':True},
          'landscape':{'width':640,'height':360,'mobile':True},
          'desktop':{'width':1280,'height':720,'mobile':False}}

# Independent card-hand coefficients: chips, multiplier, per-level increments.
HAND_RULES={'high':(5,1,10,1),'pair':(10,2,15,1),'twopair':(20,2,20,1),
            'trips':(30,3,20,2),'straight':(30,4,30,3),'flush':(35,4,15,2),
            'fh':(40,4,25,2),'four':(60,7,30,3),'sf':(100,8,40,4),
            'five':(120,12,35,3),'flushhouse':(140,14,40,4),'flushfive':(160,16,50,3)}


def fresh(browser,seed,spec):
    context=context_for(browser,spec,seed);page=context.new_page()
    return context,page,watch_page(page)


def press(locator,mobile):activate(locator,mobile)


def double_at(page,locator,mobile):
    box=locator.bounding_box();require(box,'control has no touch rectangle')
    x=box['x']+box['width']/2;y=box['y']+box['height']/2
    if mobile:touch_at(page,x,y);touch_at(page,x,y)
    else:page.mouse.click(x,y);page.mouse.click(x,y)


def scroll_down_until(page,container,target,mobile,max_swipes=16):
    swipes=0
    while not center_hit(target)['visible'] and swipes<max_swipes:
        if mobile:swipe_up_within(page,container)
        else:
            box=container.bounding_box();require(box,'scroll container missing')
            page.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2)
            page.mouse.wheel(0,150);page.wait_for_timeout(150)
        swipes+=1
    return swipes


def boss_cash(page,url,mobile):
    """Two real skips and boss play, with four aces assigned after dealing."""
    page.goto(url,wait_until='domcontentloaded');request_new_solo(page,mobile)
    for _ in range(2):press(page.locator('#blindCols .cur .bbtn.skip'),mobile)
    boss=page.evaluate('() => ({ante:S.ante,blind:S.blindIdx,id:S.anteBoss.id})')
    require(boss['blind']==2,'two skips did not lead to boss')
    press(page.locator('#blindCols .cur .bbtn:not(.skip)'),mobile)
    page.locator('#handRow .card').first.wait_for(state='visible')
    ids=page.evaluate("""() => {
      const specs=[[14,0],[14,1],[14,2],[14,3],[2,0],[3,0],[4,0],[5,0]];
      const cards=specs.map(([r,s])=>S.deckAll.find(c=>c.rank===r&&c.suit===s));
      S.hand=cards;S.drawPile=S.deckAll.filter(c=>!cards.includes(c));S.jokers=[];renderAll();
      return cards.map(c=>c.id);
    }""")
    for card_id in ids[:4]:press(page.locator(f'#handRow .card[data-card-id="{card_id}"]'),mobile)
    preview=read_number(page,'#scoreEstimate')
    press(page.locator('#btnPlay'),mobile)
    page.locator('#ovCash').wait_for(state='visible',timeout=20000)
    cash=page.evaluate("() => ({score:S.score,target:S.target,money:S.money,bossReward:{...S.bossReward},levels:{...S.levels}})")
    require(preview==728 and cash['score']==728 and cash['bossReward'],'boss win or reward did not result from selected four aces')
    press(page.locator('#ovCash button').filter(has_text='前往商店'),mobile)
    page.locator('#ovReward').wait_for(state='visible')
    return {'boss':boss,'preview':preview,'cash':cash}


def picker_geometry(page):
    return page.evaluate("""() => {
      const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,
        width:r.width,height:r.height,scrollWidth:e.scrollWidth,clientWidth:e.clientWidth,text:e.innerText}};
      const container=document.querySelector('#rewardHandChoices'),back=document.querySelector('#ovRewardHands .dialogActions button');
      return {container:{...rect(container),scrollTop:container.scrollTop,scrollHeight:container.scrollHeight,clientHeight:container.clientHeight},
        back:rect(back),options:[...container.querySelectorAll('[data-hand]')].map(el=>({key:el.dataset.hand,
          ...rect(el),title:rect(el.querySelector('.handOptionTitle')),values:rect(el.querySelector('.handOptionValues')),
          cells:[...el.querySelectorAll('.handOptionValues>span')].map(rect)}))};
    }""")


def picker_values(options,level,issues):
    for option in options:
        key=option['key'];base,mult,inc_c,inc_m=HAND_RULES[key]
        expected=[level,level+2,base+(level-1)*inc_c,base+(level+1)*inc_c,
                  mult+(level-1)*inc_m,mult+(level+1)*inc_m]
        actual=[int(n) for n in re.findall(r'\d+',option['text'].replace(',',''))]
        if actual!=expected:issues.append({'requirement':'independent upgrade values','key':key,'expected':expected,'actual':actual,'text':option['text']})
        outer=option
        for part in [option['title'],option['values'],*option['cells']]:
            if (part['scrollWidth']>part['clientWidth']+1 or part['left']<outer['left']-1 or
                part['right']>outer['right']+1 or part['top']<outer['top']-1 or part['bottom']>outer['bottom']+1):
                issues.append({'requirement':'upgrade text fits option without clipping','key':key,'part':part,'option':outer})


def reward_picker(browser,url,out,seed,profile):
    spec=PROFILES[profile];mobile=spec['mobile'];context,page,errors=fresh(browser,seed,spec);issues=[]
    try:
        actual_boss=boss_cash(page,url,mobile);assert_viewport(page,spec['width'])
        screenshot(page,out,f'reward-{profile}-boss')
        press(page.locator('#rewardHand'),mobile);page.locator('#ovRewardHands').wait_for(state='visible')
        natural=picker_geometry(page)
        if len(natural['options'])!=9:
            issues.append({'requirement':'locked hand types remain unavailable','count':len(natural['options'])})
        picker_values(natural['options'],1,issues)
        screenshot(page,out,f'reward-{profile}-natural-list')
        page.keyboard.press('Escape');page.locator('#ovRewardHands').wait_for(state='hidden')
        page.wait_for_timeout(400)
        # Explicit fixture: unlock all hands and make their current levels 75.
        page.evaluate("""() => {for(const key of HORDER){S.playCounts[key]=Math.max(1,S.playCounts[key]);S.levels[key]=75;}
          renderBossReward();persistRun();}""")
        before=page.evaluate('() => ({money:S.money,level:S.levels.sf,reward:{...S.bossReward}})')
        press(page.locator('#rewardHand'),mobile);page.locator('#ovRewardHands').wait_for(state='visible')
        # Let the 150 ms entry-scale animation finish before comparing geometry.
        page.wait_for_timeout(220)
        top=picker_geometry(page);picker_values(top['options'],75,issues)
        if len(top['options'])!=12:issues.append({'requirement':'all unlocked hands appear','count':len(top['options'])})
        screenshot(page,out,f'reward-{profile}-high-list-top')
        bottom=page.locator("#rewardHandChoices [data-hand='sf']")
        swipes=scroll_down_until(page,page.locator('#rewardHandChoices'),bottom,mobile)
        if not center_hit(bottom)['visible']:issues.append({'requirement':'last hand selectable by internal scroll','swipes':swipes})
        scrolled=picker_geometry(page)
        if abs(top['back']['top']-scrolled['back']['top'])>1 or not center_hit(page.locator('#ovRewardHands .dialogActions button'))['visible']:
            issues.append({'requirement':'return action remains fixed and reachable while list scrolls','before':top['back'],'after':scrolled['back']})
        screenshot(page,out,f'reward-{profile}-high-list-bottom')
        key_trace=[]
        for key in ('Home','End','ArrowUp','ArrowDown'):
            page.keyboard.press(key)
            key_trace.append({'key':key,'focused':page.evaluate("() => document.activeElement.dataset.hand||null")})
        if [k['focused'] for k in key_trace]!=['five','sf','four','sf']:
            issues.append({'requirement':'Home/End and arrow keys move list focus without choosing','trace':key_trace})
        # Tab focus must remain on the active list modal.
        focus=[]
        for _ in range(15):
            page.keyboard.press('Tab');v=page.evaluate("() => ({id:document.activeElement.id,within:!!document.activeElement.closest('#ovRewardHands')})")
            focus.append(v)
            if not v['within']:issues.append({'requirement':'Tab cannot escape open hand picker','focus':v})
        page.keyboard.press('Escape');page.locator('#ovRewardHands').wait_for(state='hidden')
        if page.evaluate('() => S.bossReward.handKey')!=before['reward']['handKey']:
            issues.append({'requirement':'Escape closes without changing the selected hand'})
        page.wait_for_timeout(400);press(page.locator('#rewardHand'),mobile);page.locator('#ovRewardHands').wait_for(state='visible')
        native_back=page.evaluate('() => nativeBack()')
        page.locator('#ovRewardHands').wait_for(state='hidden')
        if native_back is not False:issues.append({'requirement':'native back bridge closes picker','result':native_back})
        page.wait_for_timeout(400);press(page.locator('#rewardHand'),mobile);page.locator('#ovRewardHands').wait_for(state='visible')
        bottom=page.locator("#rewardHandChoices [data-hand='sf']")
        swipes2=scroll_down_until(page,page.locator('#rewardHandChoices'),bottom,mobile)
        require(center_hit(bottom)['visible'],'last hand did not scroll into reachable area')
        double_at(page,bottom,mobile);page.locator('#ovRewardHands').wait_for(state='hidden')
        selected=page.evaluate('() => ({screen:S.screen,money:S.money,level:S.levels.sf,reward:{...S.bossReward}})')
        if selected['screen']!='cash' or selected['level']!=75 or selected['money']!=before['money'] or selected['reward']['handKey']!='sf':
            issues.append({'requirement':'selection and quick second tap do not claim reward','before':before,'after':selected})
        screenshot(page,out,f'reward-{profile}-selected')
        page.reload(wait_until='domcontentloaded');press(page.locator('#resumeBtn'),mobile);page.locator('#ovReward').wait_for(state='visible')
        resumed=page.evaluate('() => ({screen:S.screen,money:S.money,level:S.levels.sf,reward:{...S.bossReward}})')
        if resumed!=selected:issues.append({'requirement':'selected hand survives refresh before claiming','selected':selected,'resumed':resumed})
        require('同花顺' in page.locator('#rewardHand').inner_text(),'chosen hand label not restored')
        page.wait_for_timeout(400);double_at(page,page.locator("[data-reward='level']"),mobile)
        page.locator('#ovShop').wait_for(state='visible')
        claimed=page.evaluate('() => ({screen:S.screen,money:S.money,level:S.levels.sf,reward:S.bossReward})')
        if claimed!={'screen':'shop','money':before['money'],'level':77,'reward':None}:
            issues.append({'requirement':'double touch claims +2 exactly once','before':before,'claimed':claimed})
        reload_and_resume(page,mobile,'#ovShop')
        final=page.evaluate('() => ({screen:S.screen,money:S.money,level:S.levels.sf,reward:S.bossReward})')
        if final!=claimed:issues.append({'requirement':'claimed reward stays claimed after refresh','claimed':claimed,'resumed':final})
        require(not errors,f'page errors: {errors}')
        return {'status':'failed' if issues else 'passed','fixture':'real two skips, actual boss win with four aces assigned; all 12 hands and level 75 assigned for long list; UI actions by touch/mouse, nativeBack bridge simulated',
                'boss':actual_boss,'natural':natural,'high_top':top,'high_bottom':scrolled,'swipes':swipes,'swipes_after_reopen':swipes2,
                'key_trace':key_trace,'focus_trace':focus,'selected':selected,'resumed':resumed,'claimed':claimed,'final':final,'issues':issues,'page_errors':errors}
    except Exception:
        try:screenshot(page,out,f'reward-{profile}-failure')
        except Exception:pass
        raise
    finally:context.close()


def audit_dialog(page,selector,action,profile,out,issues,label):
    """Check actual fixed-action visibility before any auto-scroll and save a screenshot."""
    page.locator(selector).wait_for(state='visible');page.wait_for_timeout(200)
    measure=page.evaluate("""([overlay,button]) => {
      const root=document.querySelector(overlay),box=root.querySelector('.box'),act=root.querySelector(button);
      const body=root.querySelector('.dialogBody,.tacticsBody,#packCards');
      const rect=e=>{if(!e)return null;const r=e.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,
        width:r.width,height:r.height,clientWidth:e.clientWidth,scrollWidth:e.scrollWidth,clientHeight:e.clientHeight,scrollHeight:e.scrollHeight}};
      const reach=e=>{if(!e)return false;const r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
        const h=x>=0&&x<innerWidth&&y>=0&&y<innerHeight?document.elementFromPoint(x,y):null;return !!h&&(h===e||e.contains(h));};
      return {viewport:[innerWidth,innerHeight],box:rect(box),action:rect(act),body:rect(body),hit:reach(act)};
    }""",[selector,action])
    screenshot(page,out,f'{profile}-{label}')
    a=measure['action'];b=measure['box'];w,h=measure['viewport']
    if not a or a['left']<-1 or a['top']<-1 or a['right']>w+1 or a['bottom']>h+1 or not measure['hit']:
        issues.append({'requirement':'dialog action is visible and touchable','dialog':selector,'measurement':measure})
    if b and (b['left']<-1 or b['top']<-1 or b['right']>w+1 or b['bottom']>h+1):
        issues.append({'requirement':'dialog fits viewport','dialog':selector,'measurement':measure})
    if measure['body'] and measure['body']['scrollWidth']>measure['body']['clientWidth']+1:
        issues.append({'requirement':'dialog body has no horizontal clipping','dialog':selector,'measurement':measure})
    return measure


def surface_traversal(browser,url,out,seed,profile):
    spec=PROFILES[profile];mobile=spec['mobile'];context,page,errors=fresh(browser,seed,spec);issues=[];layouts={}
    def tap(selector):press(page.locator(selector),mobile)
    def inspect(selector,action,label):layouts[label]=audit_dialog(page,selector,action,profile,out,issues,label)
    def menu():tap('#menuBtn');page.locator('#ovMenu').wait_for(state='visible')
    try:
        page.goto(url,wait_until='domcontentloaded');assert_viewport(page,spec['width'])
        screenshot(page,out,f'{profile}-title')
        tap('#newBtn');inspect('#ovSetup','#beginRunBtn','setup')
        require(page.locator('#deckChoices button').count()==5,'five deck choices missing')
        tap('#beginRunBtn');inspect('#ovBlinds','#tacticsEntry','blind-select')
        tap('#tacticsEntry');inspect('#ovTactics','button[onclick="hide(\'ovTactics\')"]','tactics')
        press(page.locator('#rhythmChoices [data-rhythm="none"]'),mobile)
        press(page.locator('#ovTactics button').filter(has_text='完成备战'),mobile)
        press(page.locator('#blindCols .cur .bbtn:not(.skip)'),mobile)
        page.locator('#handRow .card').first.wait_for(state='visible');screenshot(page,out,f'{profile}-table')
        tap('#reserveBtn');inspect('#ovReserve','button[onclick="closeReserve()"]','reserve')
        tap('#ovReserve button[onclick="closeReserve()"]');page.wait_for_timeout(400)
        menu();inspect('#ovMenu','.dialogActions button','menu')
        speeds=[]
        for speed in ('1','2','4','0'):
            button=page.locator(f'#speedOptions [data-speed="{speed}"]');press(button,mobile)
            speeds.append({'speed':speed,'pressed':button.get_attribute('aria-pressed')})
            if speeds[-1]['pressed']!='true':issues.append({'requirement':'speed button becomes selected','speed':speed})
        press(page.locator('#ovMenu .dialogActions button'),mobile)
        panels=[('牌型与等级','#ovChart','#chartBody','chart'),('剩余牌库','#ovDeck','#deckGrid','deck'),
                ('本局信息','#ovInfo','#infoBody','info'),('图鉴与记录','#ovCollection','#collectionBody','collection')]
        for name,overlay,body,label in panels:
            menu();press(page.locator('#ovMenu .menuList button').filter(has_text=name),mobile)
            inspect(overlay,'.dialogActions button',label)
            if label=='chart':
                if page.locator('#chartBody .handLedgerRow').count()!=12:issues.append({'requirement':'all 12 chart rows displayed'})
            elif label=='deck':
                for suit in ('0','1','2','3'):
                    button=page.locator(f'#deckSuitFilters [data-suit="{suit}"]');press(button,mobile)
                    if button.get_attribute('aria-pressed')!='true' or page.locator('#deckGrid .deckSuitBlock').count()!=1 or page.locator('#deckGrid .deckCell').count()!=13:
                        issues.append({'requirement':'deck suit filter has 13 cards of chosen suit','suit':suit})
                screenshot(page,out,f'{profile}-deck-filtered')
            elif label=='info':
                if page.locator('#infoBody .runMetrics > div').count()<10:issues.append({'requirement':'run metrics rendered'})
            else:
                for tab in ('小丑','塔罗','星球','Boss','通关'):
                    press(page.locator('#collectionTabs button').filter(has_text=tab),mobile)
                if page.locator('#collectionBody .recordTable').count()!=1:issues.append({'requirement':'collection records available'})
                screenshot(page,out,f'{profile}-collection-records')
            press(page.locator(overlay+' .dialogActions button'),mobile)
        menu();press(page.locator('#returnTitleBtn'),mobile);page.locator('#ovStart').wait_for(state='visible')
        require(page.locator('#resumeBtn').is_visible(),'title did not show continue')
        screenshot(page,out,f'{profile}-title-continue')
        press(page.locator('#newBtn'),mobile);page.locator('#ovSetup').wait_for(state='visible')
        press(page.locator('#beginRunBtn'),mobile)
        inspect('#ovRestart','.dialogActions button:first-child','restart-confirm')
        press(page.locator('#ovRestart .dialogActions button').first,mobile)
        page.locator('#ovStart').wait_for(state='visible')
        press(page.locator('#resumeBtn'),mobile);page.locator('#handRow .card').first.wait_for(state='visible')
        menu()
        if page.locator('#speedOptions [data-speed="0"]').get_attribute('aria-pressed')!='true':
            issues.append({'requirement':'speed setting remains selected after title and resume'})
        press(page.locator('#ovMenu .dialogActions button'),mobile)
        plays=[]
        for _ in range(4):
            plays.append(play_best_first_blind(page,mobile))
            if page.locator('#ovCash').is_visible():break
            require(not page.locator('#ovOver').is_visible(),'seeded first blind lost')
        inspect('#ovCash','.dialogActions button','cash')
        press(page.locator('#ovCash .dialogActions button'),mobile);page.locator('#ovShop').wait_for(state='visible')
        page.evaluate("""() => {S.jokers=[];addJoker(JDEFS.find(j=>j.id==='joker'));
          S.cons=[{...TAROTS.find(t=>t.id==='magician'),kind:'tarot',price:3}];S.workshopCredits=2;renderShop();persistRun();}""")
        tabs=[]
        for tab in ('Cards','Cons','Packs','Voucher','Workshop'):
            button=page.locator('#shopTab'+tab);assert_reachable(button,'shop tab '+tab);press(button,mobile)
            tabs.append({'tab':tab,'selected':button.get_attribute('aria-selected')})
            if tabs[-1]['selected']!='true':issues.append({'requirement':'shop category selects','tab':tab})
            screenshot(page,out,f'{profile}-shop-{tab.lower()}')
        press(page.locator('#shopWorkshop [data-service="copy"]'),mobile)
        page.locator('#ovWorkshop').wait_for(state='visible')
        filters=[]
        for suit in ('all','0','1','2','3'):
            button=page.locator(f'#workshopSuit [data-suit="{suit}"]');press(button,mobile)
            count=page.locator('#workshopCards .card').count()
            filters.append({'suit':suit,'count':count,'pressed':button.get_attribute('aria-pressed')})
            if button.get_attribute('aria-pressed')!='true' or count!=(52 if suit=='all' else 13):
                issues.append({'requirement':'workshop suit buttons filter cards','actual':filters[-1]})
        inspect('#ovWorkshop','.workshopActions button:first-child','workshop-picker')
        press(page.locator('#ovWorkshop button[onclick="closeWorkshop()"]'),mobile);page.wait_for_timeout(400)
        for kind in ('joker','cons'):
            press(page.locator(f"#shopOwned .ownedItem[data-kind='{kind}']").first,mobile)
            inspect('#ovOwned','.dialogActions button','owned-'+kind)
            press(page.locator('#ovOwned .dialogActions button'),mobile);page.wait_for_timeout(400)
        tap('#shopTabPacks');money=page.evaluate('() => S.money')
        press(page.locator('#shopPacks .shopItem').first,mobile)
        inspect('#ovPack','button[onclick="closePack()"]','pack')
        press(page.locator('#ovPack button[onclick="closePack()"]'),mobile);page.wait_for_timeout(400)
        if page.evaluate('() => S.money')!=money:issues.append({'requirement':'pack cancel refunds'})
        press(page.locator('#ovShop button[onclick="leaveShop()"]'),mobile)
        press(page.locator('#blindCols .cur .bbtn:not(.skip)'),mobile)
        page.locator('#handRow .card').first.wait_for(state='visible')
        page.evaluate('() => {S.target=1000000000;S.handsLeft=1;renderAll();}')
        press(page.locator('#handRow .card').first,mobile);press(page.locator('#btnPlay'),mobile)
        page.locator('#ovOver').wait_for(state='visible',timeout=20000)
        inspect('#ovOver','.dialogActions button','loss')
        require(not errors,f'page errors: {errors}')
        return {'status':'failed' if issues else 'passed','fixture':'normal new game, actual first-blind win and most navigation by touch/mouse; shop inventory/credits and one-hand loss directly assigned',
                'layouts':layouts,'speeds':speeds,'plays':plays,'shop_tabs':tabs,'workshop_filters':filters,'issues':issues,'page_errors':errors}
    except Exception:
        try:screenshot(page,out,f'{profile}-surface-failure')
        except Exception:pass
        raise
    finally:context.close()


def dense_table(browser,url,out,seed,profile):
    spec=PROFILES[profile];mobile=spec['mobile'];context,page,errors=fresh(browser,seed,spec);issues=[]
    try:
        page.goto(url,wait_until='domcontentloaded');start_blind(page,mobile)
        page.evaluate("""() => {S.handSize=10;while(S.hand.length<10)S.hand.push(S.drawPile.pop());
          S.jokerSlots=6;S.jokers=[];JDEFS.slice(0,6).forEach(addJoker);
          S.consSlots=3;S.cons=TAROTS.slice(0,3).map(t=>({...t,kind:'tarot',price:3}));
          S.blindIdx=2;S.boss=BOSSES.find(b=>b.id==='hook');S.anteBoss=S.boss;
          S.rhythmMode='focus';S.rhythm={lastKey:'pair',chain:3};
          S.contract={id:'variety',discards:0,settled:false};S.blindPlayed=['high','pair'];
          S.target=99999999;S.score=12345678;renderAll();}""")
        geometry=page.evaluate("""() => {
          const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom}};
          const hit=e=>{const r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
            const h=x>=0&&x<innerWidth&&y>=0&&y<innerHeight?document.elementFromPoint(x,y):null;return !!h&&(h===e||e.contains(h));};
          return Object.fromEntries(['#bossDesc','#tacticsStatus','#reserveBtn','#handRow','#btnPlay','#btnDiscard','#targetVal','#scoreVal']
            .map(s=>[s,{...rect(document.querySelector(s)),hit:hit(document.querySelector(s))}]));
        }""")
        screenshot(page,out,f'{profile}-dense-table')
        a,b=geometry['#bossDesc'],geometry['#tacticsStatus']
        overlap=max(0,min(a['right'],b['right'])-max(a['left'],b['left']))*max(0,min(a['bottom'],b['bottom'])-max(a['top'],b['top']))
        if overlap>1:issues.append({'requirement':'boss description and tactics status do not overlap','area':overlap})
        for selector in ('#reserveBtn','#btnPlay','#btnDiscard','#targetVal','#scoreVal'):
            r=geometry[selector]
            if r['left']<0 or r['top']<0 or r['right']>spec['width'] or r['bottom']>spec['height'] or not r['hit']:
                issues.append({'requirement':'dense controls and score remain visible','element':selector,'rect':r})
        press(page.locator('#handRow .card').first,mobile)
        if not page.locator('#btnPlay').is_enabled():issues.append({'requirement':'dense hand supports actual selection'})
        require(not errors,f'page errors: {errors}')
        return {'status':'failed' if issues else 'passed','fixture':'normal blind, then 10 cards, 6 jokers/3 consumables, boss/tactics and high scores assigned; actual selection',
                'geometry':geometry,'issues':issues,'page_errors':errors}
    finally:context.close()


def boss_toast(browser,url,out,seed):
    context,page,errors=fresh(browser,seed,PROFILES['landscape']);issues=[]
    try:
        boss=boss_cash(page,url,True)
        before=page.evaluate("() => ({text:document.querySelector('#infobar').innerText,cls:document.querySelector('#infobar').className})")
        page.locator('#rewardHand').tap();page.locator('#ovRewardHands').wait_for(state='visible')
        page.wait_for_timeout(200)
        message=page.evaluate("""() => ({text:document.querySelector('#infobar').innerText,cls:document.querySelector('#infobar').className,
          z:getComputedStyle(document.querySelector('#infobar')).zIndex})""")
        back=page.locator('#ovRewardHands .dialogActions button')
        screenshot(page,out,'boss-toast-landscape-picker')
        if message['cls'] or message['z']!='6' or not center_hit(back)['visible']:
            issues.append({'requirement':'prior boss toast does not cover fixed return','before':before,'message':message,'hit':center_hit(back)})
        back.tap();page.locator('#ovRewardHands').wait_for(state='hidden')
        if not page.locator('#ovReward').is_visible():issues.append({'requirement':'return restores reward'})
        require(not errors,f'page errors: {errors}')
        return {'status':'failed' if issues else 'passed','fixture':'actual two skips and boss score with four aces assigned; immediate reward picker and back by touch',
                'boss':boss,'before':before,'message':message,'issues':issues,'page_errors':errors}
    finally:context.close()


def victory_screen(browser,url,out,seed,profile):
    spec=PROFILES[profile];mobile=spec['mobile'];context,page,errors=fresh(browser,seed,spec);issues=[]
    try:
        page.goto(url,wait_until='domcontentloaded');start_blind(page,mobile)
        page.evaluate("""() => {S.ante=8;S.blindIdx=2;S.boss=BOSSES.find(b=>b.id==='hook');S.anteBoss=S.boss;
          S.target=1;S.score=0;renderAll();}""")
        press(page.locator('#handRow .card').first,mobile);press(page.locator('#btnPlay'),mobile)
        page.locator('#ovWin').wait_for(state='visible',timeout=20000)
        layout=audit_dialog(page,'#ovWin','.dialogActions button:first-child',profile,out,issues,'victory')
        second=page.locator('#ovWin .dialogActions button').nth(1)
        if not center_hit(second)['visible']:issues.append({'requirement':'victory restart visible and touchable'})
        require(not errors,f'page errors: {errors}')
        return {'status':'failed' if issues else 'passed','fixture':'normal blind; ante 8 boss and target 1 assigned; actual play triggers victory',
                'layout':layout,'issues':issues,'page_errors':errors}
    finally:context.close()


def multiplayer_layout(browser,url,out,seed,profile):
    spec=PROFILES[profile];mobile=spec['mobile']
    contexts=[context_for(browser,spec,seed+i) for i in range(2)];host,guest=[c.new_page() for c in contexts]
    errors=[watch_page(p) for p in (host,guest)];issues=[];layouts={}
    try:
        for page,name in ((host,'甲'),(guest,'乙')):
            page.goto(url,wait_until='domcontentloaded')
            press(page.locator('#ovStart button[onclick="openMpLobby()"]'),mobile)
            page.locator('#ovMpLobby').wait_for(state='visible')
            page.locator('#mpName').fill(name);page.locator('#mpServer').fill(url)
        layouts['lobby']=audit_dialog(host,'#ovMpLobby','.dialogActions button',profile,out,issues,'multiplayer-lobby')
        press(host.locator('#mpCreateBtn'),mobile)
        host.wait_for_function("() => /房间码\\s*[A-Z2-9]{4}/.test(document.querySelector('#mpStatus').textContent)",timeout=10000)
        match=re.search(r'房间码\s*([A-Z2-9]{4})',host.locator('#mpStatus').inner_text());require(match,'room code missing')
        code=match.group(1);guest.locator('#mpCode').fill(code);press(guest.locator('#mpJoinBtn'),mobile)
        for page in (host,guest):page.locator('#ovBlinds').wait_for(state='visible',timeout=15000)
        press(host.locator('#blindCols .cur .bbtn:not(.skip)'),mobile);host.locator('#handRow .card').first.wait_for(state='visible')
        press(host.locator('#menuBtn'),mobile);press(host.locator('#returnTitleBtn'),mobile)
        layouts['leave']=audit_dialog(host,'#ovLeave','.dialogActions button:first-child',profile,out,issues,'leave-confirm')
        press(host.locator('#ovLeave .dialogActions button').first,mobile)
        if not host.locator('#ovMenu').is_visible():press(host.locator('#menuBtn'),mobile)
        press(host.locator('#returnTitleBtn'),mobile)
        host.locator('#ovLeave').wait_for(state='visible');press(host.locator('#confirmLeave'),mobile)
        guest.locator('#ovMpRes').wait_for(state='visible',timeout=10000)
        layouts['result']=audit_dialog(guest,'#ovMpRes','#mpResBtn',profile,out,issues,'multiplayer-result')
        if not guest.evaluate('() => MP.over'):issues.append({'requirement':'opponent sees result after confirmed leave'})
        require(not any(errors),f'page errors: {errors}')
        return {'status':'failed' if issues else 'passed','fixture':'two isolated real clients on local relay, actual lobby, cancel/confirm leave and opponent result',
                'layouts':layouts,'issues':issues,'page_errors':errors}
    except Exception:
        try:screenshot(host,out,f'{profile}-multiplayer-host-failure');screenshot(guest,out,f'{profile}-multiplayer-guest-failure')
        except Exception:pass
        raise
    finally:
        for context in contexts:context.close()


def restart_confirmation(browser,url,out,seed,profile):
    spec=PROFILES[profile];mobile=spec['mobile'];context,page,errors=fresh(browser,seed,spec);issues=[]
    try:
        page.goto(url,wait_until='domcontentloaded');start_blind(page,mobile)
        before=page.evaluate('() => ({money:S.money,hand:S.hand.map(c=>c.id),hands:S.handsLeft,discards:S.discLeft})')
        press(page.locator('#menuBtn'),mobile);press(page.locator('#returnTitleBtn'),mobile)
        page.locator('#ovStart').wait_for(state='visible');press(page.locator('#newBtn'),mobile)
        page.locator('#ovSetup').wait_for(state='visible');press(page.locator('#beginRunBtn'),mobile)
        layout=audit_dialog(page,'#ovRestart','.dialogActions button:first-child',profile,out,issues,'restart-confirm')
        confirm=page.locator('#confirmNew')
        if not center_hit(confirm)['visible']:issues.append({'requirement':'confirm restart is fully reachable'})
        press(page.locator('#ovRestart .dialogActions button').first,mobile)
        page.locator('#ovStart').wait_for(state='visible');press(page.locator('#resumeBtn'),mobile)
        page.locator('#handRow .card').first.wait_for(state='visible')
        after=page.evaluate('() => ({money:S.money,hand:S.hand.map(c=>c.id),hands:S.handsLeft,discards:S.discLeft})')
        if before!=after:issues.append({'requirement':'cancel restart preserves saved run','before':before,'after':after})
        require(not errors,f'page errors: {errors}')
        return {'status':'failed' if issues else 'passed','fixture':'normal new game, menu to title, actual restart confirmation then cancel and resume',
                'before':before,'after':after,'layout':layout,'issues':issues,'page_errors':errors}
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
                cases={**{f'reward_{name}':(lambda n=name:reward_picker(browser,url,args.output_dir,args.seed,n)) for name in PROFILES},
                       **{f'surfaces_{name}':(lambda n=name:surface_traversal(browser,url,args.output_dir,args.seed,n)) for name in PROFILES},
                       **{f'dense_{name}':(lambda n=name:dense_table(browser,url,args.output_dir,args.seed,n)) for name in PROFILES},
                       'boss_toast':lambda:boss_toast(browser,url,args.output_dir,args.seed),
                       **{f'victory_{name}':(lambda n=name:victory_screen(browser,url,args.output_dir,args.seed,n)) for name in PROFILES},
                       **{f'multiplayer_{name}':(lambda n=name:multiplayer_layout(browser,url,args.output_dir,args.seed,n)) for name in PROFILES},
                       **{f'restart_{name}':(lambda n=name:restart_confirmation(browser,url,args.output_dir,args.seed,n)) for name in PROFILES}}
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
