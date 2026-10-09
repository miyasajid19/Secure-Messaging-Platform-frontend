"""Manual-ish flow check for the surfaced-logout task.

Verifies:
  1. Settings icon in conversation-list header opens a popover.
  2. Popover has a "Log out" item.
  3. Clicking Log out shows a confirmation modal.
  4. Clicking the modal's "Log out" button redirects to /auth/phone
     and the auth-store token is cleared.
"""

from playwright.sync_api import sync_playwright
import re

BASE = "http://localhost:3000"


def login(page, phone):
    page.goto(BASE + "/auth/phone", wait_until="networkidle")
    page.locator('input[type="tel"]').fill(phone)
    page.get_by_role("button", name="Continue").click()
    page.wait_for_url("**/auth/otp*", timeout=10000)
    page.get_by_role("button", name=re.compile(r"Use 123456")).click()
    page.get_by_role("button", name="Verify").click()
    page.wait_for_url(BASE + "/chat", timeout=15000)


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={"width": 1280, "height": 800})
    page = ctx.new_page()
    login(page, "+15550000001")
    page.wait_for_selector('aside[aria-label="Conversations"]', timeout=8000)
    page.wait_for_timeout(2500)

    def step(label):
        print(f"\n--- {label} ---", flush=True)

    step("AC#1 + AC#2: open the settings menu")
    # Two "Settings" buttons exist on the page: one in the left rail
    # (`h-11`), one in the conversation-list pane header (`h-9`, with
    # `aria-haspopup="menu"`). We target the second one explicitly.
    page.locator('button[aria-label="Settings"][aria-haspopup="menu"]').click()
    page.wait_for_timeout(250)
    menu = page.locator('[role="menu"][aria-label="Settings"]')
    assert menu.is_visible(), "settings menu should be visible"
    items = menu.locator('[role="menuitem"]').count()
    print(f"  menu items: {items}")
    assert items >= 1

    step("AC#3: click Log out opens confirm modal")
    menu.get_by_role("menuitem", name="Log out").click()
    page.wait_for_timeout(250)
    modal = page.locator('[role="alertdialog"][aria-labelledby="confirm-logout-title"]')
    assert modal.is_visible(), "confirm modal should be visible"
    title = modal.locator("#confirm-logout-title").text_content()
    print(f"  modal title: {title!r}")

    step("AC#4: cancel keeps the user signed in")
    modal.get_by_role("button", name="Cancel").click()
    page.wait_for_timeout(250)
    assert not modal.is_visible(), "modal should close on cancel"
    assert page.url.rstrip("/") == BASE, f"should still be on {BASE}, got {page.url}"
    # Auth token still present.
    token = page.evaluate("() => localStorage.getItem('signal-clone:token')")
    print(f"  token present after cancel: {bool(token)}")
    assert token, "auth token should still be in localStorage after cancel"

    step("AC#4: confirm logs out and redirects to /auth/phone")
    page.locator('button[aria-label="Settings"][aria-haspopup="menu"]').click()
    page.wait_for_timeout(150)
    page.locator('[role="menu"][aria-label="Settings"]').get_by_role("menuitem", name="Log out").click()
    page.wait_for_timeout(150)
    page.locator('[role="alertdialog"][aria-labelledby="confirm-logout-title"]').get_by_role("button", name="Log out").click()
    page.wait_for_url("**/auth/phone", timeout=10000)
    token_after = page.evaluate("() => localStorage.getItem('signal-clone:token')")
    user_after = page.evaluate("() => localStorage.getItem('signal-clone:user')")
    print(f"  token after logout: {token_after}")
    print(f"  user  after logout: {user_after}")
    assert page.url.endswith("/auth/phone"), f"expected /auth/phone, got {page.url}"
    assert token_after in (None, ""), "auth token should be cleared"
    assert user_after in (None, ""), "auth user should be cleared"

    print("\n=== All logout-promotion checks PASSED ===", flush=True)
    browser.close()
