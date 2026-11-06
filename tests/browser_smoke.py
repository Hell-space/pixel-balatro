"""Real browser smoke checks for the single-file game and its Node server.

Requires the existing Python Playwright package and a Chromium-compatible browser.
The browser uses a temporary Playwright profile and runs headlessly. Game inputs
are clicks/taps; a seeded RNG and disabled audio make the deal reproducible. The
test never writes the game state or invokes game actions through JavaScript.

    python tests/browser_smoke.py
    python tests/browser_smoke.py --browser D:\\Quark\\quark.exe
    python tests/browser_smoke.py --base-url http://127.0.0.1:8080

Set BALATRO_BROWSER as an alternative to --browser. With no --base-url, this
script starts and stops its own loopback Node server on an available port. It
also opens balatro.html as a file and checks a two-client multiplayer pairing.
When no browser override is supplied, the installed Playwright Chromium is used.
Screenshots and a machine-readable result are written under .qa/browser-smoke.
"""

from __future__ import annotations

import argparse
import itertools
import json
import os
import re
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path

from playwright.sync_api import sync_playwright

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(errors="backslashreplace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(errors="backslashreplace")


ROOT = Path(__file__).resolve().parents[1]
PROFILES = {
    "portrait": {"width": 390, "height": 844, "mobile": True},
    "short": {"width": 360, "height": 640, "mobile": True},
    "landscape": {"width": 844, "height": 390, "mobile": True},
    "desktop": {"width": 1365, "height": 768, "mobile": False},
}

# Base chips, base multiplier and displayed name, matching the published rules.
HAND_RULES = {
    "sf": (100, 8, "同花顺"), "four": (60, 7, "四条"),
    "fh": (40, 4, "葫芦"), "flush": (35, 4, "同花"),
    "straight": (30, 4, "顺子"), "trips": (30, 3, "三条"),
    "twopair": (20, 2, "两对"), "pair": (10, 2, "对子"),
    "high": (5, 1, "高牌"),
}
RANKS = {"J": 11, "Q": 12, "K": 13, "A": 14}


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def number(text):
    found = re.search(r"\d[\d,]*", text)
    require(found is not None, f"Expected a number in {text!r}")
    return int(found.group().replace(",", ""))


def read_number(page, selector):
    return number(page.locator(selector).inner_text())


def cards_on_screen(page):
    result = []
    for card in page.locator("#handRow .card").all():
        rank_text = card.locator(".rk").inner_text().strip().upper()
        rank = RANKS[rank_text] if rank_text in RANKS else int(rank_text)
        # The text presentation selector keeps suit glyphs out of emoji mode;
        # it does not change the suit's identity for the scoring oracle.
        suit = card.locator(".st").inner_text().strip().replace("\ufe0e", "")
        result.append((rank, suit))
    return result


def score_unmodified_hand(cards):
    """Independent first-blind scoring oracle for ordinary, unmodified cards."""
    counts = Counter(rank for rank, _ in cards)
    groups = sorted(counts.items(), key=lambda item: (-item[1], -item[0]))
    ranks = sorted(counts)
    straight = len(cards) == 5 and len(ranks) == 5 and (
        ranks[-1] - ranks[0] == 4 or ranks == [2, 3, 4, 5, 14]
    )
    flush = len(cards) == 5 and len({suit for _, suit in cards}) == 1
    if straight and flush:
        key, scoring = "sf", cards
    elif groups[0][1] == 4:
        key, scoring = "four", [c for c in cards if c[0] == groups[0][0]]
    elif groups[0][1] == 3 and len(groups) > 1 and groups[1][1] >= 2:
        key, scoring = "fh", cards
    elif flush:
        key, scoring = "flush", cards
    elif straight:
        key, scoring = "straight", cards
    elif groups[0][1] == 3:
        key, scoring = "trips", [c for c in cards if c[0] == groups[0][0]]
    elif groups[0][1] == 2 and len(groups) > 1 and groups[1][1] == 2:
        key = "twopair"
        scoring = [c for c in cards if c[0] in (groups[0][0], groups[1][0])]
    elif groups[0][1] == 2:
        key, scoring = "pair", [c for c in cards if c[0] == groups[0][0]]
    else:
        key, scoring = "high", [max(cards, key=lambda c: c[0])]
    base, mult, name = HAND_RULES[key]
    chips = sum(11 if rank == 14 else min(rank, 10) for rank, _ in scoring)
    return (base + chips) * mult, name, base, mult


def best_hand(cards):
    candidates = []
    for size in range(1, min(5, len(cards)) + 1):
        for indices in itertools.combinations(range(len(cards)), size):
            score, name, base, mult = score_unmodified_hand([cards[i] for i in indices])
            # Keep unneeded cards in hand when two choices score equally.
            candidates.append((score, -size, indices, name, base, mult))
    require(candidates, "No cards to play")
    return max(candidates)


def activate(locator, mobile):
    if mobile:
        locator.tap(timeout=10000)
    else:
        locator.click(timeout=10000)


def select_shop_tab(page, tab, mobile):
    """Use the category control when present; pre-tab builds show every item."""
    selector = {"cards": "#shopTabCards", "cons": "#shopTabCons",
                "packs": "#shopTabPacks", "voucher": "#shopTabVoucher"}[tab]
    button = page.locator(selector)
    if not button.count():
        return False
    require(button.is_visible() and button.is_enabled(), f"Shop tab {tab} is not reachable")
    activate(button, mobile)
    require(button.get_attribute("aria-selected") == "true", f"Shop tab {tab} was not selected")
    return True


def shown(locator):
    return locator.count() > 0 and locator.first.is_visible()


def new_button(page):
    button = page.locator("#newBtn")
    if button.count():
        return button
    return page.locator('#ovStart button[onclick="newGame(false)"]')


def screenshot(page, output, name):
    page.screenshot(path=str(output / f"{name}.png"), full_page=False, animations="disabled")


def assert_viewport(page, width):
    dims = page.evaluate("""() => ({
      inner: innerWidth, document: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
      visual: visualViewport ? visualViewport.width : innerWidth
    })""")
    require(abs(dims["inner"] - width) <= 2 and abs(dims["visual"] - width) <= 2,
            f"Viewport was scaled: expected {width} CSS px, got {dims}")
    require(dims["scroll"] <= dims["document"] + 1,
            f"The page has horizontal overflow: {dims}")
    return dims


def assert_reachable(locator, label):
    locator.scroll_into_view_if_needed(timeout=10000)
    bounds = locator.bounding_box()
    require(bounds and bounds["width"] >= 24 and bounds["height"] >= 24,
            f"{label} is missing or has an unusably small target: {bounds}")
    details = locator.evaluate("""el => {
      const r = el.getBoundingClientRect();
      const x = Math.max(0, Math.min(innerWidth - 1, r.left + r.width / 2));
      const y = Math.max(0, Math.min(innerHeight - 1, r.top + r.height / 2));
      const hit = document.elementFromPoint(x, y);
      return {left:r.left, top:r.top, right:r.right, bottom:r.bottom,
        width:innerWidth, height:innerHeight, hit:!!hit && (hit === el || el.contains(hit))};
    }""")
    require(details["left"] >= -1 and details["top"] >= -1
            and details["right"] <= details["width"] + 1
            and details["bottom"] <= details["height"] + 1 and details["hit"],
            f"{label} is clipped or covered: {details}")


def seed_context(context, seed):
    # Audio is disabled so its timer cannot consume the deterministic deal RNG.
    context.add_init_script("""(() => {
      window.AudioContext = undefined;
      window.webkitAudioContext = undefined;
      let n = SEED >>> 0;
      Math.random = () => {
        n = (n + 0x6D2B79F5) >>> 0;
        let t = n;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    })();""".replace("SEED", str(seed)))


def context_for(browser, spec, seed):
    context = browser.new_context(
        viewport={"width": spec["width"], "height": spec["height"]},
        is_mobile=spec["mobile"], has_touch=spec["mobile"], locale="zh-CN",
    )
    seed_context(context, seed)
    return context


def watch_page(page):
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    return errors


def request_new_solo(page, mobile):
    """Enter the default setup on 1.3; older builds start directly."""
    page.locator("#ovStart").wait_for(state="visible")
    activate(new_button(page), mobile)
    setup = page.locator("#ovSetup")
    if not setup.count():
        return False
    setup.wait_for(state="visible")
    deck = page.locator("#deckChoices button").filter(has_text="红色牌组")
    stake = page.locator("#stakeChoices button").filter(has_text="白注")
    require(deck.get_attribute("aria-pressed") == "true" and
            stake.get_attribute("aria-pressed") == "true", "Default setup is not red deck / white stake")
    activate(page.locator("#beginRunBtn"), mobile)
    return True


def start_blind(page, mobile):
    page.locator("#ovStart").wait_for(state="visible")
    configured = request_new_solo(page, mobile)
    page.locator("#ovBlinds").wait_for(state="visible")
    challenge = page.locator("#blindCols .cur .bbtn:not(.skip)").first
    assert_reachable(challenge, "Start blind")
    activate(challenge, mobile)
    page.locator("#handRow .card").first.wait_for(state="visible")
    require(page.locator("#handRow .card").count() == 8, "Expected eight dealt cards")
    if configured:
        require([read_number(page, s) for s in ("#handsVal", "#discVal")] == [4, 4],
                "Red deck / white stake should start with 4 hands and 4 discards")


def reload_and_resume(page, mobile, visible_selector):
    page.reload(wait_until="domcontentloaded")
    page.locator("#ovStart").wait_for(state="visible")
    resume = page.locator("#resumeBtn")
    require(shown(resume) and resume.is_enabled(), "Refresh did not offer a usable resume button")
    activate(resume, mobile)
    page.locator(visible_selector).first.wait_for(state="visible", timeout=10000)


def check_selection_and_discard(page, mobile):
    cards = page.locator("#handRow .card")
    for i in range(5):
        activate(cards.nth(i), mobile)
    require(page.locator("#handRow .card.sel").count() == 5, "Could not select five cards")
    activate(cards.nth(5), mobile)
    require(page.locator("#handRow .card.sel").count() == 5, "More than five cards were selectable")
    for i in range(5):
        activate(cards.nth(i), mobile)
    require(page.locator("#handRow .card.sel").count() == 0, "Could not clear selection")
    first = cards_on_screen(page)[0]
    before = read_number(page, "#discVal")
    activate(cards.first, mobile)
    require(page.locator("#btnDiscard").is_enabled(), "Discard did not enable after selection")
    activate(page.locator("#btnDiscard"), mobile)
    require(read_number(page, "#discVal") == before - 1, "Discard counter did not decrease")
    after = cards_on_screen(page)
    require(len(after) == 8 and first not in after, "Discarded card remained or hand was not refilled")
    return {"discarded": first, "remaining_discards": before - 1, "hand": after}


def touch_at(page, x, y, hold_ms=0):
    """Dispatch a real Chromium touch sequence at viewport coordinates."""
    cdp = page.context.new_cdp_session(page)
    try:
        cdp.send("Input.dispatchTouchEvent", {"type": "touchStart",
                 "touchPoints": [{"x": x, "y": y, "id": 1}]})
        if hold_ms:
            page.wait_for_timeout(hold_ms)
        cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    finally:
        cdp.detach()


def swipe_up_within(page, locator):
    bounds = locator.bounding_box()
    require(bounds and bounds["height"] > 0, "Scrollable content has no visible touch area")
    x = bounds["x"] + bounds["width"] / 2
    start_y = bounds["y"] + bounds["height"] * 0.75
    distance = min(90, start_y - 1)
    cdp = page.context.new_cdp_session(page)
    try:
        point = lambda y: [{"x": x, "y": y, "id": 1}]
        cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": point(start_y)})
        for step in range(1, 9):
            cdp.send("Input.dispatchTouchEvent", {"type": "touchMove",
                     "touchPoints": point(start_y - distance * step / 8)})
            time.sleep(0.025)
        cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        page.wait_for_timeout(250)
    finally:
        cdp.detach()


def center_hit(locator):
    return locator.evaluate("""el => {
      const r=el.getBoundingClientRect(), x=r.left+r.width/2, y=r.top+r.height/2;
      const hit=x>=0 && x<innerWidth && y>=0 && y<innerHeight && document.elementFromPoint(x,y);
      return {x,y,visible:!!hit && (hit===el || el.contains(hit))};
    }""")


def check_long_press(page, output, profile):
    card = page.locator("#handRow .card").first
    assert_reachable(card, "Long-press card")
    pos = center_hit(card)
    require(pos["visible"], f"Card center is not touchable: {pos}")
    cdp = page.context.new_cdp_session(page)
    try:
        cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [
            {"x": pos["x"], "y": pos["y"], "id": 1}]})
        page.locator("#tip").wait_for(state="visible", timeout=3000)
        require("筹码" in page.locator("#tip").inner_text(), "Long press did not show card details")
        screenshot(page, output, profile + "-long-press")
        cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    finally:
        cdp.detach()
    require(page.locator("#handRow .card.sel").count() == 0,
            "Long press accidentally selected the card")
    activate(card, True)
    require(card.get_attribute("aria-pressed") == "true", "Card could not be selected after long press")
    activate(card, True)
    require(card.get_attribute("aria-pressed") == "false", "Card could not be deselected after long press")
    return {"details_visible": True, "accidental_selection": False, "subsequent_tap_works": True}


def check_menu(page, mobile):
    menu = page.locator("#menuBtn")
    assert_reachable(menu, "Menu")
    activate(menu, mobile)
    page.locator("#ovMenu").wait_for(state="visible")
    activate(page.locator("#ovMenu button").filter(has_text="牌型表"), mobile)
    page.locator("#ovChart").wait_for(state="visible")
    require("同花" in page.locator("#chartBody").inner_text(), "Hand chart did not render")
    activate(page.locator("#ovChart button").last, mobile)
    page.locator("#ovChart").wait_for(state="hidden")


def play_best_first_blind(page, mobile):
    score_before = read_number(page, "#scoreVal")
    cards = cards_on_screen(page)
    expected, _, indices, name, base, mult = best_hand(cards)
    for i in indices:
        activate(page.locator("#handRow .card").nth(i), mobile)
    require(page.locator("#prevName").inner_text().strip() == name,
            f"Wrong hand preview; expected {name}, got {page.locator('#prevName').inner_text()!r}")
    # Newer builds preview the selected cards' complete chips and multiplier;
    # the independent oracle above includes only ordinary first-blind cards.
    # Older builds displayed the bare base values instead.
    estimate = page.locator("#scoreEstimate")
    expected_chips = expected // mult if estimate.count() else base
    require(read_number(page, "#prevChips") == expected_chips and read_number(page, "#prevMult") == mult,
            f"Wrong score preview for {name}; expected {expected_chips} × {mult}")
    if estimate.count():
        require(read_number(page, "#scoreEstimate") == expected,
                f"Wrong estimated score for {name}; expected {expected}")
    hands_before = read_number(page, "#handsVal")
    activate(page.locator("#btnPlay"), mobile)
    page.wait_for_function("""before => {
      const n = Number(document.querySelector('#scoreVal').textContent.replace(/[^0-9]/g, ''));
      // Animated scoring now updates the visible total before finishing the
      // play and refilling the hand; a refresh is safe only once it settles.
      return n > before && S && !S.busy;
    }""", arg=score_before, timeout=20000)
    score_after = read_number(page, "#scoreVal")
    require(score_after - score_before == expected,
            f"Score mismatch: {name} {indices}, expected +{expected}, got +{score_after-score_before}")
    require(read_number(page, "#handsVal") == hands_before - 1, "Play counter did not decrease")
    return {"hand": name, "cards": [cards[i] for i in indices], "points": expected, "score": score_after}


def verify_shop_purchase(page, mobile):
    select_shop_tab(page, "cards", mobile)
    money_before = read_number(page, "#shopMoney")
    slots_before = read_number(page, "#shopSlots")
    candidates = page.locator("#shopItems .shopItem")
    chosen = None
    for i in range(min(2, candidates.count())):
        item = candidates.nth(i)
        price_text = item.locator(".pr").inner_text()
        price = 0 if "免费" in price_text else number(price_text)
        if price <= money_before:
            chosen = (i, price, item.locator(".nm").inner_text())
            break
    require(chosen is not None, f"Neither joker was affordable with ${money_before}")
    index, price, name = chosen
    activate(candidates.nth(index), mobile)
    require(read_number(page, "#shopMoney") == money_before - price, "Purchase did not deduct price")
    require(read_number(page, "#shopSlots") == slots_before + 1, "Purchased joker did not occupy a slot")
    require("sold" in candidates.nth(index).get_attribute("class"), "Purchased joker is not marked sold")
    return {"name": name, "price": price, "money": money_before-price}


def check_shop_swipe(page):
    box = page.locator("#ovShop .box")
    before = box.evaluate("el => ({top:el.scrollTop, max:el.scrollHeight-el.clientHeight})")
    if before["max"] <= 2:
        return {"needed": False}
    bounds = box.bounding_box()
    x = bounds["x"] + 8
    moving_down = before["top"] < before["max"] / 2
    # A moderate swipe keeps products visible; use a real touch sequence, not scrollTop.
    first_y = bounds["y"] + bounds["height"] * (0.75 if moving_down else 0.25)
    last_y = bounds["y"] + bounds["height"] * (0.5 if moving_down else 0.5)
    cdp = page.context.new_cdp_session(page)
    point = lambda y: [{"x": x, "y": y, "id": 1}]
    try:
        cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": point(first_y)})
        for step in range(1, 9):
            y = first_y + (last_y - first_y) * step / 8
            cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": point(y)})
            time.sleep(0.025)
        cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        page.wait_for_timeout(250)
        after = box.evaluate("el => el.scrollTop")
        require(abs(after - before["top"]) > 5,
                f"Touch swipe did not scroll the shop: {before}, after={after}")
        return {"needed": True, "before": before["top"], "after": after}
    finally:
        cdp.detach()


def purchase_scrolled_consumable(page):
    """Buy a visible consumable by touch, after a swipe or category selection."""
    select_shop_tab(page, "cons", True)
    before_money = read_number(page, "#shopMoney")
    before_slots = read_number(page, "#shopCons")
    items = page.locator("#shopItems .shopItem")
    for i in range(2, items.count()):
        item = items.nth(i)
        cost = number(item.locator(".pr").inner_text())
        pos = center_hit(item)
        if cost <= before_money and pos["visible"]:
            name = item.locator(".nm").inner_text()
            touch_at(page, pos["x"], pos["y"])
            require(read_number(page, "#shopMoney") == before_money - cost,
                    "Touch purchase did not deduct the price")
            require(read_number(page, "#shopCons") == before_slots + 1,
                    "Touch purchase did not fill a consumable slot")
            require("sold" in items.nth(i).get_attribute("class"), "Purchased item not marked sold")
            return {"name": name, "price": cost, "scrollTop": page.locator('#ovShop .box').evaluate('el => el.scrollTop')}
    raise AssertionError("No affordable consumable had a reachable touch center")


def gameplay_case(browser, base_url, profile_name, spec, output, seed):
    context = context_for(browser, spec, seed)
    page = context.new_page()
    errors = watch_page(page)
    mobile = spec["mobile"]
    result = {"profile": profile_name, "size": [spec["width"], spec["height"]]}
    try:
        page.goto(base_url, wait_until="domcontentloaded")
        page.locator("#ovStart").wait_for(state="visible")
        result["viewport"] = assert_viewport(page, spec["width"])
        assert_reachable(new_button(page), "New game")
        screenshot(page, output, profile_name + "-start")
        start_blind(page, mobile)
        assert_reachable(page.locator("#handRow .card").first, "First card")
        assert_reachable(page.locator("#handRow .card").last, "Last card")
        assert_reachable(page.locator("#btnPlay"), "Play")
        assert_reachable(page.locator("#btnDiscard"), "Discard")
        screenshot(page, output, profile_name + "-hand")
        if mobile:
            result["long_press"] = check_long_press(page, output, profile_name)
        check_menu(page, mobile)
        result["discard"] = check_selection_and_discard(page, mobile)
        hand_after_discard = cards_on_screen(page)
        counters = [read_number(page, s) for s in ("#scoreVal", "#handsVal", "#discVal")]
        reload_and_resume(page, mobile, "#handRow .card")
        require(cards_on_screen(page) == hand_after_discard, "Refresh changed the saved hand")
        require([read_number(page, s) for s in ("#scoreVal", "#handsVal", "#discVal")] == counters,
                "Refresh changed score or available actions")
        result["plays"] = []
        for turn in range(4):
            result["plays"].append(play_best_first_blind(page, mobile))
            if shown(page.locator("#ovCash")):
                break
            require(not shown(page.locator("#ovOver")), "Lost the first blind before reaching the shop")
            if turn == 0:
                saved_hand = cards_on_screen(page)
                saved_counters = [read_number(page, s) for s in ("#scoreVal", "#handsVal", "#discVal")]
                reload_and_resume(page, mobile, "#handRow .card")
                require(cards_on_screen(page) == saved_hand, "Refresh after play changed the hand")
                require([read_number(page, s) for s in ("#scoreVal", "#handsVal", "#discVal")] == saved_counters,
                        "Refresh after play changed score or available actions")
        page.locator("#ovCash").wait_for(state="visible", timeout=10000)
        screenshot(page, output, profile_name + "-cash")
        cash = page.locator("#cashRows").inner_text()
        reload_and_resume(page, mobile, "#ovCash")
        require(page.locator("#cashRows").inner_text() == cash, "Refresh changed the cash settlement")
        activate(page.locator('#ovCash button[onclick="openShop()"]'), mobile)
        page.locator("#ovShop").wait_for(state="visible")
        result["purchase"] = verify_shop_purchase(page, mobile)
        screenshot(page, output, profile_name + "-shop")
        if mobile:
            result["shop_swipe"] = check_shop_swipe(page)
            screenshot(page, output, profile_name + "-shop-scrolled")
            for selector in ("#rerollBtn", '#ovShop button[onclick="leaveShop()"]'):
                pos = center_hit(page.locator(selector))
                require(pos["visible"], f"Sticky shop action is not touchable after scrolling: {selector}: {pos}")
            if profile_name == "short":
                if page.locator("#shopTabCons").count():
                    require(not result["shop_swipe"]["needed"], "Tabbed shop unexpectedly needs vertical scrolling")
                else:
                    require(result["shop_swipe"]["needed"], "Short shop unexpectedly did not need scrolling")
                result["scrolled_purchase"] = purchase_scrolled_consumable(page)
                screenshot(page, output, profile_name + "-shop-scrolled-purchase")
        shop_snapshot = [page.locator(s).inner_text() for s in ("#shopMoney", "#shopSlots", "#shopCons")]
        reload_and_resume(page, mobile, "#ovShop")
        require([page.locator(s).inner_text() for s in ("#shopMoney", "#shopSlots", "#shopCons")] == shop_snapshot,
                "Shop purchase did not survive refresh")
        activate(page.locator('#ovShop button[onclick="leaveShop()"]'), mobile)
        page.locator("#ovBlinds").wait_for(state="visible")
        require("大盲" in page.locator("#blindCols .cur").inner_text(), "Did not advance to the big blind")
        reload_and_resume(page, mobile, "#ovBlinds")
        require("大盲" in page.locator("#blindCols .cur").inner_text(), "Next blind was not saved")
        screenshot(page, output, profile_name + "-next-blind")
        require(not errors, f"Uncaught page errors: {errors}")
        result["status"] = "passed"
        return result
    except Exception:
        screenshot(page, output, profile_name + "-failure")
        raise
    finally:
        context.close()


def tutorial_case(browser, base_url, profile, output, seed):
    context = context_for(browser, PROFILES[profile], seed)
    page = context.new_page()
    errors = watch_page(page)
    try:
        page.goto(base_url, wait_until="domcontentloaded")
        activate(page.locator('#ovStart button[onclick="startSolo(true)"]'), True)
        page.locator("#ovBlinds").wait_for(state="visible")
        activate(page.locator("#blindCols .cur .bbtn:not(.skip)").first, True)
        page.locator("#tutBox").wait_for(state="visible")
        steps, problems = [], []
        for step in range(1, 11):
            require(page.locator("#tutStep").inner_text().strip() == f"{step} / 10",
                    f"Tutorial did not reach step {step}")
            geometry = page.evaluate("""() => {
              const panel=document.querySelector('#tutBox').getBoundingClientRect();
              const target=document.querySelector('.tut-hl');
              const body=document.querySelector('#tutBody');
              if (!target) return {target:null,bodyHeight:body.clientHeight,bodyScroll:body.scrollHeight};
              const r=target.getBoundingClientRect(), x=r.left+r.width/2, y=r.top+r.height/2;
              const h=(x>=0 && x<innerWidth && y>=0 && y<innerHeight) ? document.elementFromPoint(x,y) : null;
              return {target:target.id,x,y,inViewport:!!h,
                panelCovers:x>=panel.left && x<=panel.right && y>=panel.top && y<=panel.bottom,
                highlightReceives:!!h && (h===target || target.contains(h)),
                bodyHeight:body.clientHeight,bodyScroll:body.scrollHeight};
            }""")
            if geometry["target"]:
                if not geometry["inViewport"] or geometry["panelCovers"] or not geometry["highlightReceives"]:
                    problems.append({"step": step, **geometry})
            if geometry["target"] == "btnRow":
                text = page.locator("#tutBody").inner_text()
                counts = re.search(r"出牌.*?(\d+)\s*次.*?弃牌.*?(\d+)\s*次", text, re.S)
                rules = page.evaluate("() => ({hands:S.baseHands,discards:S.baseDisc})")
                require(counts is not None and [int(counts.group(1)), int(counts.group(2))] ==
                        [rules["hands"], rules["discards"]],
                        f"Tutorial action counts do not match this run: {text!r}, {rules}")
                geometry["tutorial_action_counts"] = rules
            for button in (["#tutNext"] if step == 1 else ["#tutPrev", "#tutNext"]):
                pos = center_hit(page.locator(button))
                if not pos["visible"]:
                    problems.append({"step": step, "button": button, **pos})
            screenshot(page, output, f"tutorial-{profile}-{step:02d}")
            if geometry["bodyScroll"] > geometry["bodyHeight"] + 1:
                body = page.locator("#tutBody")
                max_scroll = geometry["bodyScroll"] - geometry["bodyHeight"]
                for _ in range(4):
                    swipe_up_within(page, body)
                    if body.evaluate("el => el.scrollTop") >= max_scroll - 1:
                        break
                geometry["bodyScrollTopAfterTouch"] = body.evaluate("el => el.scrollTop")
                if geometry["bodyScrollTopAfterTouch"] < max_scroll - 1:
                    problems.append({"step": step, "body_touch_scroll": geometry["bodyScrollTopAfterTouch"],
                                     "expected_bottom": max_scroll})
                screenshot(page, output, f"tutorial-{profile}-{step:02d}-scrolled")
            steps.append({"step": step, **geometry})
            if step == 3:
                activate(page.locator("#tutPrev"), True)
                require(page.locator("#tutStep").inner_text().strip() == "2 / 10", "Tutorial previous button failed")
                activate(page.locator("#tutNext"), True)
                require(page.locator("#tutStep").inner_text().strip() == "3 / 10", "Tutorial could not advance again")
            activate(page.locator("#tutNext"), True)
        require(not shown(page.locator("#tutBox")), "Tutorial did not close after completion")
        require(not problems, f"Tutorial obscures a target or navigation: {problems}")
        require(not errors, f"Uncaught page errors: {errors}")
        return {"status": "passed", "steps": steps, "previous_and_finish_work": True}
    except Exception:
        screenshot(page, output, f"tutorial-{profile}-failure")
        raise
    finally:
        context.close()


def loss_checkpoint_case(browser, base_url, output, seed):
    context = context_for(browser, PROFILES["short"], seed)
    page = context.new_page()
    errors = watch_page(page)
    try:
        page.goto(base_url, wait_until="domcontentloaded")
        start_blind(page, True)
        plays = []
        for turn in range(4):
            cards = cards_on_screen(page)
            index = min(range(len(cards)), key=lambda i: cards[i][0])
            points = score_unmodified_hand([cards[index]])[0]
            activate(page.locator("#handRow .card").nth(index), True)
            activate(page.locator("#btnPlay"), True)
            page.wait_for_function("""() => document.querySelector('#ovOver').style.display==='flex' ||
              !!document.querySelector('#handRow .card:not([disabled])')""", timeout=12000)
            plays.append(points)
            if turn < 3:
                require(not shown(page.locator("#ovCash")), "Weak cards unexpectedly won the blind")
        page.locator("#ovOver").wait_for(state="visible", timeout=12000)
        require(read_number(page, "#scoreVal") == sum(plays) < 300, "Unexpected loss score")
        loss_text = page.locator("#overStats").inner_text()
        screenshot(page, output, "loss-before-reload")
        reload_and_resume(page, True, "#ovOver")
        require(page.locator("#overStats").inner_text() == loss_text, "Loss state did not survive refresh")
        restore = page.locator("#btnRestore")
        assert_reachable(restore, "Return to checkpoint")
        activate(restore, True)
        page.locator("#ovBlinds").wait_for(state="visible")
        require("小盲" in page.locator("#blindCols .cur").inner_text() and
                page.locator("#bsAnte").inner_text() == "1", "Wrong restored blind")
        require(read_number(page, "#moneyVal") == 4, "Checkpoint did not restore starting money")
        screenshot(page, output, "loss-restored-checkpoint")
        reload_and_resume(page, True, "#ovBlinds")
        require("小盲" in page.locator("#blindCols .cur").inner_text(), "Restored checkpoint did not persist")
        activate(page.locator("#blindCols .cur .bbtn:not(.skip)").first, True)
        page.locator("#handRow .card").first.wait_for(state="visible")
        # 1.3's red deck adds a discard; the legacy classic deck remains 4/3.
        expected = [0, 4, 4] if page.locator("#ovSetup").count() else [0, 4, 3]
        require([read_number(page, s) for s in ("#scoreVal", "#handsVal", "#discVal")] == expected,
                f"Restored blind did not reset to {expected}")
        require(not errors, f"Uncaught page errors: {errors}")
        return {"status": "passed", "weak_play_scores": plays, "lost_score": sum(plays),
                "restored_blind": "底注1小盲", "refreshed_loss_and_checkpoint": True}
    except Exception:
        screenshot(page, output, "loss-checkpoint-failure")
        raise
    finally:
        context.close()


def resume_references_case(browser, base_url, output, seed):
    """Read-only identity check after a genuine discard, refresh and resume."""
    context = context_for(browser, PROFILES["short"], seed)
    page = context.new_page()
    errors = watch_page(page)
    try:
        page.goto(base_url, wait_until="domcontentloaded")
        start_blind(page, True)
        activate(page.locator("#handRow .card").first, True)
        activate(page.locator("#btnDiscard"), True)
        saved_hand = cards_on_screen(page)
        reload_and_resume(page, True, "#handRow .card")
        require(cards_on_screen(page) == saved_hand, "Resumed hand does not match the saved hand")
        references = page.evaluate("""() => {
          const hand=S.hand, pile=S.drawPile, deck=S.deckAll;
          const handIds=new Set(hand.map(c=>c.id)), pileIds=new Set(pile.map(c=>c.id));
          return {hand:hand.length, pile:pile.length, deck:deck.length,
            handCanonical:hand.every(c=>c===deck.find(x=>x.id===c.id)),
            pileCanonical:pile.every(c=>c===deck.find(x=>x.id===c.id)),
            uniqueDeck:new Set(deck.map(c=>c.id)).size===deck.length,
            uniqueHand:handIds.size===hand.length, uniquePile:pileIds.size===pile.length,
            disjoint:[...handIds].every(id=>!pileIds.has(id))};
        }""")
        require(references["hand"] == 8 and references["pile"] > 0, f"Invalid restored card counts: {references}")
        require(all(references[k] for k in ("handCanonical", "pileCanonical", "uniqueDeck", "uniqueHand", "uniquePile", "disjoint")),
                f"Resumed cards do not share canonical deck objects: {references}")
        require(not errors, f"Uncaught page errors: {errors}")
        screenshot(page, output, "resume-reference-hand")
        return {"status": "passed", **references}
    except Exception:
        screenshot(page, output, "resume-references-failure")
        raise
    finally:
        context.close()


def standalone_case(browser, output, seed, standalone_file=None):
    spec = PROFILES["portrait"]
    context = context_for(browser, spec, seed)
    page = context.new_page()
    errors = watch_page(page)
    try:
        page.goto((standalone_file or ROOT / "balatro.html").resolve().as_uri(), wait_until="domcontentloaded")
        assert_viewport(page, spec["width"])
        start_blind(page, True)
        play = play_best_first_blind(page, True)
        if shown(page.locator("#ovCash")):
            reload_and_resume(page, True, "#ovCash")
        else:
            saved_hand = cards_on_screen(page)
            saved_score = read_number(page, "#scoreVal")
            reload_and_resume(page, True, "#handRow .card")
            require(cards_on_screen(page) == saved_hand and read_number(page, "#scoreVal") == saved_score,
                    "Standalone file did not restore the hand and score")
        screenshot(page, output, "standalone-play")
        require(not errors, f"Uncaught page errors: {errors}")
        return {"status": "passed", "play": play}
    except Exception:
        screenshot(page, output, "standalone-failure")
        raise
    finally:
        context.close()


def multiplayer_case(browser, base_url, output, seed):
    contexts = [context_for(browser, PROFILES["desktop"], seed + i) for i in range(2)]
    pages = [context.new_page() for context in contexts]
    errors = [watch_page(page) for page in pages]
    try:
        for i, page in enumerate(pages):
            page.goto(base_url, wait_until="domcontentloaded")
            activate(page.locator('#ovStart button[onclick="openMpLobby()"]'), False)
            page.locator("#ovMpLobby").wait_for(state="visible")
            page.locator("#mpName").fill("甲" if i == 0 else "乙")
            page.locator("#mpServer").fill(base_url.rstrip("/"))
        activate(pages[0].locator('#ovMpLobby button[onclick="mpCreate()"]'), False)
        pages[0].wait_for_function(r"""() => /房间码\s*[A-Z2-9]{4}/.test(
          document.querySelector('#mpStatus').textContent)""", timeout=10000)
        match = re.search(r"房间码\s*([A-Z2-9]{4})", pages[0].locator("#mpStatus").inner_text())
        code = match.group(1) if match else ""
        require(re.fullmatch(r"[A-Z2-9]{4}", code), f"Unexpected room code: {code!r}")
        pages[1].locator("#mpCode").fill(code)
        activate(pages[1].locator('#ovMpLobby button[onclick="mpJoin()"]'), False)
        for page in pages:
            page.locator("#ovBlinds").wait_for(state="visible", timeout=15000)
            rules = page.evaluate("""() => ({deck:S.deckId||'classic',hands:S.baseHands,discard:S.baseDisc})""")
            require(rules == {"deck":"classic", "hands":4, "discard":3},
                    f"multiplayer did not retain classic 4/3 rules: {rules}")
        require(pages[0].locator("#oppNameV").inner_text() == "乙", "Host has wrong opponent name")
        require(pages[1].locator("#oppNameV").inner_text() == "甲", "Guest has wrong opponent name")
        activate(pages[0].locator("#blindCols .cur .bbtn:not(.skip)").first, False)
        pages[0].locator("#handRow .card").first.wait_for(state="visible")
        pages[1].wait_for_function("document.querySelector('#oppPhaseV').textContent.includes('对局中')", timeout=10000)
        screenshot(pages[0], output, "multiplayer-host")
        screenshot(pages[1], output, "multiplayer-guest")
        require(not any(errors), f"Uncaught multiplayer page errors: {errors}")
        return {"status": "passed", "paired": True, "opponent_state_synced": True,
                "classic_4_3_rules": True}
    except Exception:
        for i, page in enumerate(pages):
            screenshot(page, output, f"multiplayer-failure-{i}")
        raise
    finally:
        for context in contexts:
            context.close()


def start_server():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    process = subprocess.Popen(["node", str(ROOT / "server.js"), str(port)], cwd=ROOT,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                               creationflags=flags)
    url = f"http://127.0.0.1:{port}"
    for _ in range(100):
        if process.poll() is not None:
            raise RuntimeError(f"Node server exited with status {process.returncode}")
        try:
            with urllib.request.urlopen(url, timeout=0.5) as response:
                if response.status == 200:
                    return process, url
        except (OSError, urllib.error.URLError):
            time.sleep(0.1)
    process.terminate()
    raise RuntimeError("Node server did not become ready")


def server_routes_case(base_url):
    parsed = urllib.parse.urlsplit(base_url)
    root = urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, "/", "", ""))
    with urllib.request.urlopen(root, timeout=10) as response:
        main = response.read()
    with urllib.request.urlopen(urllib.parse.urljoin(root, "balatro.html"), timeout=10) as response:
        direct = response.read()
    require(main == direct and b"<!DOCTYPE html>" in main, "Node root and /balatro.html returned different pages")
    return {"status": "passed", "matching_bytes": len(main)}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--browser", default=os.environ.get("BALATRO_BROWSER"),
                        help="Chromium-compatible executable; defaults to Playwright Chromium")
    parser.add_argument("--base-url", help="Use an already-running Node server instead of starting one")
    parser.add_argument("--output-dir", type=Path, default=ROOT / ".qa" / "browser-smoke")
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--profile", choices=PROFILES, action="append", help="Run only these profiles")
    parser.add_argument("--skip-standalone", action="store_true")
    parser.add_argument("--standalone-file", type=Path,
                        help="Standalone HTML to open as a file; defaults to the repository build")
    parser.add_argument("--skip-multiplayer", action="store_true")
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    if args.browser:
        require(Path(args.browser).is_file(), f"Browser executable not found: {args.browser}")
    process = None
    results = {"fixture": "seeded Math.random; audio disabled; no game-state modification", "seed": args.seed,
               "browser": args.browser or "Playwright Chromium", "cases": {}}

    def run_case(name, callback):
        try:
            results["cases"][name] = callback()
            print(f"PASS {name}", flush=True)
        except Exception as error:
            results["cases"][name] = {"status": "failed", "error": f"{type(error).__name__}: {error}"}
            print(f"FAIL {name}: {type(error).__name__}: {error}", flush=True)

    try:
        if args.base_url:
            url = args.base_url.rstrip("/")
        else:
            process, url = start_server()
        results["base_url"] = url
        run_case("server_routes", lambda: server_routes_case(url))
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=args.browser, headless=True,
                args=["--disable-extensions", "--disable-background-networking"])
            try:
                for profile in args.profile or list(PROFILES):
                    run_case(profile, lambda p=profile: gameplay_case(browser, url, p, PROFILES[p], args.output_dir, args.seed))
                for profile in [p for p in (args.profile or list(PROFILES)) if p in ("short", "landscape")]:
                    run_case("tutorial_" + profile, lambda p=profile: tutorial_case(browser, url, p, args.output_dir, args.seed))
                if not args.profile or "short" in args.profile:
                    run_case("loss_checkpoint", lambda: loss_checkpoint_case(browser, url, args.output_dir, args.seed))
                    run_case("resume_references", lambda: resume_references_case(browser, url, args.output_dir, args.seed))
                if not args.skip_standalone:
                    run_case("standalone", lambda: standalone_case(browser, args.output_dir, args.seed, args.standalone_file))
                if not args.skip_multiplayer:
                    run_case("multiplayer", lambda: multiplayer_case(browser, url, args.output_dir, args.seed))
            finally:
                browser.close()
    finally:
        if process:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
        (args.output_dir / "results.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    return 1 if any(case["status"] != "passed" for case in results["cases"].values()) else 0


if __name__ == "__main__":
    sys.exit(main())
