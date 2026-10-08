"""Targeted regression: sender's outgoing message is rendered exactly
once, even though the WS handler and the composer's POST-success
replace both try to add the same row.

Run 5 times for reliability. PASS iff Alice's `<li>` count grows by
exactly 1 after sending, and the bubble's content appears once (not
twice) in her DOM.
"""

import re
import sys
import time
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"
RUNS = 5


def login(page, phone):
    page.goto(BASE + "/auth/phone", wait_until="networkidle")
    page.locator('input[type="tel"]').fill(phone)
    page.get_by_role("button", name="Continue").click()
    page.wait_for_url("**/auth/otp*", timeout=10000)
    page.get_by_role("button", name=re.compile(r"Use 123456")).click()
    page.get_by_role("button", name="Verify").click()
    page.wait_for_url(BASE + "/", timeout=15000)


def select_row(page, by_text):
    sel = 'aside[aria-label="Conversations"] button[aria-pressed]'
    page.wait_for_selector(sel, timeout=8000)
    rows = page.locator(sel)
    n = rows.count()
    for i in range(n):
        if by_text in (rows.nth(i).inner_text() or ""):
            rows.nth(i).click()
            break
    page.wait_for_selector('section[aria-label^="Chat with"]', timeout=8000)
    page.wait_for_timeout(800)


def message_count(page):
    return page.locator('section[aria-label^="Chat with"] ul > li').count()


def run_once(idx: int):
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 1280, "height": 800})
        page = ctx.new_page()
        login(page, "+15550000001")  # Alice
        page.wait_for_selector('aside[aria-label="Conversations"]', timeout=8000)
        select_row(page, by_text="Family Group")
        page.wait_for_timeout(3000)  # WS warm-up

        before = message_count(page)
        probe = f"unique-send-iter-{idx}-{int(time.time() * 1000) % 100000}"
        page.locator("#composer-input").fill(probe)
        page.locator("#composer-input").press("Enter")

        # Wait for the bubble to settle (≤2s).
        page.wait_for_timeout(2000)

        after = message_count(page)
        grew_by = after - before

        # Count occurrences of the probe text in the chat — should be 1.
        body_text = page.locator('section[aria-label^="Chat with"]').inner_text()
        occurrences = body_text.count(probe)

        browser.close()
        return {
            "iter": idx,
            "before": before,
            "after": after,
            "grew_by": grew_by,
            "probe_occurrences": occurrences,
        }


def main() -> int:
    print(f"=== verify_no_dup_send.py - {RUNS} runs ===\n", flush=True)
    fails = 0
    for i in range(1, RUNS + 1):
        try:
            r = run_once(i)
        except Exception as e:
            print(f"  iter {i}: EXCEPTION - {e}", flush=True)
            fails += 1
            continue
        ok = r["grew_by"] == 1 and r["probe_occurrences"] == 1
        status = "PASS" if ok else "FAIL"
        if not ok:
            fails += 1
        msg = (
            f"  iter {i}: [{status}] count {r['before']}->{r['after']} "
            f"(grew +{r['grew_by']}), text occurrences={r['probe_occurrences']}"
        )
        print(msg.encode("ascii", "replace").decode("ascii"), flush=True)
    print(f"\nFails: {fails} / {RUNS}", flush=True)
    return 0 if fails == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
