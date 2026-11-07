"""1.7.0 real-input checks: hint, swipe selection, weak point preview, overkill payout and motion layers.

    python -X utf8 tests/browser_upgrade.py --output-dir .qa/upgrade
    python -X utf8 tests/browser_upgrade.py --output-dir .qa/upgrade --only PORTRAIT
"""
from __future__ import annotations

import argparse
import json
import sys
import traceback
from pathlib import Path

from playwright.sync_api import sync_playwright
from browser_extended import start_server
from browser_smoke import ROOT, activate, context_for, require, start_blind, watch_page

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")

PROFILES = {
    "SMALL": {"width": 320, "height": 568, "mobile": True},
    "PORTRAIT": {"width": 390, "height": 844, "mobile": True},
    "LANDSCAPE": {"width": 640, "height": 360, "mobile": True},
    "DESKTOP": {"width": 1280, "height": 800, "mobile": False},
}


def shot(page, out, name):
    page.screenshot(path=str(out / (name + ".png")), animations="allow")


def state(page, expr):
    return page.evaluate("() => (" + expr + ")")


def card_centers(page):
    return page.evaluate("""() => [...document.querySelectorAll('#handRow .card')].map(e => {
      const r = e.getBoundingClientRect(); return {id: Number(e.dataset.cardId), x: r.x + r.width / 2, y: r.y + r.height / 2,
        inView: r.bottom <= innerHeight && r.right <= innerWidth && r.top >= 0 && r.left >= 0};
    })""")


def check_profile(browser, url, out, name, spec, seed):
    context = context_for(browser, spec, seed)
    page = context.new_page()
    errors = watch_page(page)
    result = {"profile": name}
    try:
        page.goto(url, wait_until="domcontentloaded")
        require(page.locator(".titleMotes i").count() == 16, "title motes missing")
        start_blind(page, spec["mobile"])
        page.wait_for_timeout(900)
        # Deck shoe: visible, counts the draw pile and opens the deck view.
        pile = page.locator("#deckPile")
        require(pile.is_visible(), "deck pile hidden")
        require(page.locator("#deckPileCount").inner_text() == str(state(page, "S.drawPile.length")), "pile count mismatch")
        activate(pile, spec["mobile"])
        page.locator("#ovDeck").wait_for(state="visible")
        page.keyboard.press("Escape") if not spec["mobile"] else activate(page.locator("#ovDeck .dialogActions .pxbtn"), True)
        page.locator("#ovDeck").wait_for(state="hidden")
        page.wait_for_timeout(400)

        # Hint selects the best guaranteed hand without playing it.
        hands_before = state(page, "S.handsLeft")
        activate(page.locator("#btnHint"), spec["mobile"])
        page.wait_for_timeout(150)
        hint = state(page, """{sel: S.hand.filter(c => c.sel).map(c => c.id), best: bestSelection(S),
          scoring: [...document.querySelectorAll('#handRow .card.scoring')].length,
          kicker: [...document.querySelectorAll('#handRow .card.kicker')].length}""")
        require(sorted(hint["sel"]) == sorted(hint["best"]["ids"]), "hint selection mismatch")
        require(hint["scoring"] >= 1 and hint["scoring"] + hint["kicker"] == len(hint["sel"]), "scoring highlight mismatch")
        require(state(page, "S.handsLeft") == hands_before, "hint must not play")
        est = page.locator("#scoreEstimate").inner_text()
        require(est.replace(",", "").startswith(str(hint["best"]["total"])), f"estimate {est} vs {hint['best']['total']}")
        shot(page, out, name + "-hint")
        result["hint"] = hint

        # Swipe across three cards from an unselected start selects them all.
        page.evaluate("S.hand.forEach(c => c.sel = false); renderHand()")
        page.wait_for_timeout(700)
        pts = [p for p in card_centers(page) if p["inView"]][:3]
        require(len(pts) == 3, "not enough visible cards")
        if spec["mobile"]:
            cdp = context.new_cdp_session(page)
            def touch(kind, p):
                cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": [] if kind == "touchEnd" else [{"x": p["x"], "y": p["y"]}]})
            touch("touchStart", pts[0])
            for a, b in zip(pts, pts[1:]):
                for k in range(1, 6):
                    touch("touchMove", {"x": a["x"] + (b["x"] - a["x"]) * k / 5, "y": a["y"] + (b["y"] - a["y"]) * k / 5})
            touch("touchEnd", pts[-1])
        else:
            page.mouse.move(pts[0]["x"], pts[0]["y"]); page.mouse.down()
            for p in pts[1:]:
                page.mouse.move(p["x"], p["y"], steps=6)
            page.mouse.up()
        page.wait_for_timeout(250)
        swiped = state(page, "S.hand.filter(c => c.sel).map(c => c.id)")
        require(sorted(swiped) == sorted(p["id"] for p in pts), f"swipe selected {swiped}")
        result["swipe"] = len(swiped)

        # Keyboard: Escape clears, digits toggle, S sorts (desktop only).
        if not spec["mobile"]:
            page.keyboard.press("Escape"); page.wait_for_timeout(80)
            require(state(page, "S.hand.filter(c => c.sel).length") == 0, "Esc did not clear")
            page.keyboard.press("1"); page.keyboard.press("2"); page.wait_for_timeout(80)
            require(state(page, "S.hand.filter(c => c.sel).map(c => S.hand.indexOf(c))") == [0, 1], "digit keys")
            mode = state(page, "S.sortMode"); page.keyboard.press("s"); page.wait_for_timeout(80)
            require(state(page, "S.sortMode") != mode, "S key sort toggle")
            page.keyboard.press("Escape")

        # Real play: the hint hand scores, total rolls and the payout row appears when overkilling.
        page.evaluate("""S.jokers = [{...JDEFS.find(j => j.id === 'trio'), uid: 9001, state: 0, ed: 0},
          {...JDEFS.find(j => j.id === 'jolly'), uid: 9002, state: 0, ed: 0}]; renderAll()""")
        activate(page.locator("#btnHint"), spec["mobile"]); page.wait_for_timeout(150)
        best = state(page, "bestSelection(S).ids")
        chosen = state(page, "S.hand.filter(c => c.sel).map(c => c.id)")
        require(sorted(chosen) == sorted(best), f"second hint {chosen} vs {best}")
        activate(page.locator("#btnPlay"), spec["mobile"])
        page.wait_for_timeout(700)
        sparks = state(page, "document.querySelectorAll('#feedbackLayer .spark').length")
        shot(page, out, name + "-scoring")
        page.wait_for_function("S.screen !== 'play' || !S.busy", timeout=15000)
        page.wait_for_timeout(300)
        play = state(page, "{screen: S.screen, score: S.score, target: S.target, payout: S.payout}")
        result["play"] = play
        result["sparks"] = sparks
        if play["screen"] == "cash":
            ratio = play["score"] / play["target"]
            row = [r for r in play["payout"] if r[0].startswith("碾压")]
            expect = min(3, int(ratio) - 1) if ratio >= 2 else 0
            require((row[0][1] if row else 0) == expect, f"overkill {row} for ratio {ratio:.2f}")
            require(sum(v for _, v in play["payout"][:-1]) == play["payout"][-1][1], "payout total")
            shot(page, out, name + "-cash")
            page.wait_for_timeout(1300)
            require(page.locator("#cashRows p").last.locator("b").inner_text() == "$" + str(play["payout"][-1][1]), "rolled total")

            # Boss weak point: preview flags it and scoring adds the ×1.5 event.
            activate(page.locator("#ovCash .pxbtn"), spec["mobile"])
            page.locator("#ovShop").wait_for(state="visible")
            page.wait_for_timeout(600)
            page.evaluate("leaveShop()"); page.wait_for_timeout(300)
            page.evaluate("S.blindIdx = 2; S.anteBoss = {...BOSSES.find(b => b.id === 'arm')}; showBlindSelect()")
            page.wait_for_timeout(400)
            require("破绽：对子" in page.locator("#blindCols .cur").inner_text(), "boss card weak label")
            shot(page, out, name + "-boss")
            activate(page.locator("#blindCols .cur .bbtn:not(.skip)"), spec["mobile"])
            page.wait_for_timeout(1000)
            require("破绽：对子" in page.locator("#bossDesc").inner_text(), "boss desc weak label")
            pair = state(page, """(() => { const by = {}; for (const c of S.hand) (by[c.rank] ||= []).push(c.id);
              return Object.values(by).find(v => v.length >= 2)?.slice(0, 2) || null; })()""")
            if pair:
                page.evaluate("ids => { S.hand.forEach(c => c.sel = ids.includes(c.id)); renderHand(); }", pair)
                page.wait_for_timeout(100)
                require(page.locator("#previewBox.weakHit").count() == 1, "weak preview flag")
                activate(page.locator("#btnPlay"), spec["mobile"])
                page.wait_for_function("S.lastResult && S.lastResult.events.some(e => e.text.startsWith('破绽'))", timeout=15000)
                result["weak"] = state(page, "S.lastResult.events.at(-1)")
        require(not errors, "page errors: " + "; ".join(errors))
        result["ok"] = True
    except Exception as exc:  # noqa: BLE001 - record and continue
        result["ok"] = False
        result["error"] = f"{type(exc).__name__}: {exc}"
        traceback.print_exc()
        try:
            shot(page, out, name + "-failure")
        except Exception:  # noqa: BLE001
            pass
    finally:
        context.close()
    return result


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--browser", default=r"D:\Quark\quark.exe")
    p.add_argument("--app-dir", type=Path, default=ROOT)
    p.add_argument("--output-dir", type=Path, required=True)
    p.add_argument("--seed", type=int, default=1)
    p.add_argument("--only", action="append")
    args = p.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    server, url = start_server(args.app_dir.resolve())
    results = []
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(executable_path=args.browser, headless=True)
            for name, spec in PROFILES.items():
                if args.only and name not in args.only:
                    continue
                r = check_profile(browser, url + "/balatro.html", args.output_dir, name, spec, args.seed)
                print(name, "passed" if r["ok"] else "failed " + r.get("error", ""))
                results.append(r)
            browser.close()
    finally:
        server.terminate()
    (args.output_dir / "results.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    sys.exit(0 if all(r["ok"] for r in results) else 1)


if __name__ == "__main__":
    main()
