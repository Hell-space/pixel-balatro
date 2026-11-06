"""Real-touch visual/animation checks in an isolated headless Quark context.

    python tests/browser_motion.py --output-dir .qa/motion
    python tests/browser_motion.py --output-dir .qa/motion --only focused_ghost --only reduced
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
from browser_extended import enter_shop, start_server
from browser_smoke import (ROOT, cards_on_screen, context_for, read_number, require,
                           score_unmodified_hand, select_shop_tab, start_blind, watch_page)

if hasattr(sys.stdout,"reconfigure"):
    sys.stdout.reconfigure(errors="backslashreplace")

PROFILE={"width":390,"height":844,"mobile":True}


def shot(page,out,name):
    # Keep finite animations running; the regular smoke screenshot helper
    # intentionally disables them, which would erase a genuine middle frame.
    page.screenshot(path=str(out/(name+".png")),full_page=False,animations="allow")


def anims(page,selector):
    return page.evaluate("""selector => [...document.querySelectorAll(selector)].map(el=>({
      tag:el.tagName,id:el.id,classes:el.className,opacity:getComputedStyle(el).opacity,
      transform:getComputedStyle(el).transform,animations:el.getAnimations().map(a=>({
        state:a.playState,currentTime:a.currentTime,duration:a.effect.getTiming().duration}))}))""",selector)


def dialog_hit(page,selector):
    return page.locator(selector).evaluate("""el=>{
      const ov=el.closest('.ov'),r=el.getBoundingClientRect();
      const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
      return {top:activeDialog()?.id,overlay:ov.id,z:getComputedStyle(ov).zIndex,
        receives:!!hit&&(hit===el||el.contains(hit)||ov.contains(hit)),
        hit:hit?{id:hit.id,tag:hit.tagName,classes:hit.className}:null};
    }""")


def live_motion(browser,url,out,seed):
    context=context_for(browser,PROFILE,seed)
    page=context.new_page()
    errors=watch_page(page)
    data={"fixture":"normal 1x red/white first blind; real touch; audio disabled"}
    try:
        page.goto(url,wait_until="domcontentloaded")
        page.locator("#ovStart").wait_for(state="visible")
        shot(page,out,"title")
        page.locator("#ovStart .collectionLink").tap()
        page.locator("#ovCollection").wait_for(state="visible")
        page.wait_for_timeout(180)
        data["title_collection_hit"]=dialog_hit(page,"#ovCollection h2")
        require(data["title_collection_hit"]["top"]=="ovCollection" and data["title_collection_hit"]["receives"],
                "title collection dialog is behind another overlay")
        shot(page,out,"title-collection")
        page.locator('#ovCollection button[onclick="hide(\'ovCollection\')"]').tap()
        start_blind(page,True)
        require(page.evaluate("() => settings.speed===1 && !document.hidden && motionAllowed(true)"),
                "1x animations are not active in this browser context")
        cards=cards_on_screen(page)
        canonical=page.evaluate("() => S.hand.map(c=>[c.rank,SUITS[c.suit]])")
        require([list(c) for c in cards]==canonical,f"SVG suit text differs from game state: {cards} / {canonical}")
        data["suit_text_matches_cards"]=cards
        page.locator("#menuBtn").tap()
        page.locator("#ovMenu").wait_for(state="visible")
        page.wait_for_timeout(180)
        data["menu_hit"]=dialog_hit(page,"#ovMenu h2")
        require(data["menu_hit"]["top"]=="ovMenu" and data["menu_hit"]["receives"],"menu not visually on top")
        shot(page,out,"table-menu")
        page.locator('#ovMenu button[onclick="hide(\'ovMenu\')"]').tap()

        first=page.locator("#handRow .card").first
        old_color=first.evaluate("el => getComputedStyle(el).color")
        first.tap()
        page.wait_for_timeout(35)
        data["selection_animation"]=anims(page,"#handRow .card.sel")
        shot(page,out,"selection-mid")
        page.locator("#btnDiscard").tap()
        page.locator("#feedbackLayer .discardGhost").first.wait_for(state="attached",timeout=1500)
        page.wait_for_timeout(45)
        data["discard_animation"]=anims(page,"#feedbackLayer .discardGhost")
        data["discard_color"]={"original":old_color,
            "ghost":page.locator("#feedbackLayer .discardGhost").first.evaluate("el=>getComputedStyle(el).color")}
        require(any(a["animations"] for a in data["discard_animation"]),"no running discard animation")
        shot(page,out,"discard-mid")
        page.wait_for_timeout(400)
        require(page.locator("#feedbackLayer .discardGhost").count()==0,"discard ghost remained")

        selected=cards_on_screen(page)[:2]
        expected,name,_,_=score_unmodified_hand(selected)
        page.locator("#handRow .card").nth(0).tap()
        page.locator("#handRow .card").nth(1).tap()
        require(read_number(page,"#scoreEstimate")==expected,"preview does not match independent score")
        require(page.locator("#prevName").inner_text().strip()==name,"hand name mismatch")
        shot(page,out,"two-selected")
        page.locator("#btnPlay").tap()
        page.locator("#playedRow .card").first.wait_for(state="attached",timeout=1500)
        page.wait_for_timeout(40)
        data["played_animation"]=anims(page,"#playedRow .card")
        require(any(x["animations"] for x in data["played_animation"]),"no running played-card flight")
        shot(page,out,"played-mid")
        page.locator("#feedbackLayer .flyingChip").first.wait_for(state="attached",timeout=2500)
        page.wait_for_timeout(35)
        data["chip_animation"]=anims(page,"#feedbackLayer .flyingChip")
        require(any(x["animations"] for x in data["chip_animation"]),"no running chip flight")
        shot(page,out,"scoring-chip-mid")
        page.wait_for_function("() => S && !S.busy && S.score>0",timeout=15000)
        actual=read_number(page,"#scoreVal")
        require(actual==expected,f"actual {actual} differs from independent preview {expected}")
        page.wait_for_timeout(1000)
        residual=page.locator("#feedbackLayer > *").count()
        require(residual==0,f"{residual} feedback ghosts remained after scoring")
        data["score"]={"cards":selected,"hand":name,"independent_preview":expected,"actual":actual,"remaining_ghosts":residual}
        data["page_errors"]=errors
        require(not errors,f"page errors: {errors}")
        data["status"]="passed"
        return data
    except Exception as error:
        data["status"]="failed";data["error"]=f"{type(error).__name__}: {error}"
        data["traceback"]=traceback.format_exc()
        shot(page,out,"motion-failure")
        return data
    finally:
        context.close()


def shop_motion(browser,url,out,seed):
    context=context_for(browser,PROFILE,seed)
    page=context.new_page()
    errors=watch_page(page)
    data={"fixture":"real first blind, actual shop purchase and pack cancel"}
    try:
        data["plays"]=enter_shop(page,url,True)
        money=read_number(page,"#shopMoney")
        cards=page.locator("#shopItems .shopItem")
        choices=[]
        for i in range(2):
            text=cards.nth(i).locator('.pr').inner_text()
            m=re.search(r'\d+',text)
            price=0 if '免费' in text else int(m.group())
            if price<=money: choices.append((i,price,cards.nth(i).locator('.nm').inner_text()))
        require(choices,"no affordable first-shop joker")
        i,price,name=choices[0]
        cards.nth(i).tap()
        page.locator('#feedbackLayer .acquiredCard').first.wait_for(state='attached',timeout=1500)
        page.wait_for_timeout(60)
        data["purchase_animation"]=anims(page,'#feedbackLayer .acquiredCard')
        require(any(x['animations'] for x in data['purchase_animation']),"no running purchase animation")
        require(read_number(page,'#shopMoney')==money-price,"purchase money wrong")
        shot(page,out,'purchase-mid')
        page.wait_for_timeout(600)
        require(page.locator('#feedbackLayer .acquiredCard').count()==0,"purchase ghost remained")
        select_shop_tab(page,'packs',True)
        packs=page.locator('#shopPacks .shopItem')
        available=[]
        remaining=read_number(page,'#shopMoney')
        for n in range(packs.count()):
            m=re.search(r'\d+',packs.nth(n).locator('.pr').inner_text())
            if m and int(m.group())<=remaining: available.append(n)
        require(available,"no affordable pack after purchase")
        packs.nth(available[0]).tap()
        page.locator('#ovPack').wait_for(state='visible')
        page.wait_for_timeout(180)
        data['pack_hit']=dialog_hit(page,'#packTitle')
        data['pack_stack']=page.evaluate("() => ({shop:getComputedStyle(document.querySelector('#ovShop')).zIndex,pack:getComputedStyle(document.querySelector('#ovPack')).zIndex})")
        require(data['pack_hit']['top']=='ovPack' and data['pack_hit']['receives'] and
                int(data['pack_stack']['pack'])>int(data['pack_stack']['shop']),"pack overlay is not above shop")
        shot(page,out,'shop-pack')
        page.locator('#ovPack button[onclick="closePack()"]',).tap()
        page.locator('#ovPack').wait_for(state='hidden')
        require(read_number(page,'#shopMoney')==remaining,"pack cancellation did not refund")
        data.update({"purchase":{"name":name,"price":price},"page_errors":errors,"status":"passed"})
        require(not errors,f"page errors: {errors}")
        return data
    except Exception as error:
        data['status']='failed';data['error']=f"{type(error).__name__}: {error}"
        data['traceback']=traceback.format_exc()
        shot(page,out,'shop-motion-failure')
        return data
    finally:
        context.close()


def no_motion(browser,url,out,seed,mode):
    context=context_for(browser,PROFILE,seed)
    page=context.new_page()
    errors=watch_page(page)
    data={"fixture":"normal first blind and real touch", "mode":mode}
    try:
        if mode=='reduced': page.emulate_media(reduced_motion='reduce')
        page.goto(url,wait_until='domcontentloaded')
        start_blind(page,True)
        if mode=='instant':
            page.locator('#menuBtn').tap()
            page.locator('#speedSelect').select_option('0')
            page.locator('#ovMenu button[onclick="hide(\'ovMenu\')"]').tap()
        require(not page.evaluate('() => motionAllowed(true)'),f'{mode} did not disable scoring effects')
        page.locator('#handRow .card').first.tap()
        page.locator('#btnDiscard').tap()
        require(page.locator('#feedbackLayer .discardGhost').count()==0,f'{mode} created a discard ghost')
        selected=cards_on_screen(page)[:2]
        expected,_,_,_=score_unmodified_hand(selected)
        page.locator('#handRow .card').nth(0).tap()
        page.locator('#handRow .card').nth(1).tap()
        require(read_number(page,'#scoreEstimate')==expected,'no-motion preview mismatch')
        page.locator('#btnPlay').tap()
        page.wait_for_function('() => S && !S.busy && S.score>0',timeout=5000)
        require(read_number(page,'#scoreVal')==expected,'no-motion score mismatch')
        page.wait_for_timeout(400)
        ghosts=page.locator('#feedbackLayer > *').count()
        require(ghosts==0,f'{mode} left {ghosts} feedback ghosts')
        shot(page,out,f'{mode}-completed')
        require(not errors,f'page errors: {errors}')
        data.update({'status':'passed','score':expected,'remaining_ghosts':ghosts,'page_errors':errors})
        return data
    except Exception as error:
        data['status']='failed';data['error']=f'{type(error).__name__}: {error}'
        data['traceback']=traceback.format_exc()
        shot(page,out,f'{mode}-failure')
        return data
    finally:
        context.close()


def focused_ghost(browser,url,out,seed):
    context=context_for(browser,PROFILE,seed)
    page=context.new_page()
    errors=watch_page(page)
    data={"fixture":"normal red/white first blind; actual red and black discards, then 1x play"}
    try:
        page.goto(url,wait_until='domcontentloaded')
        start_blind(page,True)
        require(page.evaluate("() => settings.speed===1 && motionAllowed(true)"),'1x animation is not active')
        discards=[]
        for color in ('red','blk'):
            card=page.locator('#handRow .card.'+color).first
            card.wait_for(state='visible')
            original=card.evaluate("el=>({color:getComputedStyle(el).color,classes:el.className,label:el.getAttribute('aria-label')})")
            card.tap()
            page.locator('#btnDiscard').tap()
            ghost=page.locator('#feedbackLayer .discardGhost').first
            ghost.wait_for(state='attached',timeout=1500)
            page.wait_for_timeout(35)
            info=ghost.evaluate("""el=>({color:getComputedStyle(el).color,classes:el.className,
              tabIndex:el.tabIndex,animations:el.getAnimations().map(a=>({state:a.playState,
              currentTime:a.currentTime,duration:a.effect.getTiming().duration}))})""")
            require(info['color']==original['color'],f'{color} ghost lost original color: {original} -> {info}')
            require(color in info['classes'].split() and 'sel' not in info['classes'].split() and
                    'dealt' not in info['classes'].split() and info['tabIndex']==-1,
                    f'{color} ghost has incorrect classes/focus: {info}')
            require(any(a['state']=='running' for a in info['animations']),f'{color} ghost was not animated')
            shot(page,out,color+'-discard-mid')
            page.wait_for_timeout(450)
            require(page.locator('#feedbackLayer .discardGhost').count()==0,f'{color} ghost remained')
            discards.append({'original':original,'ghost':info})
        require(read_number(page,'#discVal')==2,'two discards did not consume two uses')
        selected=cards_on_screen(page)[:2]
        expected,hand,_,_=score_unmodified_hand(selected)
        page.locator('#handRow .card').nth(0).tap()
        page.locator('#handRow .card').nth(1).tap()
        require(read_number(page,'#scoreEstimate')==expected,'preview mismatch after discards')
        page.locator('#btnPlay').tap()
        page.locator('#playedRow .card').first.wait_for(state='attached',timeout=1500)
        page.wait_for_timeout(40)
        flying=anims(page,'#playedRow .card')
        require(any(x['animations'] for x in flying),'1x played cards did not animate')
        shot(page,out,'focused-play-mid')
        page.wait_for_function('() => S && !S.busy && S.score>0',timeout=15000)
        actual=read_number(page,'#scoreVal')
        require(actual==expected,f'actual score {actual} != preview {expected}')
        page.wait_for_timeout(1000)
        require(page.locator('#feedbackLayer > *').count()==0,'feedback ghosts remained after scoring')
        require(not errors,f'page errors: {errors}')
        data.update({'status':'passed','discards':discards,'selected':selected,'hand':hand,
                     'independent_preview':expected,'actual':actual,'remaining_ghosts':0,
                     'play_animation':flying,'page_errors':errors})
        return data
    except Exception as error:
        data['status']='failed';data['error']=f'{type(error).__name__}: {error}'
        data['traceback']=traceback.format_exc()
        shot(page,out,'focused-ghost-failure')
        return data
    finally:
        context.close()


def main():
    p=argparse.ArgumentParser();p.add_argument('--browser',default=r'D:\Quark\quark.exe')
    p.add_argument('--app-dir',type=Path,default=ROOT);p.add_argument('--output-dir',type=Path,required=True)
    p.add_argument('--seed',type=int,default=1);p.add_argument('--only',action='append');args=p.parse_args()
    args.app_dir=args.app_dir.resolve();args.output_dir=args.output_dir.resolve()
    args.output_dir.mkdir(parents=True,exist_ok=True)
    raw=(args.app_dir/'balatro.html').read_bytes()
    result={'app_dir':str(args.app_dir),'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'cases':{}}
    process,url=start_server(args.app_dir)
    try:
        with sync_playwright() as pw:
            browser=pw.chromium.launch(executable_path=args.browser,headless=True,
                args=['--disable-extensions','--disable-background-networking'])
            try:
                cases={'live_motion':lambda:live_motion(browser,url,args.output_dir,args.seed),
                       'shop_motion':lambda:shop_motion(browser,url,args.output_dir,args.seed),
                       'reduced':lambda:no_motion(browser,url,args.output_dir,args.seed,'reduced'),
                       'instant':lambda:no_motion(browser,url,args.output_dir,args.seed,'instant'),
                       'focused_ghost':lambda:focused_ghost(browser,url,args.output_dir,args.seed)}
                require(not args.only or not (set(args.only)-set(cases)),f'unknown cases: {args.only}')
                for name,run in cases.items():
                    if args.only and name not in args.only: continue
                    data=run();result['cases'][name]=data
                    print(name.upper()+' '+data['status']+' '+data.get('error',''),flush=True)
            finally:
                browser.close()
    finally:
        process.terminate()
        try: process.wait(timeout=5)
        except Exception: process.kill()
        (args.output_dir/'results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    return int(any(case['status']!='passed' for case in result['cases'].values()))


if __name__=='__main__':
    sys.exit(main())
