"""Focused browser regression cases for the game.

The default cases use real button, keyboard, and touch input in isolated,
headless browser contexts. The full-slot and dense-layout cases create a
specific late-game state in JavaScript after starting a real game; their
results explicitly identify that fixture. No personal browser profile is used.

    python tests/browser_extended.py --browser D:\\Quark\\quark.exe
    python tests/browser_extended.py --app-dir .qa/v12/baseline --output-dir .qa/v12/baseline-results
    python tests/browser_extended.py --only pack_cancel --only modal_keyboard
"""

from __future__ import annotations

import argparse
import json
import os
import re
import socket
import subprocess
import sys
import time
import traceback
import urllib.error
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

from browser_smoke import (
    ROOT, PROFILES, activate, assert_reachable, assert_viewport, cards_on_screen,
    context_for, loss_checkpoint_case, play_best_first_blind, read_number,
    reload_and_resume, request_new_solo, require, score_unmodified_hand, screenshot, shown, start_blind,
    select_shop_tab, swipe_up_within, touch_at, verify_shop_purchase, watch_page,
)

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(errors="backslashreplace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(errors="backslashreplace")

DEFAULT_OUTPUT = ROOT / ".qa" / "v12" / "extended-results"
PHONE = {"width": 320, "height": 568, "mobile": True}
PROXY_JS = r"""
const http = require('http');
const upstream = new URL(process.argv[2]);
const port = Number(process.argv[3]);
const streams = new Set();
http.createServer((req, res) => {
  if (req.url === '/__qa/drop') {
    const count = streams.size;
    for (const s of streams) { s.up.destroy(); s.out.destroy(); }
    streams.clear();
    res.writeHead(200, {'Content-Type':'application/json'});
    res.end(JSON.stringify({dropped:count}));
    return;
  }
  const p = http.request({hostname:upstream.hostname, port:upstream.port,
    path:req.url, method:req.method, headers:{...req.headers,host:upstream.host}}, up => {
    res.writeHead(up.statusCode, up.headers);
    if (req.url.startsWith('/api/events?')) {
      const s = {up,out:res}; streams.add(s);
      const remove = () => streams.delete(s);
      up.on('close', remove); res.on('close', remove);
    }
    up.pipe(res);
  });
  p.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
  req.pipe(p);
}).listen(port,'127.0.0.1');
"""


def start_server(app_dir):
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    proc = subprocess.Popen(["node", str(app_dir / "server.js"), str(port)], cwd=app_dir,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                            creationflags=flags)
    url = f"http://127.0.0.1:{port}"
    for _ in range(100):
        if proc.poll() is not None:
            raise RuntimeError(f"server exited: {proc.returncode}")
        try:
            with urllib.request.urlopen(url, timeout=0.5) as response:
                if response.status == 200:
                    return proc, url
        except (OSError, urllib.error.URLError):
            time.sleep(0.1)
    proc.terminate()
    raise RuntimeError("server did not start")


def enter_shop(page, url, mobile):
    page.goto(url, wait_until="domcontentloaded")
    start_blind(page, mobile)
    activate(page.locator("#handRow .card").first, mobile)
    activate(page.locator("#btnDiscard"), mobile)
    plays = []
    for _ in range(4):
        plays.append(play_best_first_blind(page, mobile))
        page.wait_for_function("() => S && !S.busy", timeout=15000)
        if shown(page.locator("#ovCash")):
            break
        require(not shown(page.locator("#ovOver")), "first blind lost")
    page.locator("#ovCash").wait_for(state="visible", timeout=10000)
    activate(page.locator('#ovCash button[onclick="openShop()"]'), mobile)
    page.locator("#ovShop").wait_for(state="visible")
    return plays


def pack_cancel(browser, url, out, seed):
    context = context_for(browser, PROFILES["desktop"], seed)
    page = context.new_page()
    errors = watch_page(page)
    try:
        plays = enter_shop(page, url, False)
        select_shop_tab(page, "packs", False)
        before = read_number(page, "#shopMoney")
        packs = page.locator("#shopPacks .shopItem")
        choices = []
        for i in range(packs.count()):
            text = packs.nth(i).locator(".pr").inner_text()
            match = re.search(r"\d+", text)
            if match and int(match.group()) <= before:
                choices.append((i, int(match.group()), packs.nth(i).locator(".nm").inner_text()))
        require(choices, f"no affordable pack with ${before}")
        idx, cost, name = choices[0]
        packs.nth(idx).click()
        page.locator("#ovPack").wait_for(state="visible")
        during = read_number(page, "#shopMoney")
        first_choices = page.locator("#packCards").inner_text()
        page.locator('#ovPack button[onclick="closePack()"]',).click()
        page.locator("#ovPack").wait_for(state="hidden")
        after = read_number(page, "#shopMoney")
        pack = page.locator("#shopPacks .shopItem").nth(idx)
        state = {"name": name, "before": before, "cost": cost, "during": during,
                 "after": after, "disabled": pack.is_disabled(),
                 "label": pack.locator(".pr").inner_text(),
                 "screenshot": str(out / "pack-cancel.png")}
        screenshot(page, out, "pack-cancel")
        require(not errors, f"page errors: {errors}")
        require(during == before - cost and after == before, f"refund mismatch: {state}")
        require(not state["disabled"] and "已购买" not in state["label"],
                f"refunded pack remains sold and cannot be purchased again: {state}")
        pack.click()
        page.locator("#ovPack").wait_for(state="visible")
        second_choices = page.locator("#packCards").inner_text()
        require(first_choices == second_choices,
                f"reopening a refunded pack changed its choices: {first_choices!r} -> {second_choices!r}")
        page.locator('#ovPack button[onclick="closePack()"]',).click()
        require(read_number(page, "#shopMoney") == before, "repeated cancellation changed the money")
        reload_and_resume(page, False, "#ovShop")
        select_shop_tab(page, "packs", False)
        require(not page.locator("#shopPacks .shopItem").nth(idx).is_disabled(),
                "cancelled pack became sold after refresh")
        return {"status": "passed", "fixture": "normal play", "plays": plays, **state}
    except Exception:
        screenshot(page, out, "pack-cancel-failure")
        raise
    finally:
        context.close()


def pack_persistence(browser, url, out, seed):
    context = context_for(browser, PROFILES["desktop"], seed)
    page = context.new_page()
    errors = watch_page(page)
    try:
        enter_shop(page, url, False)
        select_shop_tab(page, "packs", False)
        before = read_number(page, "#shopMoney")
        packs = page.locator("#shopPacks .shopItem")
        index = next((i for i in range(packs.count())
                      if int(re.search(r"\d+", packs.nth(i).locator(".pr").inner_text()).group()) <= before), None)
        require(index is not None, "no affordable pack for persistence test")
        name = packs.nth(index).locator(".nm").inner_text()
        cost = int(re.search(r"\d+", packs.nth(index).locator(".pr").inner_text()).group())
        packs.nth(index).click()
        page.locator("#ovPack").wait_for(state="visible")
        choices = page.locator("#packCards").inner_text()
        remaining = read_number(page, "#shopMoney")
        page.locator('#ovPack button[onclick="closePack()"]',).focus()
        for _ in range(20):
            page.keyboard.press("Tab")
            outside = page.evaluate("""() => {
              const e=document.activeElement;
              return !!e.closest('#game') || !!e.closest('.ov:not(#ovPack)');
            }""")
            require(not outside, "keyboard focus escaped the pack dialog into the covered shop/table")
        reload_and_resume(page, False, "#ovPack")
        restored = page.locator("#packCards").inner_text()
        require(restored == choices, f"open-pack choices changed on refresh: {choices!r} -> {restored!r}")
        require(read_number(page, "#shopMoney") == remaining == before-cost,
                "open-pack purchase price changed on refresh")
        screenshot(page, out, "pack-resumed")
        page.locator("#packCards button").first.click()
        page.locator("#ovPack").wait_for(state="hidden")
        require(read_number(page, "#shopMoney") == remaining, "choosing an item refunded the purchase")
        select_shop_tab(page, "packs", False)
        require(page.locator("#shopPacks .shopItem").nth(index).is_disabled(), "chosen pack was not sold")
        reload_and_resume(page, False, "#ovShop")
        select_shop_tab(page, "packs", False)
        require(read_number(page, "#shopMoney") == remaining and
                page.locator("#shopPacks .shopItem").nth(index).is_disabled(),
                "completed pack purchase changed after refresh")
        require(not errors, f"page errors: {errors}")
        return {"status": "passed", "fixture": "normal play, pack selection and refresh", "name": name,
                "before": before, "cost": cost, "remaining": remaining, "choices": choices}
    except Exception:
        screenshot(page, out, "pack-persistence-failure")
        raise
    finally:
        context.close()


def shop_full_slots(browser, url, out, seed):
    context = context_for(browser, PROFILES["desktop"], seed)
    page = context.new_page()
    errors = watch_page(page)
    try:
        plays = enter_shop(page, url, False)
        # A planet is usable in the shop; the magician needs selected hand cards.
        page.evaluate("""() => {
          S.consSlots=2;
          S.cons=[{...PLANETS.find(p=>p.key==='high'),kind:'planet',price:3},
                  {...TAROTS.find(t=>t.id==='magician'),kind:'tarot',price:3}];
          renderShop();
        }""")
        screenshot(page, out, "shop-full-slots")
        planet = page.locator("#shopOwned button").filter(has_text="冥王星")
        require(planet.count() > 0,
                f"no shop action for owned planet; shopOwned={page.locator('#shopOwned').inner_text()!r}")
        before_level = page.evaluate("() => S.levels.high")
        planet.first.click()
        page.locator("#ovOwned").wait_for(state="visible")
        page.locator("#useOwned").click()
        require(page.evaluate("() => S.cons.length") == 1 and
                page.evaluate("() => S.levels.high") == before_level + 1,
                "planet action did not free a slot and upgrade high-card level")
        money = read_number(page, "#shopMoney")
        select_shop_tab(page, "cons", False)
        item = page.locator("#shopItems .shopItem").nth(2)
        cost = int(re.search(r"\d+", item.locator(".pr").inner_text()).group())
        require(cost <= money, f"fixture has no money for a subsequent purchase: {money}, cost={cost}")
        item.click()
        require(page.evaluate("() => S.cons.length") == 2 and read_number(page, "#shopMoney") == money - cost,
                "freed consumable slot could not be used for a new purchase")
        # A targeted tarot cannot be used without a hand, but a user must be
        # able to free the other slot from the shop via a sale/removal action.
        target = page.locator("#shopOwned button").filter(has_text="魔术师")
        require(target.count() > 0, "no shop action for a tarot that requires a hand")
        target.first.click()
        page.locator("#ovOwned").wait_for(state="visible")
        require(page.locator("#useOwned").is_disabled(), "targeted tarot should not be usable without a hand")
        page.locator("#sellOwned").click()
        if page.evaluate("() => S.cons.some(t => t.id === 'magician')"):
            page.locator("#sellOwned").click()
        require(not page.evaluate("() => S.cons.some(t => t.id === 'magician')"), "targeted tarot was not removed")
        remaining_cons = page.evaluate("() => S.cons.map(t => ({id:t.id || null,key:t.key || null,kind:t.kind}))")
        sold_money = read_number(page, "#shopMoney")
        reload_and_resume(page, False, "#ovShop")
        require(page.evaluate("() => S.cons.map(t => ({id:t.id || null,key:t.key || null,kind:t.kind}))") == remaining_cons and
                page.evaluate("() => S.levels.high") == before_level + 1 and
                read_number(page, "#shopMoney") == sold_money,
                "shop consumable use/sale did not survive refresh")
        require(not errors, f"page errors: {errors}")
        return {"status": "passed", "fixture": "normal play to shop, then directly injected planet and targeted tarot", "plays": plays}
    except Exception:
        screenshot(page, out, "shop-full-slots-failure")
        raise
    finally:
        context.close()


def modal_keyboard(browser, url, out, seed):
    context = context_for(browser, PROFILES["desktop"], seed)
    page = context.new_page()
    errors = watch_page(page)
    try:
        page.goto(url, wait_until="domcontentloaded")
        start_blind(page, False)
        page.locator("#handRow .card").first.click()
        initial = [read_number(page, s) for s in ("#scoreVal", "#handsVal", "#discVal")]
        page.locator("#menuBtn").click()
        page.locator("#ovMenu").wait_for(state="visible")
        page.locator("#ovMenu h2").click()
        page.keyboard.press("x")
        page.keyboard.press("Enter")
        page.wait_for_timeout(300)
        after = [read_number(page, s) for s in ("#scoreVal", "#handsVal", "#discVal")]
        require(after == initial, f"global keyboard shortcut triggered beneath open menu: {initial} -> {after}")
        # Follow actual Tab traversal from the trigger to detect keyboard access
        # to the covered table without programmatically focusing a game card.
        page.locator("#ovMenu button").last.focus()
        trace = []
        escaped = None
        activation = None
        for _ in range(35):
            page.keyboard.press("Tab")
            active = page.evaluate("""() => ({tag:document.activeElement.tagName,
              id:document.activeElement.id, cls:document.activeElement.className,
              table:!!document.activeElement.closest('#game')})""")
            trace.append(active)
            if active["table"] and escaped is None:
                escaped = active
            if active["table"] and "card" in str(active["cls"]):
                before = page.evaluate("() => document.activeElement.getAttribute('aria-pressed')")
                page.keyboard.press("Enter")
                after = page.evaluate("() => document.activeElement.getAttribute('aria-pressed')")
                activation = {"element": active, "before": before, "after": after}
                break
        screenshot(page, out, "modal-keyboard")
        require(not errors, f"page errors: {errors}")
        require(not escaped, f"Tab escaped open dialog into covered game: {escaped}; activation={activation}; trace={trace}")
        return {"status": "passed", "fixture": "normal play and keyboard input", "counters": initial, "focus_trace": trace}
    except Exception:
        screenshot(page, out, "modal-keyboard-failure")
        raise
    finally:
        context.close()


def dense_phone(browser, url, out, seed, height):
    spec = {**PHONE, "height": height}
    context = context_for(browser, spec, seed)
    page = context.new_page()
    errors = watch_page(page)
    try:
        page.goto(url, wait_until="domcontentloaded")
        start_blind(page, True)
        # A realistic upgraded loadout assembled after a real blind starts.
        page.evaluate("""() => {
          S.jokerSlots=6; S.consSlots=3; S.handSize=9;
          S.jokers=JDEFS.slice(0,6).map(j=>({...j,uid:++cid,sell:2}));
          S.cons=PLANETS.slice(0,3).map(t=>({...t,kind:'planet',price:3}));
          S.hand.push(S.drawPile.pop()); renderAll();
        }""")
        require(page.locator("#handRow .card").count() == 9, "nine-card fixture was not rendered")
        require(page.locator("#jokerRow .joker").count() == 6, "six-joker fixture was not rendered")
        require(page.locator("#consRow .joker").count() == 3, "three-consumable fixture was not rendered")
        screenshot(page, out, f"dense-320x{height}")
        geometry = page.evaluate("""() => {
          const rect = el => {const r=el.getBoundingClientRect(); return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,w:r.width,h:r.height}};
          return {width:innerWidth,height:innerHeight,document:document.documentElement.scrollWidth,
            game:rect(document.querySelector('#game')),
            jokers:[...document.querySelectorAll('#jokerRow .joker')].map(rect),
            cons:[...document.querySelectorAll('#consRow .joker')].map(rect),
            cards:[...document.querySelectorAll('#handRow .card')].map(rect)};
        }""")
        require(geometry["document"] <= 321, f"whole page overflow: {geometry}")
        for kind in ("jokers", "cons", "cards"):
            for index, r in enumerate(geometry[kind]):
                require(r["x"] >= -1 and r["right"] <= 321 and r["w"] >= 24 and r["h"] >= 24,
                        f"{kind}[{index}] horizontally clipped or too small: {geometry}")
        # Use actual touch to scroll the game before exercising the final card.
        game = page.locator("#game")
        max_scroll = game.evaluate("el => el.scrollHeight - el.clientHeight")
        before_scroll = game.evaluate("el => el.scrollTop")
        if max_scroll > 2:
            cdp = context.new_cdp_session(page)
            try:
                x = 4
                start = min(height - 45, height * 0.75)
                end = max(30, height * 0.28)
                cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x":x,"y":start,"id":1}]})
                for step in range(1, 9):
                    y = start + (end-start)*step/8
                    cdp.send("Input.dispatchTouchEvent", {"type":"touchMove", "touchPoints":[{"x":x,"y":y,"id":1}]})
                    time.sleep(0.025)
                cdp.send("Input.dispatchTouchEvent", {"type":"touchEnd", "touchPoints":[]})
            finally:
                cdp.detach()
            page.wait_for_timeout(200)
            after_scroll = game.evaluate("el => el.scrollTop")
            require(after_scroll > before_scroll + 2, f"touch swipe did not scroll game: {before_scroll} -> {after_scroll}")
        else:
            after_scroll = before_scroll
        last = page.locator("#handRow .card").last
        assert_reachable(last, "Last hand card")
        pos = last.evaluate("""el => {const r=el.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}}""")
        touch_at(page, pos["x"], pos["y"])
        require(last.get_attribute("aria-pressed") == "true", "touch on ninth card did not select it")
        screenshot(page, out, f"dense-320x{height}-scrolled")
        for selector in ("#handRow .card:first-child", "#handRow .card:last-child", "#btnPlay", "#btnDiscard"):
            assert_reachable(page.locator(selector), selector)
        require(not errors, f"page errors: {errors}")
        return {"status": "passed", "fixture": "normal blind, then directly injected nine cards and six/three occupied slots", "geometry": geometry,
                "scroll_before": before_scroll, "scroll_after": after_scroll, "ninth_card_touch_selected": True}
    except Exception:
        screenshot(page, out, f"dense-320x{height}-failure")
        raise
    finally:
        context.close()


def open_lobby(page, url, name):
    page.goto(url, wait_until="domcontentloaded")
    page.locator('#ovStart button[onclick="openMpLobby()"]',).click()
    page.locator("#ovMpLobby").wait_for(state="visible")
    page.locator("#mpName").fill(name)
    page.locator("#mpServer").fill(url)


def create_room(page):
    page.locator('#ovMpLobby button[onclick="mpCreate()"]',).click()
    page.wait_for_function(r"""() => /房间码\s*[A-Z2-9]{4}/.test(
      document.querySelector('#mpStatus').textContent)""", timeout=10000)
    match = re.search(r"房间码\s*([A-Z2-9]{4})", page.locator("#mpStatus").inner_text())
    code = match.group(1) if match else ""
    require(re.fullmatch(r"[A-Z2-9]{4}", code), f"bad room code: {code}")
    return code


def cancel_room(browser, url, out, seed):
    contexts = [context_for(browser, PROFILES["desktop"], seed+i) for i in range(2)]
    host, guest = [context.new_page() for context in contexts]
    errors = [watch_page(p) for p in (host, guest)]
    try:
        open_lobby(host, url, "房主")
        code = create_room(host)
        host.locator('#ovMpLobby button[onclick="mpCancel()"]',).click()
        host.locator("#ovStart").wait_for(state="visible")
        open_lobby(guest, url, "来宾")
        guest.locator("#mpCode").fill(code)
        guest.locator('#ovMpLobby button[onclick="mpJoin()"]',).click()
        guest.wait_for_timeout(1500)
        status = guest.locator("#mpStatus").inner_text()
        screenshot(guest, out, "cancelled-room-join")
        require(not any(errors), f"page errors: {errors}")
        require("不存在" in status or "已关闭" in status or "无法加入" in status,
                f"guest could join cancelled host room and waited indefinitely: room={code}, status={status!r}")
        return {"status": "passed", "fixture": "normal multiplayer UI", "room": code, "guest_status": status}
    except Exception:
        screenshot(host, out, "cancel-room-host-failure")
        screenshot(guest, out, "cancel-room-guest-failure")
        raise
    finally:
        for context in contexts:
            context.close()


def cancel_create_race(browser, url, out, seed):
    context = context_for(browser, PROFILES["desktop"], seed)
    context.add_init_script("""(() => {
      const fetch0=window.fetch;
      window.fetch=(input,opts)=>fetch0(input,opts).then(res=> {
        if (!String(input).includes('/api/create')) return res;
        res.clone().json().then(data=>window.__qaCreatedRoom=data.room).catch(()=>{});
        return new Promise(resolve=>setTimeout(()=>resolve(res),1200));
      });
    })();""")
    page = context.new_page()
    errors = watch_page(page)
    try:
        open_lobby(page, url, "慢网络房主")
        page.locator('#ovMpLobby button[onclick="mpCreate()"]',).click()
        page.locator('#ovMpLobby button[onclick="mpCancel()"]',).click()
        page.locator("#ovStart").wait_for(state="visible")
        page.wait_for_timeout(1800)
        state = page.evaluate("""() => ({room:MP.room,pid:MP.pid,on:MP.on,
          stream:!!MP.net,streamState:MP.net&&MP.net.readyState,lobby:document.querySelector('#ovMpLobby').style.display})""")
        screenshot(page, out, "cancel-create-race")
        require(not errors, f"page errors: {errors}")
        require(not state["room"] and not state["pid"] and not state["stream"] and not state["on"],
                f"cancelled create completed later and restored hidden room/stream: {state}")
        created = page.evaluate("() => window.__qaCreatedRoom || null")
        if created:
            other_context = context_for(browser, PROFILES["desktop"], seed+1)
            try:
                guest = other_context.new_page()
                open_lobby(guest, url, "访客")
                guest.locator("#mpCode").fill(created)
                guest.locator('#ovMpLobby button[onclick="mpJoin()"]',).click()
                guest.wait_for_timeout(1500)
                status = guest.locator("#mpStatus").inner_text()
                require("不存在" in status or "已关闭" in status or "无法加入" in status,
                        f"delayed cancelled create leaked a joinable room: {created}, status={status!r}")
            finally:
                other_context.close()
        return {"status": "passed", "fixture": "normal UI with a deliberately delayed network response",
                "state": state, "created_room_verified_closed": created}
    except Exception:
        screenshot(page, out, "cancel-create-race-failure")
        raise
    finally:
        context.close()


def duplicate_create(browser, url, out, seed):
    context = context_for(browser, PROFILES["desktop"], seed)
    context.add_init_script("""(() => {
      const fetch0=window.fetch;
      window.fetch=(input,opts)=>fetch0(input,opts).then(res=>
        String(input).includes('/api/create') ? new Promise(resolve=>setTimeout(()=>resolve(res),1000)) : res);
    })();""")
    page = context.new_page()
    errors = watch_page(page)
    requests = []
    page.on("request", lambda request: requests.append(request.url)
            if request.method == "POST" and request.url.endswith("/api/create") else None)
    try:
        open_lobby(page, url, "甲")
        button = page.locator('#ovMpLobby button[onclick="mpCreate()"]')
        rect = button.bounding_box()
        require(rect is not None, "create-room button is not visible")
        x, y = rect["x"] + rect["width"] / 2, rect["y"] + rect["height"] / 2
        page.mouse.click(x, y)
        page.mouse.click(x, y)
        page.wait_for_timeout(1600)
        screenshot(page, out, "duplicate-create")
        require(len(requests) == 1, f"two quick create clicks issued {len(requests)} requests")
        require(not errors, f"page errors: {errors}")
        return {"status": "passed", "fixture": "real mouse clicks; create response delayed", "requests": len(requests)}
    except Exception:
        screenshot(page, out, "duplicate-create-failure")
        raise
    finally:
        context.close()


def disconnect_reenter(browser, url, out, seed):
    host_context = context_for(browser, PROFILES["desktop"], seed)
    guest_context = context_for(browser, PROFILES["desktop"], seed+1)
    host, guest = host_context.new_page(), guest_context.new_page()
    errors = [watch_page(p) for p in (host, guest)]
    try:
        open_lobby(host, url, "甲")
        open_lobby(guest, url, "乙")
        code = create_room(host)
        guest.locator("#mpCode").fill(code)
        guest.locator('#ovMpLobby button[onclick="mpJoin()"]',).click()
        for page in (host, guest):
            page.locator("#ovBlinds").wait_for(state="visible", timeout=15000)
        guest_context.close()
        # A closed peer can end immediately when reported as an intentional
        # leave, or after the configured 30-second disconnect grace period.
        host.wait_for_function("() => MP.over", timeout=45000)
        host.locator("#ovMpRes").wait_for(state="visible", timeout=5000)
        reason = host.locator("#mpResBody").inner_text()
        title = host.locator("#mpResTitle").inner_text()
        screenshot(host, out, "disconnect-result")
        require("断线" in reason or "退出" in reason, f"wrong disconnect reason: {reason}")
        host.locator("#mpResBtn").click()
        host.locator("#ovStart").wait_for(state="visible", timeout=10000)
        host.locator('#ovStart button[onclick="openMpLobby()"]',).click()
        host.locator("#mpServer").fill(url)
        second = create_room(host)
        screenshot(host, out, "disconnect-reenter")
        require(not any(errors), f"page errors: {errors}")
        return {"status": "passed", "fixture": "two real browser contexts; guest context closed", "first_room": code,
                "second_room": second, "title": title, "reason": reason}
    except Exception:
        screenshot(host, out, "disconnect-host-failure")
        raise
    finally:
        host_context.close()
        guest_context.close()


def brief_network_outage(browser, url, out, seed):
    proxy_path = out / "relay-proxy.js"
    proxy_path.write_text(PROXY_JS, encoding="utf-8")
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        proxy_port = sock.getsockname()[1]
    flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    proxy = subprocess.Popen(["node", str(proxy_path), url, str(proxy_port)], cwd=out,
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=flags)
    relay = f"http://127.0.0.1:{proxy_port}"
    contexts = [context_for(browser, PROFILES["desktop"], seed+i) for i in range(2)]
    host, guest = [context.new_page() for context in contexts]
    errors = [watch_page(p) for p in (host, guest)]
    try:
        open_lobby(host, url, "甲")
        open_lobby(guest, url, "乙")
        host.locator("#mpServer").fill(relay)
        code = create_room(host)
        guest.locator("#mpCode").fill(code)
        guest.locator('#ovMpLobby button[onclick="mpJoin()"]',).click()
        for page in (host, guest):
            page.locator("#ovBlinds").wait_for(state="visible", timeout=15000)
            rules = page.evaluate("""() => ({deck:S.deckId||'classic',hands:S.baseHands,discard:S.baseDisc})""")
            require(rules == {"deck":"classic", "hands":4, "discard":3},
                    f"multiplayer changed classic 4/3 rules: {rules}")
        host.locator("#blindCols .cur .bbtn:not(.skip)").first.click()
        host.locator("#handRow .card").first.wait_for(state="visible")
        before = host.evaluate("""() => ({score:S.score,hands:S.handsLeft,discard:S.discLeft,
              cardIds:S.hand.map(c=>c.id),room:MP.room,pid:MP.pid})""")
        with urllib.request.urlopen(relay + "/__qa/drop", timeout=5) as response:
            dropped = json.load(response)["dropped"]
        require(dropped == 1, f"test proxy did not cut one established SSE stream: {dropped}")
        host.wait_for_function("() => MP.net && MP.net.readyState !== EventSource.OPEN", timeout=5000)
        host.wait_for_timeout(2000)
        guest_state = guest.evaluate("() => ({on:MP.on,over:MP.over,body:document.querySelector('#mpResBody').textContent})")
        screenshot(guest, out, "outage-guest-wait")
        require(not guest_state["over"], f"a brief network outage prematurely ended the match: {guest_state}")
        host.wait_for_function("() => MP.net && MP.net.readyState === EventSource.OPEN", timeout=12000)
        host.wait_for_timeout(1500)
        after = host.evaluate("""() => ({score:S.score,hands:S.handsLeft,discard:S.discLeft,
              cardIds:S.hand.map(c=>c.id),room:MP.room,pid:MP.pid})""")
        require(before == after, f"reconnection changed the player's current run: {before} -> {after}")
        require(guest.evaluate("() => MP.on && !MP.over"), "peer did not remain in the match")
        host.locator("#handRow .card").first.click()
        host.locator("#btnPlay").click()
        host.wait_for_function("() => S && !S.busy && S.score > 0", timeout=15000)
        score = host.evaluate("() => S.score")
        guest.wait_for_function("score => MP.opp && MP.opp.score === score", arg=score, timeout=10000)
        require(not any(errors), f"page errors: {errors}")
        screenshot(host, out, "outage-resumed")
        return {"status": "passed", "fixture": "two real clients; local proxy cut the host SSE connection",
                "room": code, "before": before, "after": after, "post_reconnect_synced_score": score}
    except Exception:
        screenshot(host, out, "outage-host-failure")
        screenshot(guest, out, "outage-guest-failure")
        raise
    finally:
        for context in contexts:
            context.close()
        proxy.terminate()
        try:
            proxy.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proxy.kill()


def voluntary_leave(browser, url, out, seed):
    contexts = [context_for(browser, PROFILES["desktop"], seed+i) for i in range(2)]
    host, guest = [context.new_page() for context in contexts]
    errors = [watch_page(p) for p in (host, guest)]
    try:
        guest.goto(url, wait_until="domcontentloaded")
        start_blind(guest, False)
        guest.locator("#handRow .card").first.click()
        guest.locator("#btnDiscard").click()
        saved_cards = cards_on_screen(guest)
        saved_counters = [read_number(guest, s) for s in ("#scoreVal", "#handsVal", "#discVal")]
        guest.locator("#menuBtn").click()
        guest.locator("#returnTitleBtn").click()
        guest.locator("#ovStart").wait_for(state="visible")
        open_lobby(host, url, "甲")
        open_lobby(guest, url, "乙")
        code = create_room(host)
        guest.locator("#mpCode").fill(code)
        guest.locator('#ovMpLobby button[onclick="mpJoin()"]',).click()
        for page in (host, guest):
            page.locator("#ovBlinds").wait_for(state="visible", timeout=15000)
        guest.locator("#blindCols .cur .bbtn:not(.skip)").first.click()
        guest.locator("#handRow .card").first.wait_for(state="visible")
        guest.locator("#menuBtn").click()
        guest.locator("#returnTitleBtn").click()
        guest.locator("#ovLeave").wait_for(state="visible")
        guest.locator("#ovLeave button").filter(has_text="继续对战").click()
        require(guest.evaluate("() => MP.on && !MP.over") and host.evaluate("() => MP.on && !MP.over"),
                "cancelling leave ended the match")
        # The menu remains behind the confirmation dialog after cancel.
        if not shown(guest.locator("#ovMenu")):
            guest.locator("#menuBtn").click()
        guest.locator("#returnTitleBtn").click()
        start = time.perf_counter()
        guest.locator("#confirmLeave").click()
        host.wait_for_function("() => MP.over", timeout=7000)
        elapsed = round(time.perf_counter()-start, 3)
        guest.locator("#ovStart").wait_for(state="visible")
        host.locator("#ovMpRes").wait_for(state="visible")
        reason = host.locator("#mpResBody").inner_text()
        require("退出" in reason or "离开" in reason, f"unexpected voluntary leave result: {reason}")
        guest.locator("#resumeBtn").click()
        guest.locator("#handRow .card").first.wait_for(state="visible")
        require(cards_on_screen(guest) == saved_cards and
                [read_number(guest, s) for s in ("#scoreVal", "#handsVal", "#discVal")] == saved_counters,
                "leaving multiplayer changed the previous single-player save")
        require(not any(errors), f"page errors: {errors}")
        screenshot(host, out, "voluntary-leave-result")
        screenshot(guest, out, "voluntary-leave-solo-resumed")
        return {"status": "passed", "fixture": "normal UI; solo discard, multiplayer leave and solo resume",
                "room": code, "cancel_kept_match": True, "result_seconds": elapsed, "reason": reason,
                "solo_counters": saved_counters}
    except Exception:
        screenshot(host, out, "voluntary-leave-host-failure")
        screenshot(guest, out, "voluntary-leave-guest-failure")
        raise
    finally:
        for context in contexts:
            context.close()


def loss_restart(browser, url, out, seed):
    context = context_for(browser, PROFILES["short"], seed)
    page = context.new_page()
    errors = watch_page(page)
    try:
        page.goto(url, wait_until="domcontentloaded")
        start_blind(page, True)
        for turn in range(4):
            cards = cards_on_screen(page)
            index = min(range(len(cards)), key=lambda i: cards[i][0])
            activate(page.locator("#handRow .card").nth(index), True)
            activate(page.locator("#btnPlay"), True)
            page.wait_for_function("() => S && !S.busy", timeout=15000)
        page.locator("#ovOver").wait_for(state="visible", timeout=10000)
        score = read_number(page, "#scoreVal")
        loss_text = page.locator("#overStats").inner_text()
        page.locator("#ovOver button").filter(has_text="再来一局").tap()
        page.locator("#ovStart").wait_for(state="visible")
        request_new_solo(page, True)
        page.locator("#ovRestart").wait_for(state="visible")
        page.locator("#ovRestart button").filter(has_text="保留进度").tap()
        page.locator("#resumeBtn").tap()
        page.locator("#ovOver").wait_for(state="visible")
        require(page.locator("#overStats").inner_text() == loss_text and
                read_number(page, "#scoreVal") == score, "keep progress failed after loss")
        page.locator("#ovOver button").filter(has_text="再来一局").tap()
        request_new_solo(page, True)
        page.locator("#confirmNew").tap()
        page.locator("#ovBlinds").wait_for(state="visible")
        require("小盲" in page.locator("#blindCols .cur").inner_text(), "new game selected wrong initial blind")
        reload_and_resume(page, True, "#ovBlinds")
        require("小盲" in page.locator("#blindCols .cur").inner_text() and
                read_number(page, "#moneyVal") == 4, "confirmed new game did not persist")
        screenshot(page, out, "loss-confirmed-restart")
        require(not errors, f"page errors: {errors}")
        return {"status": "passed", "fixture": "normal UI", "lost_score": score,
                "kept_loss_before_confirm": True, "new_game_survived_refresh": True}
    except Exception:
        screenshot(page, out, "loss-restart-failure")
        raise
    finally:
        context.close()


def capture_v1_save(browser, url, out, seed, fixture_path):
    """Capture a genuine old-version save; run against the preserved 1.1.0 app."""
    context = context_for(browser, PROFILES["short"], seed)
    page = context.new_page()
    try:
        page.goto(url, wait_until="domcontentloaded")
        start_blind(page, True)
        activate(page.locator("#handRow .card").first, True)
        activate(page.locator("#btnDiscard"), True)
        page.wait_for_timeout(100)
        raw = page.evaluate("() => localStorage.getItem('pixel-balatro.run.v1')")
        require(raw and json.loads(raw).get("version") == 1, "baseline did not produce a v1 save")
        fixture = {"raw": raw, "cards": cards_on_screen(page),
                   "counters": [read_number(page, s) for s in ("#scoreVal", "#handsVal", "#discVal")]}
        fixture_path.parent.mkdir(parents=True, exist_ok=True)
        fixture_path.write_text(json.dumps(fixture, ensure_ascii=False, indent=2), encoding="utf-8")
        screenshot(page, out, "v1-fixture-hand")
        return {"status": "passed", "fixture": "actual 1.1.0 game, genuine discard", "path": str(fixture_path),
                "counters": fixture["counters"]}
    finally:
        context.close()


def capture_v1_judge(browser, url, out, seed, fixture_path):
    """Create an old save via the judge tarot's actual 1.1.0 action."""
    context = context_for(browser, PROFILES["desktop"], seed)
    page = context.new_page()
    try:
        page.goto(url, wait_until="domcontentloaded")
        start_blind(page, False)
        page.evaluate("""() => {
          S.cons=[{...TAROTS.find(t=>t.id==='judge'),kind:'tarot',price:3}]; renderCons();
        }""")
        page.locator("#consRow .joker").first.click()
        page.wait_for_function("() => S.jokers.length===1", timeout=5000)
        page.wait_for_timeout(100)
        raw = page.evaluate("() => localStorage.getItem('pixel-balatro.run.v1')")
        save = json.loads(raw)
        require(save.get("version") == 1 and len(save["state"]["jokers"]) == 1,
                "judge action did not create a version 1 joker save")
        require("ed" not in save["state"]["jokers"][0], "baseline judge joker unexpectedly has an ed field")
        fixture = {"raw": raw, "cards": cards_on_screen(page),
                   "counters": [read_number(page, s) for s in ("#scoreVal", "#handsVal", "#discVal")],
                   "jokers": [j["id"] for j in save["state"]["jokers"]]}
        fixture_path.parent.mkdir(parents=True, exist_ok=True)
        fixture_path.write_text(json.dumps(fixture, ensure_ascii=False, indent=2), encoding="utf-8")
        screenshot(page, out, "v1-judge-joker")
        return {"status": "passed", "fixture": "1.1.0 normal blind, injected judge tarot then used it through UI",
                "path": str(fixture_path), "joker": fixture["jokers"][0], "old_edition_field_absent": True}
    finally:
        context.close()


def v1_migration(browser, url, out, seed, fixture_path):
    fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
    context = context_for(browser, PROFILES["short"], seed)
    page = context.new_page()
    errors = watch_page(page)
    try:
        page.goto(url, wait_until="domcontentloaded")
        page.evaluate("raw => localStorage.setItem('pixel-balatro.run.v1', raw)", fixture["raw"])
        page.reload(wait_until="domcontentloaded")
        page.locator("#resumeBtn").wait_for(state="visible", timeout=6000)
        page.locator("#resumeBtn").tap()
        page.locator("#handRow .card").first.wait_for(state="visible")
        actual = cards_on_screen(page)
        require([list(card) for card in actual] == fixture["cards"], f"old save hand changed: {actual} vs {fixture['cards']}")
        counters = [read_number(page, s) for s in ("#scoreVal", "#handsVal", "#discVal")]
        require(counters == fixture["counters"], f"old save counters changed: {counters} vs {fixture['counters']}")
        rules = page.evaluate("""() => ({deck:S.deckId||'classic',stake:S.stakeId||'white',
          hands:S.baseHands,discard:S.baseDisc})""")
        require(rules == {"deck":"classic", "stake":"white", "hands":4, "discard":3},
                f"legacy classic rules changed: {rules}")
        if fixture.get("jokers"):
            actual_jokers = page.evaluate("() => S.jokers.map(j=>j.id)")
            require(actual_jokers == fixture["jokers"], f"old save jokers changed: {actual_jokers} vs {fixture['jokers']}")
        references = page.evaluate("""() => S.hand.every(c=>c===S.deckAll.find(x=>x.id===c.id)) &&
          S.drawPile.every(c=>c===S.deckAll.find(x=>x.id===c.id))""")
        require(references, "old save did not rebind hand/pile cards to the canonical deck")
        reload_and_resume(page, True, "#handRow .card")
        require([list(card) for card in cards_on_screen(page)] == fixture["cards"], "migrated save changed after refresh")
        page.locator("#handRow .card").first.tap()
        page.locator("#btnDiscard").tap()
        require(read_number(page, "#discVal") == counters[2] - 1, "migrated classic discard did not spend one use")
        continued_hand = cards_on_screen(page)
        reload_and_resume(page, True, "#handRow .card")
        require(cards_on_screen(page) == continued_hand and read_number(page, "#discVal") == counters[2] - 1,
                "continued legacy run did not persist after another discard")
        require(page.evaluate("() => S.baseHands===4 && S.baseDisc===3 && (S.deckId||'classic')==='classic'"),
                "continued classic run lost its original 4/3 rules")
        require(not errors, f"page errors: {errors}")
        screenshot(page, out, "v1-migrated")
        origin = ("1.1.0 normal blind, injected judge tarot and used it through UI" if fixture.get("jokers")
                  else "1.1.0 save captured from a genuine discard")
        return {"status": "passed", "fixture": origin, "path": str(fixture_path),
                "counters": counters, "rules": rules, "canonical_references": references,
                "continued_discard_survived_refresh": True}
    except Exception:
        screenshot(page, out, "v1-migration-failure")
        raise
    finally:
        context.close()


def capture_v2_shop(browser, url, out, seed, fixture_path):
    """Capture an actual 1.2.0 shop after earning and buying owned cards."""
    context = context_for(browser, PROFILES["desktop"], seed)
    page = context.new_page()
    try:
        plays = enter_shop(page, url, False)
        joker = verify_shop_purchase(page, False)
        select_shop_tab(page, "cons", False)
        item = page.locator("#shopItems .shopItem").nth(2)
        money = read_number(page, "#shopMoney")
        price = int(re.search(r"\d+", item.locator(".pr").inner_text()).group())
        require(price <= money, "1.2 fixture cannot afford a planet after buying a joker")
        item.click()
        require(page.evaluate("() => S.cons.length") == 1, "1.2 shop did not buy the planet")
        page.wait_for_timeout(100)
        raw = page.evaluate("() => localStorage.getItem('pixel-balatro.run.v1')")
        data = json.loads(raw)
        require(data.get("version") == 2 and data["state"]["screen"] == "shop", "expected a real version 2 shop save")
        snapshot = page.evaluate("""() => ({money:S.money, jokers:S.jokers.map(j=>j.id),
          consumables:S.cons.map(c=>({kind:c.kind,key:c.key||null,id:c.id||null})),
          soldJokers:S.shop.jokers.map(j=>!!j.sold), soldCons:S.shop.cons.map(c=>!!c.sold)})""")
        fixture = {"raw": raw, "snapshot": snapshot, "plays": plays, "purchased_joker": joker}
        fixture_path.parent.mkdir(parents=True, exist_ok=True)
        fixture_path.write_text(json.dumps(fixture, ensure_ascii=False, indent=2), encoding="utf-8")
        reload_and_resume(page, False, "#ovShop")
        require(read_number(page, "#shopMoney") == snapshot["money"], "old shop fixture does not survive refresh")
        screenshot(page, out, "v2-shop-fixture")
        return {"status":"passed", "fixture":"1.2 normal first blind, bought a joker and planet", "path":str(fixture_path),
                "snapshot":snapshot}
    finally:
        context.close()


def v2_shop_migration(browser, url, out, seed, fixture_path):
    fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
    context = context_for(browser, PROFILES["desktop"], seed)
    page = context.new_page()
    errors = watch_page(page)
    try:
        page.goto(url, wait_until="domcontentloaded")
        page.evaluate("raw => localStorage.setItem('pixel-balatro.run.v1',raw)", fixture["raw"])
        page.reload(wait_until="domcontentloaded")
        page.locator("#resumeBtn").wait_for(state="visible", timeout=6000)
        page.locator("#resumeBtn").click()
        page.locator("#ovShop").wait_for(state="visible")
        snapshot = page.evaluate("""() => ({money:S.money, jokers:S.jokers.map(j=>j.id),
          consumables:S.cons.map(c=>({kind:c.kind,key:c.key||null,id:c.id||null})),
          soldJokers:S.shop.jokers.map(j=>!!j.sold), soldCons:S.shop.cons.map(c=>!!c.sold)})""")
        require(snapshot == fixture["snapshot"], f"1.2 shop changed on migration: {snapshot} vs {fixture['snapshot']}")
        rules = page.evaluate("""() => ({deck:S.deckId||'classic',stake:S.stakeId||'white',
          hands:S.baseHands,discard:S.baseDisc})""")
        require(rules == {"deck":"classic", "stake":"white", "hands":4, "discard":3},
                f"1.2 classic rules changed: {rules}")
        planet = snapshot["consumables"][0]
        key = planet["key"]
        before = page.evaluate("key => S.levels[key]", key)
        page.locator("#shopOwned .ownedItem[data-kind='cons']").first.click()
        page.locator("#ovOwned").wait_for(state="visible")
        page.locator("#useOwned").click()
        require(page.evaluate("key => S.levels[key]", key) == before + 1 and
                page.evaluate("() => S.cons.length") == 0, "migrated planet could not be used")
        reload_and_resume(page, False, "#ovShop")
        require(page.evaluate("key => S.levels[key]", key) == before + 1 and
                page.evaluate("() => S.cons.length") == 0 and
                page.evaluate("() => S.jokers.map(j=>j.id)") == snapshot["jokers"],
                "continued 1.2 shop progress did not survive refresh")
        require(not errors, f"page errors: {errors}")
        screenshot(page, out, "v2-shop-migrated")
        return {"status":"passed", "fixture":"actual 1.2 shop purchases, migrated and continued through UI",
                "before":snapshot, "rules":rules, "used_planet":key, "after_level":before+1}
    except Exception:
        screenshot(page, out, "v2-shop-migration-failure")
        raise
    finally:
        context.close()


def legacy_setup_cancel(browser, url, out, seed, fixture_path):
    fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
    legacy = json.loads(fixture["raw"])
    context = context_for(browser, PROFILES["desktop"], seed)
    page = context.new_page()
    errors = watch_page(page)
    try:
        page.goto(url, wait_until="domcontentloaded")
        page.evaluate("raw => localStorage.setItem('pixel-balatro.run.v1',raw)", fixture["raw"])
        page.reload(wait_until="domcontentloaded")
        page.locator("#resumeBtn").wait_for(state="visible", timeout=6000)
        page.locator("#newBtn").click()
        page.locator("#ovSetup").wait_for(state="visible")
        page.locator("#deckChoices button").filter(has_text="蓝色牌组").click()
        page.locator("#stakeChoices button").filter(has_text="金注").click()
        page.locator("#beginRunBtn").click()
        page.locator("#ovRestart").wait_for(state="visible")
        page.locator("#ovRestart button").filter(has_text="保留进度").click()
        page.locator("#ovStart").wait_for(state="visible")
        raw = page.evaluate("() => localStorage.getItem('pixel-balatro.run.v1')")
        require(raw == fixture["raw"], "cancelling the new setup modified the existing save")
        page.locator("#resumeBtn").click()
        if legacy["state"]["screen"] == "shop":
            page.locator("#ovShop").wait_for(state="visible")
            require(read_number(page, "#shopMoney") == fixture["snapshot"]["money"] and
                    page.evaluate("() => S.jokers.map(j=>j.id)") == fixture["snapshot"]["jokers"],
                    "existing 1.2 shop progress changed after cancelling setup")
        else:
            page.locator("#handRow .card").first.wait_for(state="visible")
            require([list(card) for card in cards_on_screen(page)] == fixture["cards"] and
                    [read_number(page, s) for s in ("#scoreVal", "#handsVal", "#discVal")] == fixture["counters"],
                    "existing 1.1 run changed after cancelling setup")
        rules = page.evaluate("() => ({deck:S.deckId||'classic',hands:S.baseHands,discard:S.baseDisc})")
        require(rules == {"deck":"classic", "hands":4, "discard":3},
                f"cancelled blue/gold setup changed legacy run rules: {rules}")
        require(not errors, f"page errors: {errors}")
        screenshot(page, out, f"legacy-v{legacy['version']}-setup-cancel")
        return {"status":"passed", "fixture":f"actual 1.{1 if legacy['version']==1 else 2} save; blue/gold setup cancelled",
                "screen":legacy["state"]["screen"], "save_unchanged_before_resume":True, "rules":rules}
    except Exception:
        screenshot(page, out, f"legacy-v{legacy['version']}-setup-cancel-failure")
        raise
    finally:
        context.close()


def legacy_checkpoint(browser, url, out, seed, fixture_path):
    fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
    context = context_for(browser, PROFILES["short"], seed)
    page = context.new_page()
    errors = watch_page(page)
    try:
        page.goto(url, wait_until="domcontentloaded")
        page.evaluate("raw => localStorage.setItem('pixel-balatro.run.v1',raw)", fixture["raw"])
        page.reload(wait_until="domcontentloaded")
        page.locator("#resumeBtn").tap()
        page.locator("#handRow .card").first.wait_for(state="visible")
        require(page.evaluate("() => S.jokers.length===0 && S.baseHands===4 && S.baseDisc===3"),
                "legacy checkpoint fixture is not a plain classic 4/3 run")
        points = []
        for _ in range(4):
            cards = cards_on_screen(page)
            index = min(range(len(cards)), key=lambda i: cards[i][0])
            points.append(score_unmodified_hand([cards[index]])[0])
            page.locator("#handRow .card").nth(index).tap()
            page.locator("#btnPlay").tap()
            page.wait_for_function("() => S && !S.busy", timeout=15000)
        page.locator("#ovOver").wait_for(state="visible", timeout=10000)
        require(read_number(page, "#scoreVal") == sum(points) < 300, f"legacy loss score was unexpected: {points}")
        page.locator("#btnRestore").tap()
        page.locator("#ovBlinds").wait_for(state="visible")
        page.locator("#blindCols .cur .bbtn:not(.skip)").first.tap()
        page.locator("#handRow .card").first.wait_for(state="visible")
        counters = [read_number(page, s) for s in ("#scoreVal", "#handsVal", "#discVal")]
        require(counters == [0,4,3], f"legacy checkpoint should restart with [0,4,3], got {counters}")
        require(page.evaluate("() => (S.deckId||'classic')==='classic' && S.baseDisc===3"), "legacy checkpoint changed deck")
        reload_and_resume(page, True, "#handRow .card")
        require([read_number(page, s) for s in ("#scoreVal", "#handsVal", "#discVal")] == [0,4,3],
                "legacy 4/3 checkpoint did not survive refresh")
        require(not errors, f"page errors: {errors}")
        screenshot(page, out, "legacy-checkpoint-4-3")
        return {"status":"passed", "fixture":"actual 1.1 save; weak plays and checkpoint through UI",
                "weak_scores":points, "checkpoint_counters":counters, "refresh_preserved_4_3":True}
    except Exception:
        screenshot(page, out, "legacy-checkpoint-failure")
        raise
    finally:
        context.close()


def scoring_retriggers(browser, url, out, seed, scenario):
    context = context_for(browser, PROFILES["desktop"], seed)
    page = context.new_page()
    errors = watch_page(page)
    try:
        page.goto(url, wait_until="domcontentloaded")
        start_blind(page, False)
        state = page.evaluate("""scenario => {
          const c=S.hand[0];
          Object.assign(c,{rank:scenario==='photo'?13:2,bonus:0,multB:0,wild:false,
            steel:false,glass:false,goldc:false,ed:0,seal:'red',sel:false});
          const ids=scenario==='photo'?['photo','photo']:['hack','hack','dusk','dusk'];
          S.jokers=ids.map(id=>({...JDEFS.find(j=>j.id===id),uid:++cid,ed:0}));
          S.handsLeft=scenario==='photo'?4:1; S.target=100000; S.boss=null;
          renderAll();
          return {rank:c.rank,seal:c.seal,jokers:ids,hands:S.handsLeft};
        }""", scenario)
        screenshot(page, out, f"scoring-{scenario}-fixture")
        page.locator("#handRow .card").first.click()
        page.locator("#btnPlay").click()
        page.wait_for_function("() => S && !S.busy && S.score > 0", timeout=20000)
        score = read_number(page, "#scoreVal")
        # Photo: (5 + 10 + 10) * (2*2*2*2) = 400.
        # Repeats: (5 + 6*2) * 1 = 17; six triggers include the base trigger.
        expected = 400 if scenario == "photo" else 17
        require(score == expected, f"{scenario} scoring expected {expected}, got {score}; fixture={state}")
        require(not errors, f"page errors: {errors}")
        screenshot(page, out, f"scoring-{scenario}-result")
        return {"status": "passed", "fixture": "normal blind, directly injected joker/card combination", "state": state,
                "score": score, "expected": expected}
    except Exception:
        screenshot(page, out, f"scoring-{scenario}-failure")
        raise
    finally:
        context.close()


def expanded_hand(browser, url, out, seed, kind):
    cases = {
        "five": {"name": "五条", "ranks": [9,9,9,9,9], "suits": [0,1,2,3,0], "score": 1980},
        "flushhouse": {"name": "同花葫芦", "ranks": [9,9,9,7,7], "suits": [0,0,0,0,0], "score": 2534},
        "flushfive": {"name": "同花五条", "ranks": [9,9,9,9,9], "suits": [0,0,0,0,0], "score": 3280},
    }
    expected = cases[kind]
    context = context_for(browser, PROFILES["desktop"], seed)
    page = context.new_page()
    errors = watch_page(page)
    try:
        page.goto(url, wait_until="domcontentloaded")
        start_blind(page, False)
        page.evaluate("""spec => {
          S.hand.slice(0,5).forEach((c,i)=>Object.assign(c,{rank:spec.ranks[i],suit:spec.suits[i],
            bonus:0,multB:0,wild:false,steel:false,glass:false,goldc:false,ed:0,seal:null,sel:false}));
          S.jokers=[]; S.target=100000; S.boss=null; renderAll();
        }""", expected)
        for i in range(5):
            page.locator("#handRow .card").nth(i).click()
        preview = page.locator("#prevName").inner_text().strip()
        require(preview == expected["name"], f"{kind} preview expected {expected['name']}, got {preview}")
        screenshot(page, out, f"hand-{kind}-preview")
        page.locator("#btnPlay").click()
        page.wait_for_function("() => S && !S.busy && S.score > 0", timeout=20000)
        score = read_number(page, "#scoreVal")
        require(score == expected["score"], f"{kind} expected score {expected['score']}, got {score}")
        require(not errors, f"page errors: {errors}")
        return {"status": "passed", "fixture": "normal blind, directly modified five canonical hand cards",
                "name": preview, "score": score}
    except Exception:
        screenshot(page, out, f"hand-{kind}-failure")
        raise
    finally:
        context.close()


def wild_suit_boss(browser, url, out, seed):
    context = context_for(browser, PROFILES["desktop"], seed)
    page = context.new_page()
    errors = watch_page(page)
    try:
        page.goto(url, wait_until="domcontentloaded")
        start_blind(page, False)
        page.evaluate("""() => {
          Object.assign(S.hand[0],{rank:2,suit:0,wild:true,bonus:0,multB:0,
            steel:false,glass:false,goldc:false,ed:0,seal:null,sel:false});
          S.boss=BOSSES.find(b=>b.id==='hearts'); S.jokers=[]; S.target=100000; renderAll();
        }""")
        card = page.locator("#handRow .card").first
        require("debuff" in (card.get_attribute("class") or ""),
                "wild card was not visibly debuffed by the heart-suit boss")
        card.click()
        page.locator("#btnPlay").click()
        page.wait_for_function("() => S && !S.busy && S.score > 0", timeout=20000)
        score = read_number(page, "#scoreVal")
        require(score == 5, f"wild card should be debuffed; expected only base high-card 5 points, got {score}")
        require(not errors, f"page errors: {errors}")
        screenshot(page, out, "wild-boss-result")
        return {"status": "passed", "fixture": "normal blind, injected one wild card and heart-suit boss", "score": score}
    except Exception:
        screenshot(page, out, "wild-boss-failure")
        raise
    finally:
        context.close()


def joker_reorder(browser, url, out, seed):
    scores = {}
    for moved in (False, True):
        context = context_for(browser, PROFILES["desktop"], seed)
        page = context.new_page()
        errors = watch_page(page)
        try:
            page.goto(url, wait_until="domcontentloaded")
            start_blind(page, False)
            page.evaluate("""() => {
              Object.assign(S.hand[0],{rank:2,bonus:0,multB:0,wild:false,steel:false,
                glass:false,goldc:false,ed:0,seal:null,sel:false});
              S.jokers=['joker','stencil'].map(id=>{
                const j=JDEFS.find(j=>j.id===id);
                return {...j,uid:++cid,state:j.state||0,sell:Math.max(1,Math.ceil(j.price/2)),ed:0};
              });
              S.jokerSlots=5; S.target=100000; S.boss=null; renderAll();
            }""")
            if moved:
                page.locator("#jokerRow .joker").first.click()
                page.locator("#ovOwned").wait_for(state="visible")
                page.locator("#moveRight").click()
                require(page.evaluate("() => S.jokers.map(j=>j.id)") == ["stencil", "joker"],
                        "moving the first joker right did not change the order")
                page.keyboard.press("Escape")
                page.locator("#ovOwned").wait_for(state="hidden")
                reload_and_resume(page, False, "#handRow .card")
                require(page.evaluate("() => S.jokers.map(j=>j.id)") == ["stencil", "joker"],
                        "moved joker order did not survive refresh")
                screenshot(page, out, "joker-reordered")
            page.locator("#handRow .card").first.click()
            page.locator("#btnPlay").click()
            page.wait_for_function("() => S && !S.busy && S.score > 0", timeout=20000)
            score = read_number(page, "#scoreVal")
            expected = 56 if moved else 140
            require(score == expected, f"joker order moved={moved}: expected {expected}, got {score}")
            require(not errors, f"page errors: {errors}")
            scores["moved" if moved else "original"] = score
        except Exception:
            screenshot(page, out, f"joker-reorder-{'moved' if moved else 'original'}-failure")
            raise
        finally:
            context.close()
    return {"status": "passed", "fixture": "normal blind, directly injected two jokers and a plain 2", "scores": scores}


def settings_independent(browser, url, out, seed):
    # Unlike deterministic play cases, keep the browser's real Web Audio API
    # enabled so the test can inspect the actual music and effect gain nodes.
    context = browser.new_context(viewport={"width": 1365, "height": 768}, locale="zh-CN")
    page = context.new_page()
    errors = watch_page(page)
    try:
        page.goto(url, wait_until="domcontentloaded")
        start_blind(page, False)
        page.locator("#menuBtn").click()
        page.locator("#ovMenu").wait_for(state="visible")
        page.locator("#speedSelect").select_option("4")
        page.locator("#muteBtn").click()
        require(page.evaluate("() => !settings.music && settings.sound && settings.speed===4"),
                "music toggle unexpectedly changed sound or speed")
        gains1 = page.evaluate("""() => ({context:actx?.state || null,
          music:musicGain?.gain.value ?? null, sound:soundGain?.gain.value ?? null})""")
        require(gains1["context"] is not None and gains1["music"] == 0 and gains1["sound"] == 1,
                f"music toggle did not independently control the actual gain nodes: {gains1}")
        page.locator("#soundBtn").click()
        page.locator("#muteBtn").click()
        require(page.evaluate("() => settings.music && !settings.sound && settings.speed===4"),
                "sound and music are not independently configurable")
        gains2 = page.evaluate("""() => ({music:musicGain?.gain.value ?? null,sound:soundGain?.gain.value ?? null})""")
        require(gains2 == {"music":1,"sound":0}, f"sound toggle did not control the actual gain node: {gains2}")
        page.reload(wait_until="domcontentloaded")
        require(page.evaluate("() => settings.music && !settings.sound && settings.speed===4"),
                "settings were not retained after refresh")
        page.locator("#resumeBtn").click()
        page.locator("#menuBtn").click()
        require(page.locator("#speedSelect").input_value() == "4", "speed UI did not restore its selected value")
        foreign = [error for error in errors if "getTopURL" in error]
        app_errors = [error for error in errors if "getTopURL" not in error]
        require(not app_errors, f"page errors: {app_errors}")
        screenshot(page, out, "settings-persisted")
        return {"status": "passed", "fixture": "normal menu controls and real browser Web Audio gain nodes",
                "music": True, "sound": False, "speed": 4, "muted_music_gains": gains1,
                "muted_sound_gains": gains2, "subjective_listening": "not tested",
                "unattributed_getTopURL_errors": foreign}
    except Exception:
        screenshot(page, out, "settings-failure")
        raise
    finally:
        context.close()


def speed_modes(browser, url, out, seed):
    durations, scores = {}, {}
    for speed in (1,2,4,0):
        context = context_for(browser, PROFILES["desktop"], seed)
        page = context.new_page()
        errors = watch_page(page)
        try:
            page.goto(url, wait_until="domcontentloaded")
            start_blind(page, False)
            card = cards_on_screen(page)[0]
            expected = score_unmodified_hand([card])[0]
            page.locator("#menuBtn").click()
            page.locator("#speedSelect").select_option(str(speed))
            page.locator("#ovMenu button").filter(has_text="回到牌桌").click()
            page.locator("#handRow .card").first.click()
            start = time.perf_counter()
            page.locator("#btnPlay").click()
            page.wait_for_function("() => S && !S.busy && S.score > 0", timeout=20000)
            durations[str(speed)] = round(time.perf_counter()-start, 3)
            scores[str(speed)] = read_number(page, "#scoreVal")
            require(scores[str(speed)] == expected, f"speed {speed} changed scoring: {scores[str(speed)]} != {expected}")
            require(not errors, f"page errors: {errors}")
        except Exception:
            screenshot(page, out, f"speed-{speed}-failure")
            raise
        finally:
            context.close()
    require(durations["2"] < durations["1"] * .9 and durations["4"] < durations["1"] * .7 and
            durations["0"] < durations["1"] * .45,
            f"speed modes did not shorten actual scoring time as expected: {durations}")
    return {"status": "passed", "fixture": "normal same-seed single-card play at each menu speed",
            "seconds": durations, "scores": scores}


def backup_recovery(browser, url, out, seed):
    recovered = {}
    for damage in ("malformed", "invalid_card"):
        context = context_for(browser, PROFILES["short"], seed)
        page = context.new_page()
        errors = watch_page(page)
        try:
            page.goto(url, wait_until="domcontentloaded")
            start_blind(page, True)
            for _ in range(2):
                page.locator("#handRow .card").first.tap()
                page.locator("#btnDiscard").tap()
            page.wait_for_timeout(100)
            data = page.evaluate("""() => ({main:localStorage.getItem('pixel-balatro.run.v1'),
              backup:localStorage.getItem('pixel-balatro.run.v1.backup')})""")
            require(data["backup"], "two genuine discards did not create a backup")
            backup = json.loads(data["backup"])
            by_id = {c["id"]: c for c in backup["state"]["deckAll"]}
            suits = ["♠", "♥", "♣", "♦"]
            expected_cards = [[by_id[id]["rank"], suits[by_id[id]["suit"]]] for id in backup["state"]["hand"]]
            expected_counters = [backup["state"][k] for k in ("score", "handsLeft", "discLeft")]
            if damage == "malformed":
                bad = "{"
            else:
                corrupted = json.loads(data["main"])
                corrupted["state"]["deckAll"][0]["rank"] = 99
                bad = json.dumps(corrupted)
            page.evaluate("raw => localStorage.setItem('pixel-balatro.run.v1',raw)", bad)
            page.reload(wait_until="domcontentloaded")
            resume = page.locator("#resumeBtn")
            require(resume.is_visible() and "备份" in resume.inner_text(),
                    f"{damage}: valid backup was not offered after corrupting primary")
            resume.tap()
            page.locator("#handRow .card").first.wait_for(state="visible")
            actual = [list(card) for card in cards_on_screen(page)]
            counters = [read_number(page, s) for s in ("#scoreVal", "#handsVal", "#discVal")]
            require(actual == expected_cards and counters == expected_counters,
                    f"{damage}: recovered wrong state: {actual}, {counters} vs {expected_cards}, {expected_counters}")
            references = page.evaluate("""() => S.hand.every(c=>c===S.deckAll.find(x=>x.id===c.id)) &&
              S.drawPile.every(c=>c===S.deckAll.find(x=>x.id===c.id))""")
            require(references, f"{damage}: backup deck references are not canonical")
            require(not errors, f"page errors: {errors}")
            screenshot(page, out, f"backup-{damage}")
            recovered[damage] = {"counters": counters, "hand_size": len(actual), "canonical_references": references}
        except Exception:
            screenshot(page, out, f"backup-{damage}-failure")
            raise
        finally:
            context.close()
    return {"status": "passed", "fixture": "normal play creates a backup; primary storage is then deliberately corrupted",
            "recovered": recovered}


def corrupt_pack_recovery(browser, url, out, seed):
    result = {}
    for damage in ("active_copy", "canonical_options"):
        context = context_for(browser, PROFILES["desktop"], seed)
        page = context.new_page()
        errors = watch_page(page)
        try:
            enter_shop(page, url, False)
            select_shop_tab(page, "packs", False)
            page.locator("#shopPacks .shopItem").first.click()
            page.locator("#ovPack").wait_for(state="visible")
            choices = page.locator("#packCards").inner_text()
            page.wait_for_timeout(100)
            data = page.evaluate("""() => ({main:localStorage.getItem('pixel-balatro.run.v1'),
              backup:localStorage.getItem('pixel-balatro.run.v1.backup')})""")
            require(data["backup"], "no previous snapshot exists before opening a pack")
            damaged = json.loads(data["main"])
            pack = damaged["state"].get("pack")
            require(pack, "open pack was not saved")
            if damage == "active_copy":
                pack["options"][0] = None
            else:
                damaged["state"]["shop"]["packs"][pack["index"]]["options"][0] = None
            page.evaluate("raw => localStorage.setItem('pixel-balatro.run.v1',raw)", json.dumps(damaged))
            page.reload(wait_until="domcontentloaded")
            resume = page.locator("#resumeBtn")
            require(resume.is_visible(), f"{damage}: no valid save or backup was offered")
            label = resume.inner_text()
            if damage == "canonical_options":
                require("备份" in label, "damaged canonical pack options did not trigger backup recovery")
            resume.click()
            page.locator("#ovShop").wait_for(state="visible")
            if damage == "active_copy":
                page.locator("#ovPack").wait_for(state="visible")
                require(page.locator("#packCards").inner_text() == choices,
                        "damaged active copy did not recover its original canonical candidates")
            require(not errors, f"page errors: {errors}")
            screenshot(page, out, f"corrupt-pack-{damage}")
            result[damage] = {"resume_label": label, "recovered_original_pack": damage == "active_copy"}
        except Exception:
            screenshot(page, out, f"corrupt-pack-{damage}-failure")
            raise
        finally:
            context.close()
    return {"status": "passed", "fixture": "normal shop/pack; corrupt active copy or canonical saved options separately",
            "recovered": result}


def endless_after_victory(browser, url, out, seed):
    context = context_for(browser, PROFILES["short"], seed)
    page = context.new_page()
    errors = watch_page(page)
    try:
        page.goto(url, wait_until="domcontentloaded")
        request_new_solo(page, True)
        page.locator("#ovBlinds").wait_for(state="visible")
        # Place a normal run immediately before the eighth-ante final boss.
        # Lowering only its target keeps the completion action genuinely played.
        page.evaluate("""() => {
          S.ante=8; S.blindIdx=2; S.anteBoss=BOSSES.find(b=>b.id==='arm'); showBlindSelect();
        }""")
        page.locator("#blindCols .cur .bbtn:not(.skip)").first.tap()
        page.locator("#handRow .card").first.wait_for(state="visible")
        page.evaluate("() => { S.target=1; renderStats(); }")
        page.locator("#handRow .card").first.tap()
        page.locator("#btnPlay").tap()
        page.locator("#ovWin").wait_for(state="visible", timeout=20000)
        require(page.evaluate("() => S.ante===8 && S.blindIdx===2 && S.winPending"), "wrong victory state")
        screenshot(page, out, "endless-victory")
        reload_and_resume(page, True, "#ovWin")
        page.locator('#ovWin button[onclick="continueEndless()"]',).tap()
        page.locator("#ovCash").wait_for(state="visible")
        reload_and_resume(page, True, "#ovCash")
        page.locator('#ovCash button[onclick="openShop()"]',).tap()
        page.locator("#ovShop").wait_for(state="visible")
        page.locator('#ovShop button[onclick="leaveShop()"]',).tap()
        page.locator("#ovBlinds").wait_for(state="visible")
        require(page.locator("#bsAnte").inner_text().strip() == "9", "endless mode did not advance to ante 9")
        require(page.evaluate("""() => S.hand.length===0 && S.score===0 &&
          S.drawPile.length===S.deckAll.length && S.drawPile.every(c=>S.deckAll.includes(c))"""),
                "previous hand/score or an incomplete deck remained in the new blind selection")
        reload_and_resume(page, True, "#ovBlinds")
        require(page.locator("#bsAnte").inner_text().strip() == "9", "ante 9 was not restored")
        page.locator("#blindCols .cur .bbtn:not(.skip)").first.tap()
        page.locator("#handRow .card").first.wait_for(state="visible")
        target = read_number(page, "#targetVal")
        require(target == 120000, f"incorrect ante 9 target: {target}")
        cards = cards_on_screen(page)
        reload_and_resume(page, True, "#handRow .card")
        require(cards_on_screen(page) == cards and read_number(page, "#targetVal") == target,
                "ante 9 hand or target changed after refresh")
        require(not errors, f"page errors: {errors}")
        screenshot(page, out, "endless-ante9-resumed")
        return {"status": "passed", "fixture": "directly set ante 8 final boss and target 1; victory and later actions use UI",
                "ante": 9, "target": target, "victory_cash_and_ante9_survived_refresh": True}
    except Exception:
        screenshot(page, out, "endless-failure")
        raise
    finally:
        context.close()


def recorded_victory(browser, url, out, seed):
    context = context_for(browser, {"width":390, "height":844, "mobile":True}, seed)
    # Observe writes without changing the game's storage behavior.
    context.add_init_script("""(() => {
      const setItem = Storage.prototype.setItem;
      window.__profileWrites = 0;
      Storage.prototype.setItem = function(key, value) {
        if (key === 'pixel-balatro.profile.v1') window.__profileWrites++;
        return setItem.call(this, key, value);
      };
    })();""")
    page = context.new_page()
    errors = watch_page(page)
    prior = {"wins": {"blue:red": {"best": 777}, "black:white": {"best": 334}}}
    try:
        page.goto(url, wait_until="domcontentloaded")
        # Only unrelated prior records are injected; the red/white result must
        # be created by the game's real scoring and victory path.
        page.evaluate("p => localStorage.setItem('pixel-balatro.profile.v1', JSON.stringify(p))", prior)
        page.reload(wait_until="domcontentloaded")
        require(page.evaluate("() => window.__profileWrites") == 0, "unexpected profile write on title load")
        request_new_solo(page, True)
        page.locator("#ovBlinds").wait_for(state="visible")
        # White-box setup of the last Boss; target remains the game's normal
        # eighth-ante target, while the score starts one point below it.
        page.evaluate("""() => {
          S.ante=8; S.blindIdx=2; S.anteBoss=BOSSES.find(b=>b.id==='arm'); showBlindSelect();
        }""")
        page.locator("#blindCols .cur .bbtn:not(.skip)").first.tap()
        page.locator("#handRow .card").first.wait_for(state="visible")
        target = page.evaluate("() => { S.score=S.target-1; renderStats(); return S.target; }")
        require(target > 1 and read_number(page, "#targetVal") == target, "boss target was not retained")
        chosen = cards_on_screen(page)[0]
        expected = score_unmodified_hand([chosen])[0]
        screenshot(page, out, "victory-record-boss-fixture")
        page.locator("#handRow .card").first.tap()
        page.locator("#btnPlay").tap()
        page.locator("#ovWin").wait_for(state="visible", timeout=20000)
        result = page.evaluate("""() => ({ante:S.ante,blind:S.blindIdx,deck:S.deckId,stake:S.stakeId,
          target:S.target,score:S.score,best:S.bestHand,played:S.lastResult.total,pending:S.winPending})""")
        require(result == {"ante":8,"blind":2,"deck":"red","stake":"white","target":target,
                           "score":target-1+expected,"best":expected,"played":expected,"pending":True},
                f"real play did not complete the intended boss: {result}")
        raw = page.evaluate("() => localStorage.getItem('pixel-balatro.profile.v1')")
        expected_profile = {"wins": {**prior["wins"], "red:white": {"best": expected}}}
        require(raw and json.loads(raw) == expected_profile, f"victory record or prior records incorrect: {raw}")
        require(page.evaluate("() => window.__profileWrites") == 1, "victory did not write the profile exactly once")
        screenshot(page, out, "victory-record-written")

        page.reload(wait_until="domcontentloaded")
        page.locator("#ovStart").wait_for(state="visible")
        page.locator("#ovStart .collectionLink").tap()
        page.locator("#ovCollection").wait_for(state="visible")
        page.locator("#collectionTabs button").filter(has_text="通关").tap()
        rows = {}
        for row in page.locator("#collectionBody .recordTable tbody tr").all():
            rows[row.locator("th").inner_text().strip()] = [x.strip() for x in row.locator("td").all_inner_texts()]
        require(rows == {"红色牌组":["✓","—","—"], "蓝色牌组":["—","✓","—"],
                         "金色牌组":["—","—","—"], "绿色牌组":["—","—","—"],
                         "黑色牌组":["✓","—","—"]}, f"record table after refresh: {rows}")
        screenshot(page, out, "victory-record-title-collection")
        page.locator('#ovCollection button[onclick="hide(\'ovCollection\')"]').tap()
        page.locator("#resumeBtn").tap()
        page.locator("#ovWin").wait_for(state="visible")
        require(page.evaluate("() => localStorage.getItem('pixel-balatro.profile.v1')") == raw,
                "resuming the victory changed existing records")
        require(page.evaluate("() => window.__profileWrites") == 0,
                "resuming the victory wrote an extra profile record")
        screenshot(page, out, "victory-record-resumed")
        reload_and_resume(page, True, "#ovWin")
        require(page.evaluate("() => localStorage.getItem('pixel-balatro.profile.v1')") == raw,
                "a second resumed victory changed existing records")
        require(page.evaluate("() => window.__profileWrites") == 0,
                "a second resume wrote an extra profile record")
        require(not errors, f"page errors: {errors}")
        return {"status":"passed", "fixture":"injected other profile records and ante 8 boss with score one below normal target; victory used actual UI play",
                "chosen":chosen, "victory":result, "profile":expected_profile, "record_table":rows,
                "profile_writes_on_victory":1, "profile_writes_on_each_resume":0, "resumes":2}
    except Exception:
        screenshot(page, out, "victory-record-failure")
        raise
    finally:
        context.close()


def latest_visual(browser, url, out, seed, width, height):
    context = context_for(browser, {"width":width,"height":height,"mobile":True}, seed)
    page = context.new_page()
    errors = watch_page(page)
    try:
        page.goto(url, wait_until="domcontentloaded")
        assert_viewport(page, width)
        start_blind(page, True)
        screenshot(page, out, f"visual-{width}x{height}-table")
        selected_score = None
        if width == 390:
            first_two = cards_on_screen(page)[:2]
            selected_score = score_unmodified_hand(first_two)[0]
            page.locator("#handRow .card").nth(0).tap()
            page.locator("#handRow .card").nth(1).tap()
            require(page.locator("#handRow .card.sel").count() == 2, "could not select two cards")
            require(read_number(page, "#scoreEstimate") == selected_score,
                    "two-card estimated score did not match the independent ordinary-card calculation")
            screenshot(page, out, f"visual-{width}x{height}-selected2")
        page.locator("#menuBtn").tap()
        page.locator("#ovMenu").wait_for(state="visible")
        page.wait_for_timeout(500)
        screenshot(page, out, f"visual-{width}x{height}-menu")
        assert_reachable(page.locator("#speedSelect"), "Speed setting")
        assert_reachable(page.locator("#soundBtn"), "Sound setting")
        box = page.locator("#ovMenu .box")
        scroll_max = box.evaluate("el => el.scrollHeight-el.clientHeight")
        if scroll_max > 2:
            swipe_up_within(page, box)
            require(box.evaluate("el => el.scrollTop") > 2, "short menu did not scroll by touch")
        close = page.locator("#ovMenu button").filter(has_text="回到牌桌")
        assert_reachable(close, "Return to table")
        screenshot(page, out, f"visual-{width}x{height}-menu-bottom")
        close.tap()
        page.locator("#ovMenu").wait_for(state="hidden")
        require(not errors, f"page errors: {errors}")
        return {"status":"passed", "fixture":"normal mobile-sized play and menu", "size":[width,height],
                "menu_max_scroll": scroll_max, "return_to_table_works": True, "selected_two_expected_score": selected_score}
    except Exception:
        screenshot(page, out, f"visual-{width}x{height}-failure")
        raise
    finally:
        context.close()


def final_deck_choices(browser, url, out, seed):
    decks = [
        {"id":"red", "name":"红色牌组", "desc":"每个盲注 +1 次弃牌", "money":4, "hands":4, "discards":4, "slots":5},
        {"id":"blue", "name":"蓝色牌组", "desc":"每个盲注 +1 次出牌，初始金币 $0", "money":0, "hands":5, "discards":3, "slots":5},
        {"id":"yellow", "name":"金色牌组", "desc":"初始金币 $10", "money":10, "hands":4, "discards":3, "slots":5},
        {"id":"green", "name":"绿色牌组", "desc":"无利息；结算每次剩余出牌 $2、每次剩余弃牌 $1", "money":4, "hands":4, "discards":3, "slots":5},
        {"id":"black", "name":"黑色牌组", "desc":"小丑槽位 +1，每个盲注 -1 次出牌", "money":4, "hands":3, "discards":3, "slots":6},
    ]
    results = []
    for deck in decks:
        context = context_for(browser, PROFILES["portrait"], seed)
        page = context.new_page()
        errors = watch_page(page)
        try:
            page.goto(url, wait_until="domcontentloaded")
            page.locator("#newBtn").tap()
            page.locator("#ovSetup").wait_for(state="visible")
            button = page.locator("#deckChoices button").filter(has_text=deck["name"])
            require(deck["desc"] in button.inner_text(), f"{deck['name']} description is incorrect")
            button.tap()
            require(page.locator("#deckChoices button").filter(has_text=deck["name"]).get_attribute("aria-pressed") == "true",
                    f"{deck['name']} was not selected")
            screenshot(page, out, f"deck-{deck['id']}-setup")
            page.locator("#beginRunBtn").tap()
            page.locator("#ovBlinds").wait_for(state="visible")
            page.locator("#blindCols .cur .bbtn:not(.skip)").first.tap()
            page.locator("#handRow .card").first.wait_for(state="visible")
            actual = {"money":read_number(page,"#moneyVal"), "hands":read_number(page,"#handsVal"),
                      "discards":read_number(page,"#discVal"), "slots":page.locator("#jokerRow .jslot").count()}
            expected = {k:deck[k] for k in ("money","hands","discards","slots")}
            require(actual == expected, f"{deck['name']} starts with {actual}; expected {expected}")
            require(page.evaluate("() => S.deckId") == deck["id"] and page.evaluate("() => S.stakeId") == "white",
                    f"{deck['name']} did not preserve selected deck/stake")
            page.locator("#menuBtn").tap()
            page.locator("#ovMenu button").filter(has_text="本局信息").tap()
            page.locator("#ovInfo").wait_for(state="visible")
            info = page.locator("#infoBody").inner_text()
            require(deck["name"] in info and "白注" in info, f"run info omitted chosen deck/stake: {info!r}")
            page.locator("#ovInfo button").last.tap()
            page.locator("#menuBtn").tap()
            page.locator("#ovMenu button").filter(has_text="新手教程").tap()
            page.locator("#tutBox").wait_for(state="visible")
            for _ in range(4):
                page.locator("#tutNext").tap()
            require(page.locator("#tutStep").inner_text().strip() == "5 / 10", "tutorial did not reach action counts")
            text = page.locator("#tutBody").inner_text()
            counts = re.search(r"出牌.*?(\d+)\s*次.*?弃牌.*?(\d+)\s*次", text, re.S)
            require(counts is not None and [int(counts.group(1)),int(counts.group(2))] == [deck["hands"],deck["discards"]],
                    f"{deck['name']} tutorial shows wrong action counts: {text!r}")
            require(not errors, f"page errors: {errors}")
            results.append({"deck":deck["id"],"description":deck["desc"],"start":actual,"run_info_and_tutorial":True})
        except Exception:
            screenshot(page, out, f"deck-{deck['id']}-failure")
            raise
        finally:
            context.close()
    return {"status":"passed", "fixture":"normal setup and play at white stake", "decks":results}


def final_card_visual(browser, url, out, seed, width, height):
    context = context_for(browser, {"width":width,"height":height,"mobile":True}, seed)
    page = context.new_page()
    errors = watch_page(page)
    try:
        page.goto(url, wait_until="domcontentloaded")
        assert_viewport(page,width)
        start_blind(page,True)
        hand = cards_on_screen(page)
        discard_rounds = 0
        while 14 not in {rank for rank, _ in hand} and discard_rounds < 4:
            keep = {next((i for i, (rank, _) in enumerate(hand) if rank == target), None)
                    for target in (10, 13)}
            require(None not in keep, f"missing K or 10 while drawing an A: {hand}")
            discard_indices = [i for i in range(len(hand)) if i not in keep][:5]
            before_discards = read_number(page,"#discVal")
            for index in discard_indices:
                page.locator("#handRow .card").nth(index).tap()
            page.locator("#btnDiscard").tap()
            require(read_number(page,"#discVal") == before_discards - 1,
                    "actual discard did not reduce the counter")
            hand = cards_on_screen(page)
            require(len(hand) == 8, "actual discard did not refill the hand")
            discard_rounds += 1
        require({10, 13, 14} <= {rank for rank, _ in hand},
                f"normal draws did not produce 10, A and K together: {hand}")
        for index in (0,1):
            assert_reachable(page.locator("#handRow .card").nth(index), f"card {index+1}")
            page.locator("#handRow .card").nth(index).tap()
        page.wait_for_timeout(200)
        require(page.locator("#handRow .card.sel").count()==2, "two selected cards were not visible")
        geometry = page.evaluate("""() => {
          const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
          const overlap=(a,b)=>Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*
            Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));
          return [...document.querySelectorAll('#handRow .card')].map(card=>{
            const outer=rect(card), corners=[...card.querySelectorAll('.rk,.st,.st2')].map(rect);
            const pips=[...card.querySelectorAll('.pips .suitIcon,.facePip .suitIcon')].map(rect);
            const cornerIcons=[...card.querySelectorAll('.st .suitIcon,.st2 .suitIcon')].map(rect);
            return {outer,corners,pips,clipped:pips.some(p=>p.left<outer.left-1||p.right>outer.right+1||
              p.top<outer.top-1||p.bottom>outer.bottom+1),
              missingOrClippedCorners:cornerIcons.length!==2||cornerIcons.some(p=>p.left<outer.left-1||
                p.right>outer.right+1||p.top<outer.top-1||p.bottom>outer.bottom+1),
              collision:pips.some(p=>corners.some(c=>overlap(p,c)>1)),
              overlappingPips:pips.some((p,i)=>pips.slice(i+1).some(q=>
                overlap(p,q)>.15*Math.min(p.width*p.height,q.width*q.height)))};
          });
        }""")
        problems = [{"index":i,"clipped":g["clipped"],"corners_clipped":g["missingOrClippedCorners"],"corner_collision":g["collision"],
                     "overlapping_pips":g["overlappingPips"]} for i,g in enumerate(geometry)
                    if not g["pips"] or g["clipped"] or g["missingOrClippedCorners"] or g["collision"] or g["overlappingPips"]]
        require(len(geometry)==8 and not problems,
                f"card symbols clipped or visibly overlapping at {width}x{height}: {problems}")
        screenshot(page,out,f"final-{width}x{height}-selected")
        expected = score_unmodified_hand(hand[:2])[0]
        estimate = read_number(page,"#scoreEstimate")
        require(estimate == expected, f"ordinary score preview {estimate} differs from independent expected {expected}")
        actual = None
        if width == 390:
            page.locator("#btnPlay").tap()
            page.wait_for_function("() => S && !S.busy && S.score>0",timeout=20000)
            actual = read_number(page,"#scoreVal")
            require(actual == expected, f"actual score {actual} differs from preview {expected}")
            screenshot(page,out,f"final-{width}x{height}-scored")
        require(not errors, f"page errors: {errors}")
        return {"status":"passed", "fixture":"normal red/white setup, actual discards, and two touched cards",
                "size":[width,height], "hand":hand, "discard_rounds":discard_rounds,
                "cards":hand[:2], "expected_score":expected, "preview":estimate, "actual_score":actual,
                "center_symbols_checked":sum(len(g["pips"]) for g in geometry)}
    except Exception:
        screenshot(page,out,f"final-{width}x{height}-failure")
        raise
    finally:
        context.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--browser", default=os.environ.get("BALATRO_BROWSER"))
    parser.add_argument("--app-dir", type=Path, default=ROOT)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--only", action="append")
    parser.add_argument("--v1-fixture", type=Path,
                        help="Capture/load a real 1.1.0 save for the capture_v1_save or v1_migration case")
    parser.add_argument("--v2-fixture", type=Path,
                        help="Capture/load an actual 1.2.0 shop save for legacy migration")
    args = parser.parse_args()
    args.app_dir = args.app_dir.resolve()
    args.output_dir = args.output_dir.resolve()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    results = {"app_dir": str(args.app_dir), "browser": args.browser or "Playwright Chromium",
               "seed": args.seed, "cases": {}}
    process, url = start_server(args.app_dir)
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=args.browser, headless=True,
                args=["--disable-extensions", "--disable-background-networking"])
            try:
                cases = {
                    "pack_cancel": lambda: pack_cancel(browser, url, args.output_dir, args.seed),
                    "pack_persistence": lambda: pack_persistence(browser, url, args.output_dir, args.seed),
                    "shop_full_slots": lambda: shop_full_slots(browser, url, args.output_dir, args.seed),
                    "modal_keyboard": lambda: modal_keyboard(browser, url, args.output_dir, args.seed),
                    "dense_320x568": lambda: dense_phone(browser, url, args.output_dir, args.seed, 568),
                    "dense_320x480": lambda: dense_phone(browser, url, args.output_dir, args.seed, 480),
                    "cancel_room": lambda: cancel_room(browser, url, args.output_dir, args.seed),
                    "cancel_create_race": lambda: cancel_create_race(browser, url, args.output_dir, args.seed),
                    "duplicate_create": lambda: duplicate_create(browser, url, args.output_dir, args.seed),
                    "disconnect_reenter": lambda: disconnect_reenter(browser, url, args.output_dir, args.seed),
                    "brief_network_outage": lambda: brief_network_outage(browser, url, args.output_dir, args.seed),
                    "voluntary_leave": lambda: voluntary_leave(browser, url, args.output_dir, args.seed),
                    "loss_checkpoint": lambda: loss_checkpoint_case(browser, url, args.output_dir, args.seed),
                    "loss_restart": lambda: loss_restart(browser, url, args.output_dir, args.seed),
                    "scoring_photo_retrigger": lambda: scoring_retriggers(browser, url, args.output_dir, args.seed, "photo"),
                    "scoring_multiple_retriggers": lambda: scoring_retriggers(browser, url, args.output_dir, args.seed, "multiple"),
                    "hand_five": lambda: expanded_hand(browser, url, args.output_dir, args.seed, "five"),
                    "hand_flushhouse": lambda: expanded_hand(browser, url, args.output_dir, args.seed, "flushhouse"),
                    "hand_flushfive": lambda: expanded_hand(browser, url, args.output_dir, args.seed, "flushfive"),
                    "wild_suit_boss": lambda: wild_suit_boss(browser, url, args.output_dir, args.seed),
                    "joker_reorder": lambda: joker_reorder(browser, url, args.output_dir, args.seed),
                    "settings_independent": lambda: settings_independent(browser, url, args.output_dir, args.seed),
                    "speed_modes": lambda: speed_modes(browser, url, args.output_dir, args.seed),
                    "backup_recovery": lambda: backup_recovery(browser, url, args.output_dir, args.seed),
                    "corrupt_pack_recovery": lambda: corrupt_pack_recovery(browser, url, args.output_dir, args.seed),
                    "endless_after_victory": lambda: endless_after_victory(browser, url, args.output_dir, args.seed),
                    "recorded_victory": lambda: recorded_victory(browser, url, args.output_dir, args.seed),
                    "visual_320": lambda: latest_visual(browser, url, args.output_dir, args.seed, 320, 568),
                    "visual_390": lambda: latest_visual(browser, url, args.output_dir, args.seed, 390, 844),
                    "final_deck_choices": lambda: final_deck_choices(browser, url, args.output_dir, args.seed),
                    "final_640x360": lambda: final_card_visual(browser, url, args.output_dir, args.seed, 640, 360),
                    "final_320x568": lambda: final_card_visual(browser, url, args.output_dir, args.seed, 320, 568),
                    "final_390x844": lambda: final_card_visual(browser, url, args.output_dir, args.seed, 390, 844),
                }
                if args.v1_fixture:
                    fixture_path = args.v1_fixture.resolve()
                    cases["v1_migration"] = lambda: v1_migration(browser, url, args.output_dir, args.seed, fixture_path)
                    cases["legacy_checkpoint"] = lambda: legacy_checkpoint(browser, url, args.output_dir, args.seed, fixture_path)
                    cases["v1_setup_cancel"] = lambda: legacy_setup_cancel(browser, url, args.output_dir, args.seed, fixture_path)
                    if args.only and "capture_v1_save" in args.only:
                        cases["capture_v1_save"] = lambda: capture_v1_save(browser, url, args.output_dir, args.seed, fixture_path)
                    if args.only and "capture_v1_judge" in args.only:
                        cases["capture_v1_judge"] = lambda: capture_v1_judge(browser, url, args.output_dir, args.seed, fixture_path)
                if args.v2_fixture:
                    v2_fixture_path = args.v2_fixture.resolve()
                    cases["v2_shop_migration"] = lambda: v2_shop_migration(browser, url, args.output_dir, args.seed, v2_fixture_path)
                    cases["v2_setup_cancel"] = lambda: legacy_setup_cancel(browser, url, args.output_dir, args.seed, v2_fixture_path)
                    if args.only and "capture_v2_shop" in args.only:
                        cases["capture_v2_shop"] = lambda: capture_v2_shop(browser, url, args.output_dir, args.seed, v2_fixture_path)
                if args.only:
                    unknown = set(args.only) - set(cases)
                    require(not unknown, f"unknown cases: {sorted(unknown)}")
                for name, run in cases.items():
                    if args.only and name not in args.only:
                        continue
                    try:
                        results["cases"][name] = run()
                        print(f"PASS {name}", flush=True)
                    except Exception as error:
                        results["cases"][name] = {"status": "failed", "error": f"{type(error).__name__}: {error}",
                                                   "traceback": traceback.format_exc()}
                        print(f"FAIL {name}: {error}", flush=True)
            finally:
                browser.close()
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
        (args.output_dir / "results.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    return 1 if any(result["status"] != "passed" for result in results["cases"].values()) else 0


if __name__ == "__main__":
    sys.exit(main())
