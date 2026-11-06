"""Measure shop layout and owned-item interactions in disposable Quark sessions."""
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
from browser_smoke import (ROOT, assert_viewport, center_hit, context_for, read_number,
                           reload_and_resume, require, screenshot, swipe_up_within,
                           verify_shop_purchase, watch_page)

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(errors="backslashreplace")

PROFILES = {"small":{"width":320,"height":568,"mobile":True},
            "portrait":{"width":390,"height":844,"mobile":True},
            "landscape":{"width":640,"height":360,"mobile":True}}


def layout(page):
    return page.evaluate("""() => {
      const box=document.querySelector('#ovShop .box');
      const r=box.getBoundingClientRect();
      const entries=['h2','#shopItems','#shopPacks','#shopVouch','#shopOwned','.shopActions'];
      const rect=e=>{const x=e.getBoundingClientRect();return {top:x.top,bottom:x.bottom,
        left:x.left,right:x.right,width:x.width,height:x.height}};
      return {viewport:[innerWidth,innerHeight],box:rect(box),scrollTop:box.scrollTop,
        scrollHeight:box.scrollHeight,clientHeight:box.clientHeight,scrollMax:box.scrollHeight-box.clientHeight,
        sections:Object.fromEntries(entries.map(s=>{const el=box.querySelector(s), v=rect(el);
          const visible=Math.max(0,Math.min(v.bottom,r.bottom,innerHeight)-Math.max(v.top,r.top,0));
          return [s,{...v,visibleHeight:visible,fullyVisible:visible>=v.height-1}];}))};
    }""")


def inspect_owned(page):
    return page.evaluate("""() => {
      const owned=document.querySelector('#ovOwned'), shop=document.querySelector('#ovShop');
      const hitFor=selector=>{const el=document.querySelector(selector),r=el.getBoundingClientRect();
        const x=r.left+r.width/2,y=r.top+r.height/2;
        const hit=x>=0&&x<innerWidth&&y>=0&&y<innerHeight?document.elementFromPoint(x,y):null;
        return {rect:{left:r.left,top:r.top,right:r.right,bottom:r.bottom},x,y,
          hit:hit?{tag:hit.tagName,id:hit.id,classes:hit.className,owned:owned.contains(hit),shop:shop.contains(hit)}:null};};
      return {ownedDisplay:getComputedStyle(owned).display,ownedZ:getComputedStyle(owned).zIndex,
        ownedOrder:owned.dataset.order,ownedInert:owned.inert,shopDisplay:getComputedStyle(shop).display,
        shopZ:getComputedStyle(shop).zIndex,shopOrder:shop.dataset.order,shopInert:shop.inert,
        ownedBeforeShop:!!(owned.compareDocumentPosition(shop)&Node.DOCUMENT_POSITION_FOLLOWING),
        title:hitFor('#ownedTitle'),sell:hitFor('#sellOwned'),probe:window.__ownedProbe};
    }""")


def prepare_probe(page):
    page.evaluate("""() => {
      window.__ownedProbe={clickedAt:null,cssVisibleMs:null,hitTestMs:null};
      const onClick=e=>{
        if(!e.target.closest('#shopOwned .ownedItem[data-kind="joker"]'))return;
        document.removeEventListener('click',onClick,true);
        const p=window.__ownedProbe;p.clickedAt=performance.now();
        const frame=()=>{
          const ov=document.querySelector('#ovOwned'),button=document.querySelector('#sellOwned');
          const now=performance.now()-p.clickedAt;
          if(p.cssVisibleMs===null&&getComputedStyle(ov).display!=='none')p.cssVisibleMs=now;
          const r=button.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
          if(p.hitTestMs===null&&ov.contains(hit))p.hitTestMs=now;
          if(now<1500&&(p.cssVisibleMs===null||p.hitTestMs===null))requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      };
      document.addEventListener('click',onClick,true);
    }""")


def scroll_to_owned(page):
    owned=page.locator("#shopOwned .ownedItem[data-kind='joker']").first
    swipes=0
    while swipes<10 and not center_hit(owned)["visible"]:
        swipe_up_within(page,page.locator("#ovShop .box"))
        swipes+=1
    require(center_hit(owned)["visible"],f"owned joker remained unreachable after {swipes} touch swipes")
    return owned,swipes


def install_full_inventory(page):
    """Explicit white-box 6-joker/3-consumable setup inside a normal shop."""
    state=page.evaluate("""() => {
      S.jokerSlots=6; S.consSlots=3; S.jokers=[];
      for(const id of ['even','odd','fib','stencil','blackboard','fortune'])
        addJoker(JDEFS.find(item=>item.id===id));
      S.cons=[{...PLANETS.find(p=>p.key==='high'),kind:'planet',price:3},
              {...TAROTS.find(t=>t.id==='magician'),kind:'tarot',price:3},
              {...TAROTS.find(t=>t.id==='temperance'),kind:'tarot',price:3}];
      renderShop(); persistRun();
      return {jokers:S.jokers.map(j=>({id:j.id,uid:j.uid,sell:j.sell})),
              cons:S.cons.map(c=>({id:c.id||null,key:c.key||null,kind:c.kind})),
              jokerSlots:S.jokerSlots,consSlots:S.consSlots,money:S.money};
    }""")
    require(len(state["jokers"])==state["jokerSlots"]==6 and len(state["cons"])==state["consSlots"]==3,
            f"full inventory fixture failed: {state}")
    return state


def inventory_state(page):
    return page.evaluate("""() => ({jokers:S.jokers.map(j=>({id:j.id,uid:j.uid,sell:j.sell})),
      cons:S.cons.map(c=>({id:c.id||null,key:c.key||null,kind:c.kind})),
      jokerSlots:S.jokerSlots,consSlots:S.consSlots,money:S.money})""")


def install_long_stock(page):
    """Replace visible stock with valid, long-description game definitions."""
    return page.evaluate("""() => {
      const byLength=(a,b)=>(b.desc||'').length-(a.desc||'').length;
      const owned=new Set(S.jokers.map(j=>j.id));
      S.shop.jokers=JDEFS.filter(j=>!owned.has(j.id)).slice().sort(byLength).slice(0,2)
        .map(j=>({...j,ed:0,sold:false}));
      S.shop.cons=TAROTS.slice().sort(byLength).slice(0,2)
        .map(t=>({...t,kind:'tarot',price:3,sold:false}));
      renderShop(); persistRun();
      return {jokers:S.shop.jokers.map(j=>({id:j.id,name:j.name,desc:j.desc})),
              cons:S.shop.cons.map(c=>({id:c.id,name:c.name,desc:c.desc}))};
    }""")


def visible_text_geometry(page):
    return page.evaluate("""() => {
      const shown=e=>!!e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
      const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,
        bottom:r.bottom,width:r.width,height:r.height}};
      // Range glyph ascent may extend slightly beyond painted emoji; allow
      // two CSS pixels of rounding while still catching actual crop/overlap.
      const clip=(inner,outer)=>inner.left<outer.left-2||inner.right>outer.right+2||
        inner.top<outer.top-2||inner.bottom>outer.bottom+2;
      const stock=[...document.querySelectorAll('#ovShop [role=tabpanel] .shopItem')].filter(shown);
      const owned=[...document.querySelectorAll('#shopOwned .ownedItem')].filter(shown);
      const scan=(card,selectors)=>{const border=rect(card);
        const sampleHits=[[.5,.15],[.5,.5],[.5,.85],[.15,.5],[.85,.5]].map(([fx,fy])=>{
          const x=border.left+border.width*fx,y=border.top+border.height*fy;
          const hit=x>=0&&x<innerWidth&&y>=0&&y<innerHeight?document.elementFromPoint(x,y):null;
          return {fx,fy,x,y,inside:!!hit&&(hit===card||card.contains(hit)),
            hit:hit?{id:hit.id,tag:hit.tagName,className:hit.className}:null};
        });
        return {label:card.innerText,rect:border,sampleHits,
        scrollOverflow:card.scrollWidth>card.clientWidth+1||card.scrollHeight>card.clientHeight+1,
        children:selectors.flatMap(selector=>[...card.querySelectorAll(selector)].map(el=>{
          const box=rect(el),range=document.createRange();range.selectNodeContents(el);
          const text=[...range.getClientRects()].map(r=>({left:r.left,right:r.right,top:r.top,bottom:r.bottom}));
          const css=getComputedStyle(el);
          const clips=/hidden|clip|scroll|auto/.test(css.overflowX+' '+css.overflowY);
          const clippedText=clips&&(el.scrollWidth>el.clientWidth+1||el.scrollHeight>el.clientHeight+1||
            text.some(r=>clip(r,box)));
          return {selector,text:el.innerText,box,boxOutside:clip(box,border),
            textOutside:text.some(r=>clip(r,border)),clippedText,textRects:text};
        }))};};
      return {stock:stock.map(e=>scan(e,['.ic','.nm','.ds','.pr'])),
              owned:owned.map(e=>scan(e,['.ownedIcon','span:not(.ownedIcon)']))};
    }""")


def text_issues(audit):
    problems=[]
    for kind in ("stock","owned"):
        for item in audit[kind]:
            if kind=="owned" and any(not point["inside"] for point in item["sampleHits"]):
                problems.append({"kind":kind,"label":item["label"],"part":"touch/visibility",
                                 "rect":item["rect"],
                                 "blocked_points":[p for p in item["sampleHits"] if not p["inside"]]})
            for child in item["children"]:
                if child["boxOutside"] or child["textOutside"] or child["clippedText"]:
                    problems.append({"kind":kind,"label":item["label"],"part":child["selector"],
                                     "text":child["text"],"boxOutside":child["boxOutside"],
                                     "textOutside":child["textOutside"],"clippedText":child["clippedText"]})
    return problems


def audit_tabs(page,out,label):
    tabs=[("cards","#shopTabCards","#shopItems"),
          ("cons","#shopTabCons","#shopItems"),
          ("packs","#shopTabPacks","#shopPacks"),
          ("voucher","#shopTabVoucher","#shopVouch")]
    output={}
    for name,button,panel in tabs:
        page.locator(button).tap(timeout=3000)
        require(page.locator(button).get_attribute("aria-selected")=="true",f"{name} tab not selected")
        require(page.locator(panel).is_visible(),f"{name} panel hidden after touch")
        for other,_,selector in tabs:
            if selector!=panel: require(not page.locator(selector).is_visible(),f"{other} panel visible on {name}")
        require(page.locator("#rerollBtn").is_visible()==(name in ("cards","cons")),f"reroll visibility on {name}")
        if name in ("cards","cons"):
            cards=page.locator("#shopItems .shopItem")
            require(cards.count()==4,"single-card DOM should contain two jokers and two consumables")
            expected=[True,True,False,False] if name=="cards" else [False,False,True,True]
            require([card.is_visible() for card in cards.all()]==expected,
                    f"incorrect single-card visibility for {name}")
        geometry=layout(page)
        text=visible_text_geometry(page)
        screenshot(page,out,label+"-"+name)
        output[name]={"layout":geometry,"text":text,"text_issues":text_issues(text)}
    page.locator("#shopTabCards").tap()
    return output


def painted_owned_above_shop(details):
    if details["shopDisplay"]=="none":
        return True
    try:
        owned_z=int(details["ownedZ"])
        shop_z=int(details["shopZ"])
    except (ValueError,TypeError):
        return False
    return owned_z>shop_z or (owned_z==shop_z and not details["ownedBeforeShop"])


def verify_owned_dialog_cycles(page, owned_button, out, label):
    """Real taps, including canceling an armed sale before explicitly confirming."""
    before=inventory_state(page)
    require(before["jokers"],"sale test needs an owned joker")
    selected=before["jokers"][0]
    timings=[]
    for cycle in range(3):
        prepare_probe(page)
        start=time.perf_counter()
        owned_button.first.tap(timeout=3000)
        page.locator("#ovOwned").wait_for(state="visible",timeout=2000)
        details=inspect_owned(page)
        timings.append(round((time.perf_counter()-start)*1000,2))
        require(painted_owned_above_shop(details),f"owned dialog is painted beneath the shop: {details}")
        require(details["title"]["hit"] and details["title"]["hit"]["owned"] and
                details["sell"]["hit"] and details["sell"]["hit"]["owned"],
                f"owned dialog controls cannot receive touch: {details}")
        require(page.locator("#sellOwned").inner_text().strip().startswith("卖出"),
                "previous sale confirmation remained armed")
        if cycle==0:
            screenshot(page,out,label+"-owned-visible")
            page.locator("#sellOwned").tap(timeout=2000)
            require(page.locator("#sellOwned").inner_text().strip().startswith("确认卖出"),
                    "first sale touch did not request confirmation")
            require(inventory_state(page)==before,"first sale touch changed inventory or money")
        page.locator('#ovOwned button[onclick="hide(\'ovOwned\')"]').tap(timeout=2000)
        page.locator("#ovOwned").wait_for(state="hidden",timeout=2000)
        require(inventory_state(page)==before,"opening/canceling a sale changed inventory or money")
    owned_button.first.tap(timeout=3000)
    page.locator("#ovOwned").wait_for(state="visible",timeout=2000)
    require(page.locator("#sellOwned").inner_text().strip().startswith("卖出"),
            "sale confirmation was not reset after return")
    page.locator("#sellOwned").tap(timeout=2000)
    require(inventory_state(page)==before,"first tap unexpectedly sold the joker")
    require(page.locator("#sellOwned").inner_text().strip().startswith("确认卖出"),
            "explicit sale confirmation is absent")
    page.locator("#sellOwned").tap(timeout=2000)
    page.locator("#ovOwned").wait_for(state="hidden",timeout=2000)
    after=inventory_state(page)
    require(after["jokers"]==before["jokers"][1:] and after["cons"]==before["cons"] and
            after["money"]==before["money"]+selected["sell"],
            f"confirmed sale changed the wrong state: before={before}, after={after}")
    return {"open_ms":timings,"canceled_armed_sale":True,"sold_id":selected["id"],
            "sale_value":selected["sell"],"after":after}


def baseline(browser,url,out,profile,spec,seed):
    context=context_for(browser,spec,seed)
    page=context.new_page()
    errors=watch_page(page)
    measured={"fixture":"normal solo first blind, genuine joker purchase; real touch actions",
              "viewport":[spec["width"],spec["height"]]}
    try:
        plays=enter_shop(page,url,True)
        assert_viewport(page,spec["width"])
        measured["first_blind_plays"]=plays
        measured["shop_at_open"]=layout(page)
        screenshot(page,out,f"{profile}-shop-open")
        measured["purchase"]=verify_shop_purchase(page,True)
        measured["shop_after_purchase"]=layout(page)
        screenshot(page,out,f"{profile}-shop-after-purchase")
        owned,swipes=scroll_to_owned(page)
        measured["swipes_to_owned"]=swipes
        measured["shop_before_open_owned"]=layout(page)
        screenshot(page,out,f"{profile}-owned-in-shop")
        prepare_probe(page)
        before=time.perf_counter()
        owned.tap(timeout=5000)
        page.locator("#ovOwned").wait_for(state="visible",timeout=3000)
        measured["tap_to_css_visible_ms"]=round((time.perf_counter()-before)*1000,2)
        page.wait_for_timeout(200)
        measured["owned_layer"]=inspect_owned(page)
        screenshot(page,out,f"{profile}-owned-open")
        # The first sell tap only arms confirmation; it cannot complete a sale.
        before=time.perf_counter()
        try:
            page.locator("#sellOwned").tap(timeout=1500)
            measured["sell_first_tap"]={"status":"clicked", "ms":round((time.perf_counter()-before)*1000,2),
                "label":page.locator("#sellOwned").inner_text(),"jokers_after":page.evaluate("() => S.jokers.length")}
        except Exception as error:
            measured["sell_first_tap"]={"status":"blocked", "ms":round((time.perf_counter()-before)*1000,2),
                                       "error":f"{type(error).__name__}: {error}"}
        measured["page_errors"]=errors
        measured["status"]="measured"
        return measured
    except Exception as error:
        measured["status"]="failed"
        measured["error"]=f"{type(error).__name__}: {error}"
        measured["traceback"]=traceback.format_exc()
        screenshot(page,out,f"{profile}-failure")
        return measured
    finally:
        context.close()


def acceptance(browser,url,out,profile,spec,seed):
    context=context_for(browser,spec,seed)
    page=context.new_page()
    errors=watch_page(page)
    result={"fixture":"normal first blind and purchase, then explicitly injected full inventory and long stock",
            "viewport":[spec["width"],spec["height"]]}
    try:
        result["first_blind_plays"]=enter_shop(page,url,True)
        assert_viewport(page,spec["width"])
        result["natural_tabs"]=audit_tabs(page,out,profile+"-natural")
        result["purchase"]=verify_shop_purchase(page,True)
        natural_button=page.locator("#shopOwned .ownedItem[data-kind='joker']")
        result["natural_sale"]=verify_owned_dialog_cycles(page,natural_button,out,profile+"-natural")
        sold_state=inventory_state(page)
        reload_and_resume(page,True,"#ovShop")
        require(inventory_state(page)==sold_state,"normal confirmed sale did not survive refresh")
        result["natural_sale_survived_refresh"]=True

        full=install_full_inventory(page)
        result["full_fixture"]=full
        result["long_stock_fixture"]=install_long_stock(page)
        result["full_tabs"]=audit_tabs(page,out,profile+"-full")
        require(page.locator("#shopOwned .ownedItem[data-kind='joker']").count()==6 and
                page.locator("#shopOwned .ownedItem[data-kind='cons']").count()==3,
                "full inventory controls are missing")
        require(read_number(page,"#shopSlots")==6 and read_number(page,"#shopCons")==3,
                "full inventory slot counters are wrong")
        reload_and_resume(page,True,"#ovShop")
        require(inventory_state(page)==full,"full inventory did not survive refresh")
        full_button=page.locator("#shopOwned .ownedItem[data-kind='joker']")
        result["full_sale"]=verify_owned_dialog_cycles(page,full_button,out,profile+"-full")
        after_sale=inventory_state(page)
        reload_and_resume(page,True,"#ovShop")
        require(inventory_state(page)==after_sale,"full inventory sale did not survive refresh")
        result["full_fixture_and_sale_survived_refresh"]=True
        result["page_errors"]=errors
        issues=[]
        for state in ("natural_tabs","full_tabs"):
            for name,data in result[state].items():
                issues += [{"state":state,"tab":name,**issue} for issue in data["text_issues"]]
                if data["layout"]["scrollMax"]>1:
                    issues.append({"state":state,"tab":name,"shop_scroll":data["layout"]["scrollMax"]})
        result["layout_issues"]=issues
        result["status"]="failed" if issues or errors else "passed"
        return result
    except Exception as error:
        result["status"]="failed"
        result["error"]=f"{type(error).__name__}: {error}"
        result["traceback"]=traceback.format_exc()
        screenshot(page,out,f"{profile}-acceptance-failure")
        return result
    finally:
        context.close()


def main():
    p=argparse.ArgumentParser()
    p.add_argument("--browser",default=r"D:\Quark\quark.exe")
    p.add_argument("--app-dir",type=Path,default=ROOT)
    p.add_argument("--output-dir",type=Path,required=True)
    p.add_argument("--profile",choices=PROFILES,action="append")
    p.add_argument("--mode",choices=("baseline","acceptance"),default="acceptance")
    p.add_argument("--seed",type=int,default=1)
    args=p.parse_args()
    args.app_dir=args.app_dir.resolve()
    args.output_dir=args.output_dir.resolve()
    args.output_dir.mkdir(parents=True,exist_ok=True)
    raw=(args.app_dir/"balatro.html").read_bytes()
    result={"app_dir":str(args.app_dir),"bytes":len(raw),"sha256":hashlib.sha256(raw).hexdigest(),
            "browser":args.browser,"seed":args.seed,"cases":{}}
    process,url=start_server(args.app_dir)
    try:
        with sync_playwright() as pw:
            browser=pw.chromium.launch(executable_path=args.browser,headless=True,
                args=["--disable-extensions","--disable-background-networking"])
            try:
                for profile in args.profile or list(PROFILES):
                    run=baseline if args.mode=="baseline" else acceptance
                    data=run(browser,url,args.output_dir,profile,PROFILES[profile],args.seed)
                    result["cases"][profile]=data
                    print(profile.upper()+" "+data["status"]+(" "+data.get("error","") if data["status"]=="failed" else ""),flush=True)
            finally:
                browser.close()
    finally:
        process.terminate()
        try: process.wait(timeout=5)
        except Exception: process.kill()
        (args.output_dir/"results.json").write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding="utf-8")
    return int(any(case["status"]=="failed" for case in result["cases"].values()))


if __name__=="__main__":
    sys.exit(main())
