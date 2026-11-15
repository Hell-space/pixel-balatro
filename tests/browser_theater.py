"""Play the theater using keyboard, mouse and touch in disposable Quark browser contexts."""
import argparse
import json
import re
from datetime import datetime, timedelta
from pathlib import Path

from playwright.sync_api import sync_playwright
from browser_smoke import ROOT, activate, context_for, start_blind, watch_page
from browser_upgrade import PROFILES


def perform(browser, name, spec, output):
    context = context_for(browser,spec,39)
    context.add_init_script("""localStorage.setItem('pixel-balatro.settings.v1',
        JSON.stringify({speed:0,music:false,sound:false}))""")
    page = context.new_page()
    page.emulate_media(reduced_motion="reduce")
    page.set_default_timeout(6000)
    errors = watch_page(page)
    touch = spec["mobile"]

    def press(css):
        activate(page.locator(css),touch)

    def pick(*cards):
        for code in cards:
            suit = {"♠":"黑桃","♥":"红桃","♣":"梅花","♦":"方块"}[code[0]]
            rank = code[1:]
            label = re.compile("^" + suit + r"\s*" + rank + r"(?:，|$)")
            activate(page.locator("#actHand").get_by_role("button",name=label),touch)

    def submit():
        press("#actPlay")
        page.locator("#theaterResult").wait_for(state="visible")

    def expect_result(total):
        assert page.locator("#actFinalScore").inner_text() == f"{total:,} 分"

    def shot(label):
        page.screenshot(path=str(output / (name+"-"+label+".png")),animations="disabled")

    try:
        page.goto((ROOT/"balatro.html").as_uri())
        press("#theaterBtn")
        assert page.locator("#theaterBills button").count()==6
        shot("program")
        press('[data-bill="short"]')
        pick("♠K");submit();expect_result(315)
        assert "285" in page.locator("#actMargin").inner_text()
        press("#actContinue")
        if not touch:
            for key in ("1","2","3"): page.keyboard.press(key)
        else: pick("♠K","♥K","♣K")
        assert "1,380" in page.locator("#actFormula").inner_text()
        submit();expect_result(1380)
        press("#actContinue")

        pick("♠A","♣A","♥9","♦9")
        assert "120" in page.locator("#actFormula").inner_text()
        press("#actHint");press("#actHint")
        assert "红牌" in page.locator("#actClueText").inner_text()
        pick("♥2")
        assert page.locator("#actHand .actKicker").count()==1
        assert "×3" in page.locator(".actJokerEffect").inner_text()
        submit();expect_result(360);press("#actContinue")

        pick("♠K","♠10","♠8","♠5","♠2")
        submit();expect_result(3920);press("#actContinue")
        pick("♠8","♥8","♣8","♦4","♠4")
        assert "1,440" in page.locator("#actFormula").inner_text()
        press("#actSwap")
        assert "2,592" in page.locator("#actFormula").inner_text()
        assert page.evaluate("""() => {const b=document.getElementById('actPlay').getBoundingClientRect();
            return b.top>=0 && b.bottom<=innerHeight && document.documentElement.scrollWidth<=innerWidth}""")
        shot("duet")
        submit();expect_result(2592);press("#actContinue")

        pick("♠4","♦2");press("#actDiscard")
        page.wait_for_function("!theaterAnimating")
        assert "补牌区已空" in page.locator("#actStock").inner_text() and page.locator("#actDiscard").is_disabled()
        pick("♣A","♦A","♠A","♠K","♥K")
        submit();expect_result(2448);press("#actContinue")

        pick("♠K","♣K","♦K");press("#actPlay")
        page.wait_for_function("!theaterAnimating")
        assert page.locator("#actScore").inner_text()=="180"
        pick("♥Q","♥J","♥9","♥6","♥2")
        assert "3,706" in page.locator("#actFormula").inner_text()
        submit();expect_result(3886)
        assert page.locator(".actHistoryRow").count()==2
        shot("receipt");press("#actContinue")
        assert "6 / 6" in page.locator("#theaterPosition").inner_text()

        daily = page.locator("#dailyTicket button")
        daily_id = daily.get_attribute("data-bill")
        activate(daily,touch)
        daily_hand = page.locator("#actHand .card").evaluate_all("cards=>cards.map(e=>e.getAttribute('aria-label'))")
        press("#theaterReset")
        assert daily_hand == page.locator("#actHand .card").evaluate_all("cards=>cards.map(e=>e.getAttribute('aria-label'))")
        solution=page.evaluate("""() => {
            const here=bestSelection(theaterRun),other=bestSelection({...theaterRun,jokers:[...theaterRun.jokers].reverse()});
            return {swapped:other.total>here.total,ids:other.total>here.total?other.ids:here.ids,score:theaterRun.bill.encore};
        }""")
        if solution["swapped"]: press("#actSwap")
        for card_id in solution["ids"]: press(f'#actHand [data-card-id="{card_id}"]')
        submit();expect_result(solution["score"])
        # Keyboard back and Android back both unwind to the program before leaving it.
        page.keyboard.press("Escape")
        assert page.locator("#theaterProgram").is_visible()
        assert page.evaluate("nativeBack()") is False
        assert page.locator("#ovStart").is_visible() and page.locator("#ovTheater").is_hidden()
        page.reload();press("#theaterBtn")
        assert daily_id==page.locator("#dailyTicket button").get_attribute("data-bill")
        assert "满堂彩" in page.locator("#dailyTicket .ticketEnd").inner_text()
        assert "6 / 6" in page.locator("#theaterPosition").inner_text()
        assert page.locator("#theaterBills .ticketEnd").all_inner_texts()==["✷ 满堂彩"]*6
        if not touch:
            # Leave the program open across midnight. Opening it now starts tomorrow's bill,
            # while replaying a bill already on stage preserves its original deal.
            tomorrow=datetime.fromisoformat(daily_id.removeprefix("daily-"))+timedelta(days=1,hours=12)
            page.clock.set_fixed_time(tomorrow)
            press("#dailyTicket button")
            assert page.locator("#theaterPosition").inner_text()==tomorrow.date().isoformat()
            page.clock.set_fixed_time(tomorrow+timedelta(days=1))
            press("#theaterReset")
            assert page.locator("#theaterPosition").inner_text()==tomorrow.date().isoformat()
            press("#theaterBackBtn")
            assert "满堂彩" not in page.locator("#dailyTicket .ticketEnd").inner_text()
        press("#theaterBackBtn")

        # A theater visit from a running game must preserve the actual solo save and selection.
        start_blind(page,touch)
        press("#handRow .card:first-child")
        page.evaluate("persistRun()")
        old_save=page.evaluate("localStorage.getItem(RUN_KEY)")
        press("#menuBtn");press("#menuTheaterBtn");press('[data-bill="short"]')
        pick("♠K");submit();press("#theaterBackBtn");press("#theaterBackBtn")
        assert page.locator("#ovMenu").is_visible() and page.locator("#ovTheater").is_hidden()
        assert page.evaluate("localStorage.getItem(RUN_KEY)")==old_save
        assert page.evaluate("nativeBack()") is False
        assert page.locator("#handRow .card.sel").count()==1
        assert not errors,errors
        return {"sized":[spec["width"],spec["height"]],"encores":6,"daily":daily_id,"soloSavePreserved":True}
    except Exception:
        shot("failure");raise
    finally:
        context.close()


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--browser",default=r"D:\Quark\quark.exe")
    parser.add_argument("--output-dir",type=Path,default=ROOT/".qa/v190/theater")
    args=parser.parse_args()
    args.output_dir.mkdir(parents=True,exist_ok=True)
    with sync_playwright() as pw:
        browser=pw.chromium.launch(executable_path=args.browser,headless=True)
        results={}
        for name,spec in PROFILES.items():
            results[name]=perform(browser,name,spec,args.output_dir)
            print(name,results[name],flush=True)
        browser.close()
    (args.output_dir/"results.json").write_text(json.dumps(results,indent=2),encoding="utf-8")
