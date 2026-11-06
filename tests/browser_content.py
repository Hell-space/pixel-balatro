"""Exercise 1.3 setup and collection UI in a private, headless browser context."""
from __future__ import annotations

import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

from browser_smoke import (ROOT, activate, assert_reachable, assert_viewport,
                           context_for, require, screenshot, start_server, watch_page)

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(errors="backslashreplace")

BROWSER = Path(r"D:\Quark\quark.exe")
OUTPUT = ROOT / ".qa" / "v13" / "browser-content"
PROFILES = {"small": {"width": 320, "height": 568, "mobile": True},
            "portrait": {"width": 390, "height": 844, "mobile": True}}
DECKS = ["红色牌组", "蓝色牌组", "金色牌组", "绿色牌组", "黑色牌组"]
STAKES = ["白注", "红注", "金注"]
TABS = ["小丑", "塔罗", "星球", "Boss", "通关"]


def press(page, locator, label):
    assert_reachable(locator, label)
    activate(locator, True)


def profile_case(browser, url, profile, spec, part):
    folder = OUTPUT / profile
    folder.mkdir(parents=True, exist_ok=True)
    context = context_for(browser, spec, seed=1)
    page = context.new_page()
    errors = watch_page(page)
    try:
        page.goto(url, wait_until="load")
        page.locator("#ovStart").wait_for(state="visible")
        assert_viewport(page, spec["width"])
        screenshot(page, folder, "start")

        if part == "setup":
            return setup_case(page, folder, spec, errors)
        if part == "records":
            return records_case(page, folder, spec, errors)

        press(page, page.locator("#ovStart .collectionLink"), "打开图鉴")
        page.locator("#ovCollection").wait_for(state="visible")
        tabs = page.locator("#collectionTabs button")
        require(tabs.all_inner_texts() == TABS, "图鉴标签不完整或次序不符")
        counts = {}
        for name in TABS[:-1]:
            press(page, page.locator("#collectionTabs button").filter(has_text=name), f"图鉴 {name}")
            entries = page.locator("#collectionBody .catalogEntry")
            count = entries.count()
            require(count > 0, f"{name} 图鉴为空")
            require(page.locator("#collectionSearch").is_visible(), f"{name} 搜索框不可见")
            first = entries.first.locator("h3").inner_text().strip()
            query = first.split()[-1]  # The visual icon preceding a name is not part of its text label.
            page.locator("#collectionSearch").fill(query)
            require(entries.count() >= 1, f"{name} 按名称搜索无结果：{query}")
            require(query in entries.first.inner_text(), f"{name} 搜索结果不匹配")
            page.locator("#collectionSearch").fill("no-such-card-28951")
            require("没有匹配" in page.locator("#collectionBody").inner_text(), f"{name} 无结果提示缺失")
            page.locator("#collectionSearch").fill("")
            require(entries.count() == count, f"{name} 清空搜索后未恢复")
            counts[name] = count
        screenshot(page, folder, "catalog-boss")

        press(page, page.locator("#collectionTabs button").filter(has_text="通关"), "通关记录")
        require(not page.locator("#collectionSearch").is_visible(), "通关记录不应显示搜索框")
        table = page.locator("#collectionBody table")
        require(table.locator("tbody tr").count() == 5, "通关记录应有 5 行牌组")
        require(table.locator("thead th").all_inner_texts() == ["牌组", *STAKES], "通关记录难度表头不完整")
        for row, deck in zip(table.locator("tbody tr").all(), DECKS):
            require(row.locator("th").inner_text() == deck, f"记录缺少 {deck}")
            require(row.locator("td").all_inner_texts() == ["—", "—", "—"], f"新存档记录异常：{deck}")
        screenshot(page, folder, "records")
        press(page, page.locator("#ovCollection > .box > button").last, "关闭图鉴")
        require(page.locator("#ovStart").is_visible(), "关闭图鉴后未回到标题")
        require(not errors, f"浏览器脚本错误：{errors}")
        return {"status": "passed", "viewport": spec, "catalog_counts": counts,
                "record_rows": 5}
    except Exception:
        screenshot(page, folder, f"failure-{part}")
        raise
    finally:
        context.close()


def setup_case(page, folder, spec, errors):

    press(page, page.locator("#newBtn"), "开始游戏")
    page.locator("#ovSetup").wait_for(state="visible")
    choices = page.locator("#deckChoices button")
    require(choices.count() == 5, "牌组数量不是 5")
    require([b.locator("b").inner_text() for b in choices.all()] == DECKS, "牌组列表不符")
    for i, deck in enumerate(DECKS):
        choice = page.locator("#deckChoices button").nth(i)
        press(page, choice, deck)
        choices = page.locator("#deckChoices button")
        require(choices.nth(i).get_attribute("aria-pressed") == "true", f"无法选中 {deck}")
        require(sum(c.get_attribute("aria-pressed") == "true" for c in choices.all()) == 1,
                f"{deck} 选择状态不唯一")
    require(page.locator("#stakeChoices button").all_inner_texts() == STAKES, "难度列表不符")
    for i, stake in enumerate(STAKES):
        press(page, page.locator("#stakeChoices button").nth(i), stake)
        require(page.locator("#stakeChoices button").nth(i).get_attribute("aria-pressed") == "true",
                f"无法选中 {stake}")
        require(page.locator("#stakeRule").inner_text().strip(), f"{stake} 规则为空")
        assert_reachable(page.locator("#stakeRule"), f"{stake} 规则")
    press(page, page.locator("#deckChoices button").nth(2), "金色牌组")
    screenshot(page, folder, "setup")
    assert_reachable(page.locator("#beginRunBtn"), "开始这一局")
    screenshot(page, folder, "setup-actions")
    press(page, page.locator("#beginRunBtn"), "开始这一局")
    page.locator("#ovBlinds").wait_for(state="visible")
    require("小盲注" in page.locator("#blindCols").inner_text(), "未进入盲注选择")
    raw_save = page.evaluate("localStorage.getItem('pixel-balatro.run.v1')")
    require(raw_save is not None, "新局没有保存")
    saved = json.loads(raw_save)["state"]
    require((saved["deckId"], saved["stakeId"], saved["money"], saved["baseDisc"]) ==
            ("yellow", "gold", 10, 2), "选择的牌组、难度或初始规则没有应用")
    screenshot(page, folder, "blind-selection")

    page.reload(wait_until="load")
    require(page.locator("#resumeBtn").is_visible(), "刷新后没有继续游戏")
    press(page, page.locator("#newBtn"), "已有存档时开始游戏")
    press(page, page.locator("#beginRunBtn"), "已有存档时开始这一局")
    page.locator("#ovRestart").wait_for(state="visible")
    press(page, page.locator("#ovRestart button").filter(has_text="保留进度"), "保留进度")
    require(page.locator("#resumeBtn").is_visible(), "取消重开后存档消失")
    require(page.evaluate("localStorage.getItem('pixel-balatro.run.v1')") == raw_save,
            "取消重开后原存档发生变化")
    press(page, page.locator("#resumeBtn"), "继续游戏")
    page.locator("#ovBlinds").wait_for(state="visible")
    require(not errors, f"浏览器脚本错误：{errors}")
    return {"status": "passed", "viewport": spec, "decks": DECKS, "stakes": STAKES,
            "cancel_restart_resume": True}


def records_case(page, folder, spec, errors):
    fixture = {"wins": {"red:gold": {"best": 12345}, "blue:white": {"best": 23456}}}
    page.evaluate("data => localStorage.setItem('pixel-balatro.profile.v1', JSON.stringify(data))", fixture)
    page.reload(wait_until="load")
    press(page, page.locator("#ovStart .collectionLink"), "打开已有通关记录")
    press(page, page.locator("#collectionTabs button").filter(has_text="通关"), "通关记录")
    rows = page.locator("#collectionBody tbody tr")
    require(rows.nth(0).locator("td").all_inner_texts() == ["—", "—", "✓"], "红色金注记录错误")
    require(rows.nth(1).locator("td").all_inner_texts() == ["✓", "—", "—"], "蓝色白注记录错误")
    screenshot(page, folder, "records-fixture")
    press(page, page.locator("#ovCollection > .box > button").last, "关闭已有通关记录")
    press(page, page.locator("#newBtn"), "已有记录时开始游戏")
    press(page, page.locator("#stakeChoices button").filter(has_text="金注"), "选择金注")
    require("已通关" in page.locator("#setupRecord").inner_text(), "选择牌组时未显示已有记录")
    press(page, page.locator("#stakeChoices button").filter(has_text="白注"), "选择白注")
    require(not page.locator("#setupRecord").inner_text(), "未通关的组合显示了通关标记")
    require(not errors, f"浏览器脚本错误：{errors}")
    return {"status": "passed", "viewport": spec,
            "fixture": "temporary profile with red/gold and blue/white wins; not a played victory"}


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    results = {"browser": str(BROWSER), "profile_storage": "temporary browser contexts", "cases": {}}
    process, url = start_server()
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=str(BROWSER), headless=True,
                      args=["--disable-extensions", "--disable-background-networking"])
            try:
                for profile, spec in PROFILES.items():
                    for part in ("setup", "catalog", "records"):
                        name = f"{profile}-{part}"
                        try:
                            results["cases"][name] = profile_case(browser, url, profile, spec, part)
                            print(f"PASS {name}", flush=True)
                        except Exception as exc:
                            results["cases"][name] = {"status": "failed", "error": f"{type(exc).__name__}: {exc}"}
                            print(f"FAIL {name}: {type(exc).__name__}: {exc}", flush=True)
            finally:
                browser.close()
    finally:
        process.terminate()
        process.wait(timeout=5)
        (OUTPUT / "results.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    return 1 if any(v["status"] != "passed" for v in results["cases"].values()) else 0


if __name__ == "__main__":
    sys.exit(main())
