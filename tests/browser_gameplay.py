"""Targeted 1.3.2 gameplay checks using isolated, headless Quark contexts.

Normal actions use touch. Cases that need rare cards or late-game state state
their exact JavaScript fixtures in their results and then use the actual UI.

    python tests/browser_gameplay.py --app-dir .qa/v132/baseline --output-dir .qa/v132/baseline-results --mode baseline
    python tests/browser_gameplay.py --output-dir .qa/v132/final-results --mode fixed
    python tests/browser_gameplay.py --output-dir .qa/v132/legacy-results --mode fixed --only legacy_pack --legacy-save .qa/v132/baseline-seed2/legacy-standard-save.json
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
from browser_smoke import (ROOT, assert_reachable, assert_viewport, context_for,
                           read_number, require, screenshot, select_shop_tab,
                           start_blind, touch_at, watch_page)

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(errors="backslashreplace")

PHONE = {"width":390, "height":844, "mobile":True}
PROFILES = {"small":{"width":320,"height":568,"mobile":True},
            "portrait":PHONE,
            "landscape":{"width":640,"height":360,"mobile":True}}


def context_page(browser, seed, spec=PHONE):
    context=context_for(browser,spec,seed)
    page=context.new_page()
    return context,page,watch_page(page)


def issue_result(data, issues):
    data["issues"]=issues
    data["status"]="defect_observed" if issues else "passed"
    return data


def standard_pack(browser,url,out,seed):
    context,page,errors=context_page(browser,seed)
    data={"fixture":"normal first blind, actual standard-pack purchase"}
    try:
        data["plays"]=enter_shop(page,url,True)
        select_shop_tab(page,"packs",True)
        pack=page.locator("#shopPacks .shopItem").filter(has_text="标准包")
        require(pack.count()==1 and not pack.is_disabled(),"seeded normal shop did not offer standard pack")
        pack.tap()
        page.locator("#ovPack").wait_for(state="visible")
        screenshot(page,out,"baseline-standard-pack")
        options=page.evaluate("() => S.pack.options.map(c=>({id:c.id,rank:c.rank,suit:c.suit,bonus:c.bonus,multB:c.multB,wild:c.wild,steel:c.steel,glass:c.glass,goldc:c.goldc,ed:c.ed,seal:c.seal}))")
        raw=page.evaluate("() => localStorage.getItem('pixel-balatro.run.v1')")
        require(raw and len(options)==3,"standard pack did not persist three candidates")
        (out/"legacy-standard-save.json").write_text(json.dumps({"raw":raw,"options":options},ensure_ascii=False,indent=2),encoding="utf-8")
        traits=lambda c: [key for key in ("bonus","multB","wild","steel","glass","goldc") if c[key]]
        kinds=[traits(c) for c in options]
        plain=[i for i,c in enumerate(options) if not traits(c) and not c["ed"] and not c["seal"]]
        issues=[]
        if any(len(k)!=1 for k in kinds) or len({k[0] for k in kinds if len(k)==1})!=3:
            issues.append({"requirement":"three distinct base enhancements", "actual":kinds, "pure_ordinary_indices":plain})
        data.update({"options":options,"base_enhancements":kinds,"pure_ordinary_indices":plain,
                     "legacy_save":str(out/"legacy-standard-save.json"),"page_errors":errors})
        require(not errors,f"page errors: {errors}")
        return issue_result(data,issues)
    finally:
        context.close()


def stateful_joker(browser,url,out,seed,case):
    context,page,errors=context_page(browser,seed)
    configs={
        "green_current":{"joker":"green","initial":0,"cards":[[6,0]],"expected_score":22,"expected_state":1},
        "bus_current":{"joker":"bus","initial":0,"cards":[[6,0]],"expected_score":22,"expected_state":1},
        "bus_face_reset":{"joker":"bus","initial":5,"cards":[[13,0]],"expected_score":15,"expected_state":0},
        "runner_current":{"joker":"runner","initial":0,"cards":[[2,0],[3,1],[4,2],[5,3],[6,0]],"expected_score":260,"expected_state":15},
    }
    cfg=configs[case]
    data={"fixture":"normal first blind; directly assigned canonical hand and one existing joker; selected and played by touch",
          "config":cfg}
    try:
        page.goto(url,wait_until="domcontentloaded")
        start_blind(page,True)
        page.evaluate("""cfg => {
          const hand=cfg.cards.map(([rank,suit])=>S.deckAll.find(c=>c.rank===rank&&c.suit===suit));
          if(hand.some(c=>!c))throw new Error('missing fixture card');
          S.hand=hand; S.drawPile=S.deckAll.filter(c=>!hand.includes(c));
          S.jokers=[];addJoker(JDEFS.find(j=>j.id===cfg.joker));S.jokers[0].state=cfg.initial;
          S.target=1000000;S.score=0;renderAll();
        }""",cfg)
        for i in range(len(cfg["cards"])):
            page.locator("#handRow .card").nth(i).tap()
        preview=read_number(page,"#scoreEstimate")
        screenshot(page,out,case+"-preview")
        page.locator("#btnPlay").tap()
        page.wait_for_function("() => S && !S.busy && S.score>0",timeout=20000)
        actual=read_number(page,"#scoreVal")
        state=page.evaluate("() => S.jokers[0].state")
        screenshot(page,out,case+"-scored")
        issues=[]
        if preview!=cfg["expected_score"] or actual!=cfg["expected_score"]:
            issues.append({"requirement":"current-hand score includes growth or reset", "expected":cfg["expected_score"],
                           "preview":preview,"actual":actual})
        if state!=cfg["expected_state"]:
            issues.append({"requirement":"joker state after play", "expected":cfg["expected_state"], "actual":state})
        data.update({"preview":preview,"actual_score":actual,"state_after":state,"page_errors":errors})
        require(not errors,f"page errors: {errors}")
        return issue_result(data,issues)
    finally:
        context.close()


def green_discard(browser,url,out,seed):
    context,page,errors=context_page(browser,seed)
    data={"fixture":"normal first blind; directly assigned green joker state 3; actual discard touch"}
    try:
        page.goto(url,wait_until="domcontentloaded")
        start_blind(page,True)
        page.evaluate("() => { S.jokers=[];addJoker(JDEFS.find(j=>j.id==='green'));S.jokers[0].state=3;renderAll(); }")
        page.locator("#handRow .card").first.tap()
        page.locator("#btnDiscard").tap()
        state=page.evaluate("() => S.jokers[0].state")
        screenshot(page,out,"green-discard-reset")
        data.update({"state_after":state,"page_errors":errors})
        require(not errors,f"page errors: {errors}")
        return issue_result(data,[] if state==0 else [{"requirement":"discard resets green joker", "actual":state}])
    finally:
        context.close()


def shop_targeted_tarots(browser,url,out,seed):
    context,page,errors=context_page(browser,seed)
    data={"fixture":"normal first blind/shop; directly assigned three targeted tarot cards; real inventory/dialog touches"}
    try:
        enter_shop(page,url,True)
        page.evaluate("""() => {
          S.consSlots=3;S.cons=['star','mooncard','strength'].map(id=>
            ({...TAROTS.find(t=>t.id===id),kind:'tarot',price:3}));renderShop();
        }""")
        results=[]
        for name in ("星星","月亮","力量"):
            item=page.locator("#shopOwned .ownedItem[data-kind='cons']").filter(has_text=name)
            require(item.count()==1,f"missing fixture item {name}")
            item.tap()
            page.locator("#ovOwned").wait_for(state="visible")
            enabled=page.locator("#useOwned").is_enabled()
            before=page.evaluate("() => S.cons.map(c=>c.id)")
            screenshot(page,out,"shop-target-"+name)
            if enabled:
                page.locator("#useOwned").tap()
                require(page.evaluate("() => S.cons.map(c=>c.id)")==before,"invalid shop use consumed a tarot")
                page.wait_for_timeout(350)
            message=page.locator("#infobar").inner_text()
            results.append({"name":name,"use_button_enabled":enabled,"cons_after":before,"message":message})
            page.locator('#ovOwned button[onclick="hide(\'ovOwned\')"]').tap()
            page.locator("#ovOwned").wait_for(state="hidden")
        issues=[{"requirement":"targeted tarot disabled outside play",**r} for r in results if r["use_button_enabled"]]
        data.update({"tarots":results,"page_errors":errors})
        require(not errors,f"page errors: {errors}")
        return issue_result(data,issues)
    finally:
        context.close()


def no_op_seal(browser,url,out,seed):
    context,page,errors=context_page(browser,seed)
    data={"fixture":"normal shop; directly assigned gold seals to every deck card and a spectral pack; actual touch"}
    try:
        enter_shop(page,url,True)
        page.evaluate("""() => {
          S.deckAll.forEach(c=>c.seal='gold');
          S.shop.packs[0]={...PACKS.find(p=>p.id==='spectral'),sold:false,
            options:[{...SPECTRALS.find(s=>s.id==='talis')},{...SPECTRALS.find(s=>s.id==='dejavu')}]};
          renderShop();persistRun();
        }""")
        select_shop_tab(page,"packs",True)
        before=read_number(page,"#shopMoney")
        page.locator("#shopPacks .shopItem").first.tap()
        page.locator("#ovPack").wait_for(state="visible")
        screenshot(page,out,"seal-before-invalid-use")
        price=read_number(page,"#shopMoney")
        option=page.locator("#packCards button").filter(has_text="护符")
        disabled=option.is_disabled()
        reason=option.locator(".packBlocked").inner_text() if option.locator(".packBlocked").count() else ""
        bounds=option.bounding_box()
        require(bounds,"seal option has no touch area")
        touch_at(page,bounds["x"]+bounds["width"]/2,bounds["y"]+bounds["height"]/2)
        page.wait_for_timeout(150)
        observed=page.evaluate("""() => ({packOpen:!!S.pack,money:S.money,
          gold:S.deckAll.filter(c=>c.seal==='gold').length,total:S.deckAll.length})""")
        screenshot(page,out,"seal-after-invalid-use")
        issues=[]
        if not observed["packOpen"]:
            issues.append({"requirement":"invalid identical seal does not consume the pack", "observed":observed})
        if not disabled or not reason:
            issues.append({"requirement":"invalid seal option is disabled with a reason", "disabled":disabled,"reason":reason})
        cancel=None
        if observed["packOpen"]:
            choices=page.evaluate("() => S.pack.options.map(x=>x.id)")
            page.locator('#ovPack button[onclick="closePack()"]',).tap()
            refunded=read_number(page,"#shopMoney")
            select_shop_tab(page,"packs",True)
            page.locator("#shopPacks .shopItem").first.tap()
            page.locator("#ovPack").wait_for(state="visible")
            reopened=page.evaluate("() => S.pack.options.map(x=>x.id)")
            cancel={"money_refunded":refunded,"original_choices":choices,"reopened_choices":reopened}
            if refunded!=before or reopened!=choices:
                issues.append({"requirement":"cancel refunds and preserves spectral pack candidates", "observed":cancel})
        data.update({"money_before_purchase":before,"money_during_pack":price,"disabled":disabled,"reason":reason,
                     "after":observed,"cancel_and_reopen":cancel,"page_errors":errors})
        require(not errors,f"page errors: {errors}")
        return issue_result(data,issues)
    finally:
        context.close()


def seal_eligible_card(browser,url,out,seed):
    context,page,errors=context_page(browser,seed)
    try:
        enter_shop(page,url,True)
        page.evaluate("""() => {
          S.deckAll.forEach(c=>c.seal='gold');S.deckAll[0].seal='red';
          S.shop.packs[0]={...PACKS.find(p=>p.id==='spectral'),sold:false,
            options:[{...SPECTRALS.find(s=>s.id==='talis')},{...SPECTRALS.find(s=>s.id==='dejavu')}]};
          renderShop();persistRun();
        }""")
        select_shop_tab(page,"packs",True)
        page.locator("#shopPacks .shopItem").first.tap()
        page.locator("#ovPack").wait_for(state="visible")
        page.locator("#packCards button").filter(has_text="护符").tap()
        page.wait_for_timeout(150)
        observed=page.evaluate("""() => ({packOpen:!!S.pack,
          gold:S.deckAll.filter(c=>c.seal==='gold').length,total:S.deckAll.length})""")
        screenshot(page,out,"seal-one-eligible-card")
        issues=[]
        if observed["packOpen"] or observed["gold"]!=observed["total"]:
            issues.append({"requirement":"valid seal selects the only eligible card and consumes pack", "observed":observed})
        require(not errors,f"page errors: {errors}")
        return issue_result({"fixture":"normal shop; directly assigned 51 gold seals, one red seal, and a spectral pack; actual touch",
                             "after":observed,"page_errors":errors},issues)
    finally:
        context.close()


def wild_rules(browser,url,out,seed):
    """Cards are injected; selecting and playing each example uses touch."""
    examples=[
        {"name":"jack_and_wild_six", "cards":[[11,3],[6,0]], "wild":1,
         "hand":"高牌", "expected_score":15},
        {"name":"two_sixes_one_wild", "cards":[[6,0],[6,3]], "wild":0,
         "hand":"对子", "expected_score":44},
        {"name":"four_hearts_and_wild_six", "cards":[[2,1],[4,1],[8,1],[10,1],[6,0]], "wild":4,
         "hand":"同花", "expected_score":260},
    ]
    results=[];issues=[];all_errors=[]
    for example in examples:
        context,page,errors=context_page(browser,seed)
        try:
            page.goto(url,wait_until="domcontentloaded");start_blind(page,True)
            page.evaluate("""cfg => {
              const cards=cfg.cards.map(([rank,suit])=>S.deckAll.find(c=>c.rank===rank&&c.suit===suit));
              if(cards.some(c=>!c))throw new Error('missing wild test fixture');
              cards.forEach(c=>c.sel=false);cards[cfg.wild].wild=true;
              S.hand=cards;S.drawPile=S.deckAll.filter(c=>!cards.includes(c));
              S.jokers=[];S.target=1000000;S.score=0;renderAll();
            }""",example)
            wild=page.locator("#handRow .card").nth(example["wild"])
            accessible=wild.get_attribute("aria-label")
            tip=page.evaluate("() => cardTipHTML(S.hand.find(c=>c.wild))")
            for i in range(len(example["cards"])):
                page.locator("#handRow .card").nth(i).tap()
            name=page.locator("#prevName").inner_text()
            preview=read_number(page,"#scoreEstimate")
            screenshot(page,out,"wild-"+example["name"]+"-preview")
            page.locator("#btnPlay").tap()
            page.wait_for_function("() => S && !S.busy && S.score>0",timeout=20000)
            actual=read_number(page,"#scoreVal")
            result={"example":example,"preview_name":name,"preview_score":preview,
                    "actual_score":actual,"wild_aria_label":accessible,"wild_tooltip_html":tip}
            if name!=example["hand"] or preview!=example["expected_score"] or actual!=example["expected_score"]:
                issues.append({"requirement":"wild only substitutes suit, retaining printed rank", **result})
            if "百搭花色" not in (accessible or "") and "百搭花色" not in tip:
                issues.append({"requirement":"wild label explains suit-only behavior", "actual_label":accessible,
                               "tooltip_html":tip})
            require(not errors,f"page errors: {errors}")
            results.append(result);all_errors.extend(errors)
        finally:
            context.close()
    return issue_result({"fixture":"three specified canonical hands and one wild flag; selected and played by touch",
                         "examples":results,"page_errors":all_errors},issues)


def psychic_button(browser,url,out,seed):
    results=[];issues=[];all_errors=[]
    for profile,spec in PROFILES.items():
        context,page,errors=context_page(browser,seed,spec)
        try:
            page.goto(url,wait_until="domcontentloaded");start_blind(page,True)
            page.evaluate("""() => { S.boss=BOSSES.find(b=>b.id==='psychic');
              S.blindIdx=2;S.target=1000000;S.score=0;renderAll(); }""")
            assert_viewport(page,spec["width"])
            states=[]
            for i in range(5):
                page.locator("#handRow .card").nth(i).tap()
                enabled=page.locator("#btnPlay").is_enabled()
                states.append({"selected":i+1,"play_enabled":enabled})
                if enabled != (i==4):
                    issues.append({"requirement":"psychic enables play only at five selected", "profile":profile,
                                   "selected":i+1,"enabled":enabled})
                if i in (0,4): screenshot(page,out,f"psychic-{profile}-{i+1}-selected")
            before=read_number(page,"#handsVal")
            page.locator("#btnPlay").tap()
            page.wait_for_function("() => S && !S.busy && S.score>0",timeout=20000)
            after=read_number(page,"#handsVal")
            if after!=before-1:
                issues.append({"requirement":"a five-card psychic hand plays normally", "profile":profile,
                               "hands_before":before,"hands_after":after})
            require(not errors,f"page errors: {errors}")
            results.append({"profile":profile,"states":states,"hands_before":before,"hands_after":after})
            all_errors.extend(errors)
        finally:
            context.close()
    return issue_result({"fixture":"normal first blind with psychic boss assigned; each selection and play by touch",
                         "profiles":results,"page_errors":all_errors},issues)


def targeted_tarot_return(browser,url,out,seed):
    results=[];issues=[];all_errors=[]
    for profile,spec in PROFILES.items():
        context,page,errors=context_page(browser,seed,spec)
        try:
            page.goto(url,wait_until="domcontentloaded");start_blind(page,True)
            page.evaluate("""() => { S.cons=[{...TAROTS.find(t=>t.id==='star'),kind:'tarot',price:3}];renderAll(); }""")
            assert_viewport(page,spec["width"])
            page.locator("#consRow .joker").filter(has_text="星星").tap()
            page.locator("#ovOwned").wait_for(state="visible")
            usable_without_target=page.locator("#useOwned").is_enabled()
            prompt=page.locator("#useOwned").inner_text()
            screenshot(page,out,f"tarot-{profile}-prompt")
            if usable_without_target:
                page.locator("#useOwned").tap()
                page.wait_for_timeout(350)
            after_missing=page.evaluate("() => ({cons:S.cons.map(c=>c.id),selected:S.hand.filter(c=>c.sel).length})")
            screenshot(page,out,f"tarot-{profile}-no-target")
            if after_missing["cons"]!=["star"] or after_missing["selected"]!=0:
                issues.append({"requirement":"missing tarot target does not consume the card", "profile":profile,
                               "observed":after_missing})
            dialog_stayed=page.locator("#ovOwned").is_visible()
            if not usable_without_target or "选择" not in prompt or "手牌" not in prompt or dialog_stayed:
                issues.append({"requirement":"missing-target action prompts selection and returns to hand",
                               "profile":profile,"enabled":usable_without_target,"label":prompt,"dialog_stayed":dialog_stayed})
            if dialog_stayed:
                back=page.locator('#ovOwned button[onclick="hide(\'ovOwned\')"]')
                assert_reachable(back,"tarot back button");back.tap()
            page.locator("#ovOwned").wait_for(state="hidden")
            target_index=page.evaluate("() => S.hand.findIndex(c=>c.suit!==3&&!c.wild)")
            require(target_index>=0,"fixture did not deal a non-diamond target")
            selected=page.locator("#handRow .card").nth(target_index)
            card_id=selected.get_attribute("data-card-id")
            original=page.evaluate("id => {const c=S.hand.find(x=>String(x.id)===id);return {rank:c.rank,suit:c.suit}}",card_id)
            selected.tap()
            screenshot(page,out,f"tarot-{profile}-select-target")
            page.locator("#consRow .joker").filter(has_text="星星").tap()
            page.locator("#ovOwned").wait_for(state="visible")
            require(page.locator("#useOwned").is_enabled(),"tarot use still disabled after selecting a card")
            page.locator("#useOwned").tap()
            page.locator("#ovOwned").wait_for(state="hidden")
            after=page.evaluate("id => {const c=S.hand.find(x=>String(x.id)===id);return {rank:c.rank,suit:c.suit,cons:S.cons.length}}",card_id)
            if after!={"rank":original["rank"],"suit":3,"cons":0}:
                issues.append({"requirement":"selected target becomes diamond and tarot is consumed", "profile":profile,
                               "original":original,"after":after})
            screenshot(page,out,f"tarot-{profile}-applied")
            require(not errors,f"page errors: {errors}")
            results.append({"profile":profile,"use_without_target_enabled":usable_without_target,"prompt":prompt,
                            "dialog_stayed":dialog_stayed,
                            "after_missing":after_missing,"before":original,"after":after})
            all_errors.extend(errors)
        finally:
            context.close()
    return issue_result({"fixture":"a star tarot assigned in an ordinary blind; dialog, return, selection and use by touch",
                         "profiles":results,"page_errors":all_errors},issues)


def composite_badges(browser,url,out,seed):
    results=[];issues=[];all_errors=[]
    for profile,spec in PROFILES.items():
        context,page,errors=context_page(browser,seed,spec)
        try:
            page.goto(url,wait_until="domcontentloaded");start_blind(page,True)
            page.evaluate("() => {const c=S.hand[0];c.bonus=30;c.multB=4;renderHand();}")
            assert_viewport(page,spec["width"])
            card=page.locator("#handRow .card").first
            card.tap()
            screenshot(page,out,f"badges-{profile}")
            geometry=card.evaluate("""el=>{
              const rect=e=>{if(!e)return null;const r=e.getBoundingClientRect();
                return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height,
                  text:e.textContent,scrollWidth:e.scrollWidth,clientWidth:e.clientWidth};};
              return {card:rect(el),bonus:rect(el.querySelector('.en.b')),mult:rect(el.querySelector('.en.m'))};
            }""")
            b,m,outer=geometry["bonus"],geometry["mult"],geometry["card"]
            if not b or not m:
                issues.append({"requirement":"both additive chip and multiplier badges visible", "profile":profile,
                               "geometry":geometry})
            else:
                overlap=max(0,min(b["right"],m["right"])-max(b["left"],m["left"]))*max(0,min(b["bottom"],m["bottom"])-max(b["top"],m["top"]))
                within=all(r["left"]>=outer["left"]-1 and r["right"]<=outer["right"]+1 and
                           r["top"]>=outer["top"]-1 and r["bottom"]<=outer["bottom"]+1 for r in (b,m))
                if overlap>1 or not within or any(r["scrollWidth"]>r["clientWidth"]+1 for r in (b,m)):
                    issues.append({"requirement":"both enhancement badges legible, within card and not overlapping",
                                   "profile":profile,"geometry":geometry,"overlap_area":overlap})
            require(not errors,f"page errors: {errors}")
            results.append({"profile":profile,"geometry":geometry});all_errors.extend(errors)
        finally:
            context.close()
    return issue_result({"fixture":"one dealt card directly assigned bonus=30 and multB=4; selected by touch",
                         "profiles":results,"page_errors":all_errors},issues)


def standard_pack_visual(browser,url,out,seed):
    results=[];issues=[];all_errors=[]
    for profile,spec in PROFILES.items():
        context,page,errors=context_page(browser,seed,spec)
        try:
            plays=enter_shop(page,url,True)
            assert_viewport(page,spec["width"])
            select_shop_tab(page,"packs",True)
            pack=page.locator("#shopPacks .shopItem").filter(has_text="标准包")
            require(pack.count()==1 and pack.is_enabled(),"seeded shop did not offer an affordable standard pack")
            pack.tap();page.locator("#ovPack").wait_for(state="visible")
            options=page.locator("#packCards button")
            require(options.count()==3,"standard pack did not show three choices")
            screenshot(page,out,f"pack-{profile}-top")
            entries=[]
            for i in range(3):
                option=options.nth(i)
                assert_reachable(option,f"standard pack option {i+1}")
                geometry=option.evaluate("""el=>{
                  const card=el.querySelector('.card'),desc=el.querySelector('.pkds');
                  const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,
                    bottom:r.bottom,width:r.width,height:r.height}};
                  return {button:rect(el),card:rect(card),description:rect(desc),text:desc.innerText,
                    descScrollWidth:desc.scrollWidth,descClientWidth:desc.clientWidth,
                    descScrollHeight:desc.scrollHeight,descClientHeight:desc.clientHeight};
                }""")
                b,d,c=geometry["button"],geometry["description"],geometry["card"]
                if (geometry["descScrollWidth"]>geometry["descClientWidth"]+1 or
                    geometry["descScrollHeight"]>geometry["descClientHeight"]+1 or
                    d["left"]<b["left"]-1 or d["right"]>b["right"]+1 or
                    d["top"]<c["bottom"]-1 or d["bottom"]>b["bottom"]+1):
                    issues.append({"requirement":"pack card and description fit their visible choice", "profile":profile,
                                   "index":i,"geometry":geometry})
                entries.append(geometry)
            if profile=="landscape":
                tops=[entry["button"]["top"] for entry in entries]
                if max(tops)-min(tops)>2:
                    issues.append({"requirement":"landscape shows three standard choices in one row",
                                   "profile":profile,"tops":tops})
            screenshot(page,out,f"pack-{profile}-bottom")
            require(not errors,f"page errors: {errors}")
            results.append({"profile":profile,"plays":plays,"options":entries});all_errors.extend(errors)
        finally:
            context.close()
    return issue_result({"fixture":"normal red-deck first blind and real standard pack purchase at each viewport",
                         "profiles":results,"page_errors":all_errors},issues)


def long_pack_visual(browser,url,out,seed):
    results=[];issues=[];all_errors=[]
    for profile,spec in PROFILES.items():
        context,page,errors=context_page(browser,seed,spec)
        try:
            enter_shop(page,url,True);select_shop_tab(page,"packs",True)
            page.locator("#shopPacks .shopItem").filter(has_text="标准包").tap()
            page.locator("#ovPack").wait_for(state="visible")
            page.evaluate("""() => {
              const types=['wild','bonus','steel'];
              S.pack.options.forEach((c,i)=>{
                c.bonus=i===1?30:0;c.multB=0;c.wild=i===0;c.steel=i===2;c.glass=false;c.goldc=false;
                c.seal='red';c.ed=3;
              });
              openPackUI();
            }""")
            assert_viewport(page,spec["width"])
            screenshot(page,out,f"pack-long-{profile}-top")
            options=page.locator("#packCards button")
            entries=[]
            for i in range(3):
                option=options.nth(i)
                assert_reachable(option,f"long standard pack option {i+1}")
                geometry=option.evaluate("""el=>{
                  const box=el.querySelector('.pkds'),r=el.getBoundingClientRect(),d=box.getBoundingClientRect();
                  return {button:{left:r.left,top:r.top,right:r.right,bottom:r.bottom},
                    description:{left:d.left,top:d.top,right:d.right,bottom:d.bottom},text:box.innerText,
                    scrollWidth:box.scrollWidth,clientWidth:box.clientWidth,
                    scrollHeight:box.scrollHeight,clientHeight:box.clientHeight};
                }""")
                b,d=geometry["button"],geometry["description"]
                if (geometry["scrollWidth"]>geometry["clientWidth"]+1 or geometry["scrollHeight"]>geometry["clientHeight"]+1 or
                    d["left"]<b["left"]-1 or d["right"]>b["right"]+1 or d["bottom"]>b["bottom"]+1):
                    issues.append({"requirement":"long standard choice descriptions fit without clipping",
                                   "profile":profile,"index":i,"geometry":geometry})
                entries.append(geometry)
            screenshot(page,out,f"pack-long-{profile}-bottom")
            assert_reachable(page.locator('#ovPack button[onclick="closePack()"]'),"pack refund")
            require(not errors,f"page errors: {errors}")
            results.append({"profile":profile,"options":entries});all_errors.extend(errors)
        finally:
            context.close()
    return issue_result({"fixture":"normal first-blind standard pack purchase, then assigned wild/bonus/steel with red seals and multicolor editions; real touches",
                         "profiles":results,"page_errors":all_errors},issues)


def legacy_pack(browser,url,out,seed,legacy_path):
    context,page,errors=context_page(browser,seed)
    issues=[]
    try:
        legacy=json.loads(legacy_path.read_text(encoding="utf-8"))
        page.goto(url,wait_until="domcontentloaded")
        page.evaluate("raw => {localStorage.setItem('pixel-balatro.run.v1',raw);localStorage.removeItem('pixel-balatro.run.v1.backup');}",legacy["raw"])
        page.reload(wait_until="domcontentloaded")
        page.locator("#resumeBtn").wait_for(state="visible")
        page.locator("#resumeBtn").tap()
        page.locator("#ovPack").wait_for(state="visible")
        get_options="() => S.pack.options.map(c=>({id:c.id,rank:c.rank,suit:c.suit,bonus:c.bonus,multB:c.multB,wild:c.wild,steel:c.steel,glass:c.glass,goldc:c.goldc,ed:c.ed,seal:c.seal}))"
        restored=page.evaluate(get_options)
        screenshot(page,out,"legacy-pack-restored")
        basic=("bonus","multB","wild","steel","glass","goldc")
        identity=("id","rank","suit","ed","seal")
        for i,(old,new) in enumerate(zip(legacy["options"],restored)):
            if any(old[key]!=new[key] for key in identity):
                issues.append({"requirement":"legacy candidate identity, rank, suit, edition and seal unchanged",
                               "index":i,"original":old,"restored":new})
            old_enh={key:old[key] for key in basic if old[key]}
            new_enh={key:new[key] for key in basic if new[key]}
            if (old_enh and new_enh!=old_enh) or (not old_enh and len(new_enh)!=1):
                issues.append({"requirement":"legacy enhancement preserved or one basic enhancement added",
                               "index":i,"original":old,"restored":new})
        if len(restored)!=len(legacy["options"]):
            issues.append({"requirement":"legacy pack keeps same candidate count", "restored":restored})
        page.locator('#ovPack button[onclick="closePack()"]',).tap()
        page.locator("#ovPack").wait_for(state="hidden")
        select_shop_tab(page,"packs",True)
        page.locator("#shopPacks .shopItem").filter(has_text="标准包").tap()
        page.locator("#ovPack").wait_for(state="visible")
        reopened=page.evaluate(get_options)
        screenshot(page,out,"legacy-pack-reopened")
        if reopened!=restored:
            issues.append({"requirement":"legacy pack candidates unchanged after cancel and repurchase",
                           "restored":restored,"reopened":reopened})
        require(not errors,f"page errors: {errors}")
        return issue_result({"fixture":"actual 1.3.1 save from real first blind and open pack, injected into isolated localStorage; resume/cancel/repurchase by touch",
                             "legacy_file":str(legacy_path),"original":legacy["options"],
                             "restored":restored,"reopened":reopened,"page_errors":errors},issues)
    finally:
        context.close()


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--browser",default=r"D:\Quark\quark.exe")
    parser.add_argument("--app-dir",type=Path,default=ROOT)
    parser.add_argument("--output-dir",type=Path,required=True)
    parser.add_argument("--seed",type=int,default=1)
    parser.add_argument("--mode",choices=("baseline","fixed"),default="fixed")
    parser.add_argument("--legacy-save",type=Path,
                        help="actual pre-upgrade standard-pack save to enable the optional legacy_pack case")
    parser.add_argument("--only",action="append")
    args=parser.parse_args()
    args.app_dir=args.app_dir.resolve();args.output_dir=args.output_dir.resolve()
    args.output_dir.mkdir(parents=True,exist_ok=True)
    raw=(args.app_dir/"balatro.html").read_bytes()
    result={"app_dir":str(args.app_dir),"bytes":len(raw),"sha256":hashlib.sha256(raw).hexdigest(),
            "mode":args.mode,"browser":args.browser,"seed":args.seed,"cases":{}}
    process,url=start_server(args.app_dir)
    try:
        with sync_playwright() as pw:
            browser=pw.chromium.launch(executable_path=args.browser,headless=True,
                args=["--disable-extensions","--disable-background-networking"])
            try:
                cases={"standard_pack":lambda:standard_pack(browser,url,args.output_dir,args.seed),
                       **{name:(lambda n=name:stateful_joker(browser,url,args.output_dir,args.seed,n))
                          for name in ("green_current","bus_current","bus_face_reset","runner_current")},
                       "green_discard":lambda:green_discard(browser,url,args.output_dir,args.seed),
                       "shop_targeted_tarots":lambda:shop_targeted_tarots(browser,url,args.output_dir,args.seed),
                       "no_op_seal":lambda:no_op_seal(browser,url,args.output_dir,args.seed),
                       "seal_eligible_card":lambda:seal_eligible_card(browser,url,args.output_dir,args.seed),
                       "wild_rules":lambda:wild_rules(browser,url,args.output_dir,args.seed),
                       "psychic_button":lambda:psychic_button(browser,url,args.output_dir,args.seed),
                       "targeted_tarot_return":lambda:targeted_tarot_return(browser,url,args.output_dir,args.seed),
                       "composite_badges":lambda:composite_badges(browser,url,args.output_dir,args.seed),
                       "standard_pack_visual":lambda:standard_pack_visual(browser,url,args.output_dir,args.seed),
                       "long_pack_visual":lambda:long_pack_visual(browser,url,args.output_dir,args.seed)}
                if args.legacy_save:
                    cases["legacy_pack"]=lambda:legacy_pack(browser,url,args.output_dir,args.seed,args.legacy_save.resolve())
                require(not args.only or not (set(args.only)-set(cases)),f"unknown cases: {args.only}")
                for name,run in cases.items():
                    if args.only and name not in args.only: continue
                    try:
                        data=run()
                    except Exception as exc:
                        data={"status":"failed","error":f"{type(exc).__name__}: {exc}","traceback":traceback.format_exc()}
                    result["cases"][name]=data
                    print(name.upper()+" "+data["status"]+" "+data.get("error",""),flush=True)
            finally:
                browser.close()
    finally:
        process.terminate()
        try: process.wait(timeout=5)
        except Exception: process.kill()
        (args.output_dir/"results.json").write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding="utf-8")
    return int(any(case["status"]=="failed" or (args.mode=="fixed" and case["status"]!="passed")
                   for case in result["cases"].values()))


if __name__=="__main__":
    sys.exit(main())
