"""Replay the open deck through real mouse/touch controls in an isolated Quark profile."""
import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright

from browser_smoke import ROOT, activate, context_for, require, screenshot, watch_page
from browser_upgrade import PROFILES


def shown_card(page):
    return int(page.locator("#deckFace .card").get_attribute("data-card-id"))


def snap_positions(page):
    return page.evaluate("""() => ['#handWrap','#previewBox','#btnRow','#deckPile'].map(id => {
      const box = document.querySelector(id).getBoundingClientRect();
      return [Math.round(box.x), Math.round(box.y), Math.round(box.width)];
    })""")


def check_profile(browser, name, spec, output):
    context = context_for(browser, spec, 35)
    context.add_init_script("""localStorage.setItem('pixel-balatro.settings.v1',
      JSON.stringify({speed:0, music:false, sound:false}))""")
    page = context.new_page()
    page.set_default_timeout(5000)
    errors = watch_page(page)
    touch = spec["mobile"]
    def press(selector):
        activate(page.locator(selector), touch)
    try:
        page.emulate_media(reduced_motion="reduce")
        page.goto((ROOT / "balatro.html").as_uri())
        press("#newBtn")
        press('[data-deck="open"]')
        require(page.locator('[data-deck="open"]').get_attribute("aria-pressed") == "true", "deck choice")
        press("#beginRunBtn")
        press("#blindCols .cur .bbtn:not(.skip)")
        require(page.locator("#reserveBtn").is_hidden(), "pocket available on open deck")
        top = shown_card(page)
        require(top == page.evaluate("S.drawPile.at(-1).id"), "top must be the next real card")
        require(page.locator("#deckPileCount").inner_text() == "44", "top already deducted")
        bounds = page.locator("#openTopReadout").bounding_box()
        require(bounds and bounds["y"] >= 0 and bounds["x"] + bounds["width"] <= spec["width"], "top label outside viewport")
        require(page.evaluate("""() => {
          const row = document.querySelector('#btnRow').getBoundingClientRect();
          return row.bottom <= innerHeight + 1 && document.documentElement.scrollWidth <= innerWidth;
        }"""), "clipped action row")
        screenshot(page, output, name + "-table")

        before = snap_positions(page)
        press("#deckPile")
        require(page.locator("#deckGrid .openTopCell").count() == 1, "deck grid top marker")
        require(page.locator(".openCardDetails").is_visible(), "face details unavailable")
        press('#deckSuitFilters [data-suit="1"]')
        press("#ovDeck .dialogActions button")
        require(snap_positions(page) == before and shown_card(page) == top, "deck inspection moved table or drew")

        press("#handRow .card:nth-child(1)")
        press("#handRow .card:nth-child(2)")
        require("1 张暗牌" in page.locator("#openTopNote").inner_text(), "extra draw should stay unknown")
        press("#btnDiscard")
        require(page.evaluate("S.hand.some(c => c.id === " + str(top) + ")"), "shown card didn't arrive")
        mark = page.locator("#handRow .fromOpenTop")
        require(mark.count() == 1 and int(mark.get_attribute("data-card-id")) == top, "wrong arrival marker")
        require(page.locator("#discVal").inner_text() == "2" and page.locator("#deckPileCount").inner_text() == "42", "discard cost or pile")
        next_top = shown_card(page)
        require(next_top != top, "preview didn't advance")
        page.reload()
        press("#resumeBtn")
        require(shown_card(page) == next_top and page.locator("#deckPileCount").inner_text() == "42", "cold resume")

        # Same fixed eight-card hand in both branches. All decisions after setup use the controls.
        def position(score, target, hands):
            page.evaluate("""([score,target,hands]) => {
              const at=(r,s)=>S.deckAll.find(c=>c.rank===r && c.suit===s);
              const king=at(13,0);
              S.hand=[[9,0],[10,1],[11,2],[12,3],[3,0],[3,1],[7,3],[2,2]].map(([r,s])=>at(r,s));
              S.hand.forEach(c=>c.sel=false);
              S.drawPile=S.deckAll.filter(c=>!S.hand.includes(c) && c!==king).concat(king);
              Object.assign(S,{score,target,handsLeft:hands,discLeft:1});
              sortHand();renderAll();persistRun();
            }""", [score,target,hands])
        position(40,300,1)
        press('#handRow [aria-label="梅花2"]')
        require("只摸这张" in page.locator("#openTopNote").inner_text(), "single draw cue")
        screenshot(page, output, name + "-king")
        press("#btnDiscard")
        press("#btnHint")
        require("316" in page.locator("#scoreEstimate").inner_text(), "straight preview")
        press("#btnPlay")
        page.locator("#ovCash").wait_for(state="visible")
        require(page.evaluate("S.score") == 356, "wrong score after guaranteed draw")
        press("#ovCash .pxbtn")
        press("#ovShop .shopActions button:last-child")
        press("#blindCols .cur .bbtn:not(.skip)")
        position(110,450,2)
        press('#handRow [aria-label="黑桃3"]')
        press('#handRow [aria-label="红桃3"]')
        press("#btnPlay")
        page.wait_for_function("!S.busy && S.score===142")
        require(page.locator('#handRow [data-card-id].fromOpenTop .rk').inner_text() == 'K', 'played pair did not draw K')
        for label in ("黑桃9","红桃10","梅花J","方块Q","黑桃K"):
            press('#handRow [aria-label^="' + label + '"]')
        require("316" in page.locator("#scoreEstimate").inner_text(), "known straight independent of second draw")
        press("#btnPlay")
        page.locator("#ovCash").wait_for(state="visible")
        require(page.evaluate("S.score===458 && S.discLeft===1"), "pair-first route")
        require(not errors, str(errors))
        return {"viewport":[spec["width"],spec["height"]],"initialTop":top,"resumedTop":next_top,
                "discardFirst":356,"playFirst":458}
    except Exception:
        screenshot(page, output, name + "-failure")
        raise
    finally:
        context.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--browser", default=r"D:\Quark\quark.exe")
    parser.add_argument("--output-dir", type=Path, default=ROOT / ".qa/v180/open-top")
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=args.browser,headless=True)
        results = {}
        for name,spec in PROFILES.items():
            results[name] = check_profile(browser,name,spec,args.output_dir)
            print(name,results[name],flush=True)
        browser.close()
    (args.output_dir / "results.json").write_text(json.dumps(results,indent=2),encoding="utf-8")
