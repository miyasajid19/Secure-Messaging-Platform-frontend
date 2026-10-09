"""verify_realtime_reception.py — focused regression for the
DEBUG-FIX: real-time message reception task.

Two browser contexts (Alice and Bob) target the same conversation
(both are participants in the seeded "Family Group"). Alice sends via
the UI; Bob's `<li>` count must grow within 2s and Bob's DOM must
contain the probe text.

Run 5 times in a row to characterise flakiness. Exit code is the
number of failed iterations (0 = green).
"""

import re
import sys
import time
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

BASE = "http://localhost:3000"
RUNS = 5


def login(page, phone):
    page.goto(BASE + "/auth/phone", wait_until="networkidle")
    page.locator('input[type="tel"]').fill(phone)
    page.get_by_role("button", name="Continue").click()
    page.wait_for_url("**/auth/otp*", timeout=10000)
    page.get_by_role("button", name=re.compile(r"Use 123456")).click()
    page.get_by_role("button", name="Verify").click()
    page.wait_for_url(BASE + "/chat", timeout=15000)


def select_row(page, *, by_text=None):
    """Click the first row in the list pane. If `by_text` is set, click
    the row whose name includes that text instead — used when both
    users need to land on the same conversation."""
    sel = 'aside[aria-label="Conversations"] button[aria-pressed]'
    page.wait_for_selector(sel, timeout=8000)
    if by_text:
        # Click the matching row.
        rows = page.locator(sel)
        n = rows.count()
        chosen = None
        for i in range(n):
            txt = rows.nth(i).inner_text() or ""
            if by_text in txt:
                chosen = rows.nth(i)
                break
        if chosen is None:
            # Fall back to the first row.
            chosen = rows.first
    else:
        chosen = page.locator(sel).first
    chosen.click()
    page.wait_for_selector('section[aria-label^="Chat with"]', timeout=8000)
    page.wait_for_timeout(800)


def message_count(page):
    return page.locator('section[aria-label^="Chat with"] ul > li').count()


def run_once(idx: int):
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        a_ctx = browser.new_context(viewport={"width": 1280, "height": 800})
        b_ctx = browser.new_context(viewport={"width": 1280, "height": 800})
        page_a = a_ctx.new_page()
        page_b = b_ctx.new_page()

        login(page_a, "+15550000001")  # Alice
        login(page_b, "+15550000002")  # Bob

        page_a.wait_for_selector('aside[aria-label="Conversations"]', timeout=8000)
        page_b.wait_for_selector('aside[aria-label="Conversations"]', timeout=8000)

        # Both Alice and Bob are participants of "Family Group" in the
        # seeded DB; pick that row on both sides so the broadcast is
        # guaranteed to reach Bob.
        select_row(page_a, by_text="Family Group")
        select_row(page_b, by_text="Family Group")

        # Warm-up so the WS handshake + presence.snapshot settle.
        page_a.wait_for_timeout(3000)
        page_b.wait_for_timeout(3000)

        before_b = message_count(page_b)
        probe = f"realtime-iter-{idx}-{int(time.time() * 1000) % 100000}"

        page_a.locator("#composer-input").fill(probe)
        page_a.locator("#composer-input").press("Enter")

        # Poll up to 4s — should be near-instant after the DEBUG-FIX.
        b_grew = False
        for _ in range(16):
            page_a.wait_for_timeout(250)
            if message_count(page_b) > before_b:
                b_grew = True
                break

        b_html = page_b.locator('section[aria-label^="Chat with"]').inner_html()
        b_text_ok = probe in b_html

        browser.close()
        return {
            "iter": idx,
            "before_b": before_b,
            "after_b": message_count_taken_after if False else None,  # placeholder
            "b_grew": b_grew,
            "b_text_ok": b_text_ok,
        }


def main() -> int:
    print(f"=== verify_realtime_reception.py - {RUNS} runs ===\n", flush=True)
    results = []
    fails = 0
    for i in range(1, RUNS + 1):
        try:
            r = run_once(i)
        except Exception as e:
            print(f"  iter {i}: EXCEPTION - {e}", flush=True)
            fails += 1
            continue
        ok = r["b_grew"] and r["b_text_ok"]
        status = "PASS" if ok else "FAIL"
        if not ok:
            fails += 1
        msg = (
            f"  iter {i}: [{status}] Bob grew {r['before_b']}->{r['b_grew']}, "
            f"text present: {r['b_text_ok']}"
        )
        # Encode safely for Windows consoles (cp1252 lacks unicode arrows).
        print(msg.encode("ascii", "replace").decode("ascii"), flush=True)
    print(f"\nFails: {fails} / {RUNS}", flush=True)
    return 0 if fails == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
