"""verify_chat_scroll.py — exercises the smart-scroll behavior:

  1. Open a conversation with at least 12 messages so the list is
     scrollable.
  2. Assert: opening the conversation scrolls to the bottom
     (last message visible).
  3. Scroll to the top of the list.
  4. Send a new message from this tab.
  5. Assert: the user-sent message still scrolls to the bottom
     (sender-override) and the "N new" pill is *not* shown.
  6. Scroll back to the top.
  7. From another browser context, the same user (or any other
     user) sends a message via the WS / REST path — but for a
     single-user test we'll just hit POST /messages via Python to
     trigger a `message.new` broadcast.
  8. Assert: pill becomes visible (sender isn't us).
  9. Click the pill — assert it scrolls to the bottom and the
     pill disappears.
"""

from playwright.sync_api import sync_playwright
import re
import time
import urllib.request, json

BASE = "http://localhost:3000"
BACKEND = "http://localhost:8000"


def assert_(cond, msg):
    status = "PASS" if cond else "FAIL"
    print(f"  [{status}] {msg}", flush=True)
    if not cond:
        raise AssertionError(msg)


def login(page, phone):
    page.goto(BASE + "/auth/phone", wait_until="networkidle")
    page.locator('input[type="tel"]').fill(phone)
    page.get_by_role("button", name="Continue").click()
    page.wait_for_url("**/auth/otp*", timeout=10000)
    page.get_by_role("button", name=re.compile(r"Use 123456")).click()
    page.get_by_role("button", name="Verify").click()
    page.wait_for_url(BASE + "/", timeout=15000)


def get_scroll_state(page):
    return page.evaluate("""() => {
        const el = document.querySelector('[aria-label=\"Messages\"]');
        if (!el) return null;
        return {
            scrollTop: el.scrollTop,
            scrollHeight: el.scrollHeight,
            clientHeight: el.clientHeight,
            atBottom: el.scrollHeight - el.scrollTop - el.clientHeight < 50,
        };
    }""")


def first_message_id_in_conv2_alice():
    req = urllib.request.Request(
        f"{BACKEND}/auth/verify-otp",
        data=json.dumps({"phone": "+15550000001", "otp": "123456"}).encode(),
        headers={"content-type": "application/json"},
    )
    return json.loads(urllib.request.urlopen(req).read().decode())["token"]


def post_message(token, content, conv_id=2):
    req = urllib.request.Request(
        f"{BACKEND}/conversations/{conv_id}/messages",
        data=json.dumps({"content": content, "type": "text", "parent_id": None}).encode(),
        headers={"content-type": "application/json", "authorization": f"Bearer {token}"},
        method="POST",
    )
    return json.loads(urllib.request.urlopen(req).read().decode())


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={"width": 1280, "height": 800})
    page = ctx.new_page()

    login(page, "+15550000001")
    page.wait_for_selector('aside[aria-label="Conversations"]', timeout=8000)
    page.wait_for_timeout(2500)

    # Step 1: open the first conversation. The seeded DB has too few
    # messages to overflow a 800px-tall viewport, so we POST a
    # handful of filler messages to make the list scrollable.
    token = first_message_id_in_conv2_alice()
    for i in range(15):
        post_message(token, f"filler-message-{i:02d}", conv_id=2)
    page.wait_for_timeout(1000)

    page.locator('aside[aria-label="Conversations"] button[aria-pressed]').first.click()
    page.wait_for_selector('section[aria-label^="Chat with"]', timeout=8000)
    page.wait_for_timeout(1500)  # allow smart-scroll effect to run

    # Step 2: at bottom after open.
    state = get_scroll_state(page)
    print(f"\n--- After open: {state}", flush=True)
    assert_(state is not None, "scroll container present")
    assert_(state["atBottom"], "scrolled to bottom on open")

    # Step 3: scroll to the top.
    page.evaluate("""() => {
        const el = document.querySelector('[aria-label=\"Messages\"]');
        el.scrollTo({ top: 0, behavior: 'instant' });
    }""")
    page.wait_for_timeout(300)
    state2 = get_scroll_state(page)
    print(f"--- After scroll to top: {state2}", flush=True)
    assert_(not state2["atBottom"], "scrolled away from bottom")

    # Step 4: send a new message from this tab.
    composer = page.locator("#composer-input")
    composer.fill("scroll-test-msg")
    composer.press("Enter")
    page.wait_for_timeout(1500)

    # Step 5: sender-override — even though we scrolled up, the
    # user's own send should scroll to the bottom.
    state3 = get_scroll_state(page)
    print(f"--- After sending while scrolled up: {state3}", flush=True)
    assert_(state3["atBottom"], "sender-override scrolled to bottom")
    pill = page.locator('button[aria-label*="new message" i]').count()
    print(f"--- pill present after self-send: {pill > 0}", flush=True)
    assert_(not (pill > 0), "no pill after self-send")

    # Step 6: scroll back to the top so the next incoming
    # message will be "off-screen".
    page.evaluate("""() => {
        const el = document.querySelector('[aria-label=\"Messages\"]');
        el.scrollTo({ top: 0, behavior: 'instant' });
    }""")
    page.wait_for_timeout(300)

    # Step 7: trigger an incoming message from a DIFFERENT user so
    # the chat-pane's smart-scroll logic sees `isMine = false` and
    # surfaces the pill (rather than auto-scrolling).
    bob_token = json.loads(urllib.request.urlopen(urllib.request.Request(
        f"{BACKEND}/auth/verify-otp",
        data=json.dumps({"phone": "+15550000002", "otp": "123456"}).encode(),
        headers={"content-type": "application/json"},
    )).read().decode())["token"]
    post_message(bob_token, "incoming-for-scroll-test")
    page.wait_for_timeout(2000)

    # Step 8: pill should be visible.
    pill_count = page.locator('button[aria-label*="new message" i]').count()
    pill_text = (
        page.locator('button[aria-label*="new message" i]').first.inner_text()
        if pill_count > 0 else ""
    )
    print(f"--- after incoming message: pill_count={pill_count} text={pill_text!r}", flush=True)
    assert_(pill_count > 0, "pill is visible while scrolled up")
    assert_("1 new" in pill_text or "new message" in pill_text.lower(), f"pill text mentions new message: {pill_text!r}")

    # Step 9: click the pill — assert scroll to bottom + pill gone.
    page.locator('button[aria-label*="new message" i]').first.click()
    page.wait_for_timeout(1500)
    state4 = get_scroll_state(page)
    print(f"--- after pill click: {state4}", flush=True)
    assert_(state4["atBottom"], "scrolled to bottom after pill click")
    pill_after = page.locator('button[aria-label*="new message" i]').count()
    assert_(pill_after == 0, "pill gone after click")

    # Step 10: scrolled-up + manual scroll back to bottom should
    # also clear the pill. Use Bob's token so the message is
    # actually "incoming" from the chat-pane's perspective.
    page.evaluate("""() => {
        const el = document.querySelector('[aria-label=\"Messages\"]');
        el.scrollTo({ top: 0, behavior: 'auto' });
    }""")
    page.wait_for_timeout(500)
    state_before_step10 = get_scroll_state(page)
    print(f"--- step 10 pre-POST: {state_before_step10}", flush=True)
    if state_before_step10["scrollTop"] != 0:
        # Some browsers (Safari) require both a top change and a
        # separate setTimeout to actually commit. Try harder.
        page.evaluate("""() => {
            const el = document.querySelector('[aria-label=\"Messages\"]');
            el.scrollTop = 0;
        }""")
        page.wait_for_timeout(200)
        state_before_step10 = get_scroll_state(page)
        print(f"--- after direct set: {state_before_step10}", flush=True)
    post_message(bob_token, "incoming-for-scroll-test-2")
    page.wait_for_timeout(2000)
    state_after_post = get_scroll_state(page)
    print(f"--- step 10 post-POST: {state_after_post}", flush=True)
    pill_after_post = page.locator('button[aria-label*="new message" i]').count()
    print(f"--- step 10 pill_count={pill_after_post}", flush=True)
    assert_(pill_after_post > 0, "pill re-appears")
    page.evaluate("""() => {
        const el = document.querySelector('[aria-label=\"Messages\"]');
        el.scrollTo({ top: el.scrollHeight, behavior: 'instant' });
    }""")
    page.wait_for_timeout(400)
    pill_after2 = page.locator('button[aria-label*="new message" i]').count()
    print(f"--- after manual scroll to bottom: pill={pill_after2}", flush=True)
    assert_(pill_after2 == 0, "manual scroll to bottom clears pill")

    browser.close()
    print("\n=== verify_chat_scroll.py PASSED ===", flush=True)
