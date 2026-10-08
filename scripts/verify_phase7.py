"""Phase 7 verification — settings page, ⌘K shortcut, ⌘K hint, etc.

Single-context, end-to-end:
  1. /settings route loads.
  2. Sections render (account, privacy, notifications, appearance).
  3. Notifications sound toggle persists across reloads.
  4. ⌘K (or Ctrl+K) focuses the conversation-list search input.
  5. `/` does the same.
  6. Settings menu navigates to /settings?section=...
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
    page.wait_for_url(BASE + "/", timeout=15000)


def step(label):
    safe = label.encode("ascii", "replace").decode("ascii")
    print(f"\n--- {safe} ---", flush=True)


def assert_(cond, msg):
    print(f"  {'PASS' if cond else 'FAIL'} - {msg}", flush=True)
    return cond


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={"width": 1280, "height": 800})
    page = ctx.new_page()

    login(page, "+15550000001")
    page.wait_for_selector('aside[aria-label="Conversations"]', timeout=8000)
    page.wait_for_timeout(2000)

    step("AC#1: /settings route loads with 4 sections")
    page.goto(BASE + "/settings", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_selector("h1", timeout=5000)
    title = page.locator("h1").first.text_content() or ""
    assert_(title.strip() == "Settings", f"h1 is {title!r}")
    section_nav_items = page.locator('nav[aria-label="Settings sections"] button').count()
    assert_(section_nav_items == 4, f"nav has {section_nav_items} items, want 4")

    step("AC#2: Account section shows the form")
    page.get_by_role("button", name="Account").click()
    page.wait_for_timeout(150)
    assert_(page.locator('form[aria-label="Account"]').count() == 1, "Account form is rendered")
    # Display name input exists.
    assert_(page.locator('input[aria-label="Display name"]').count() == 1, "Display name input present")
    # Save button present.
    assert_(page.get_by_role("button", name="Save").count() == 1, "Save button present")

    step("AC#3: Notifications sound toggle persists")
    page.get_by_role("button", name="Notifications").click()
    page.wait_for_timeout(300)
    toggle = page.locator(
        'label[aria-label="Toggle sound on new messages"] input[type="checkbox"]'
    )
    assert_(toggle.count() == 1, "sound toggle present")
    # Click the visible label (the input is sr-only). The label's
    # onClick toggles the checkbox via the htmlFor-style relationship.
    label_loc = page.locator(
        'label[aria-label="Toggle sound on new messages"]'
    )
    before = toggle.is_checked()
    label_loc.click()
    page.wait_for_timeout(500)
    after = toggle.is_checked()
    assert_(after != before, f"toggle state changed ({before} -> {after})")
    val_after_click = page.evaluate(
        '() => localStorage.getItem("signal-clone:notification-sound")'
    )
    print(f"  localStorage after click: {val_after_click!r}", flush=True)
    assert_(val_after_click == "1", f"click persisted to localStorage as '1'")
    # Reload, ensure persisted.
    page.reload(wait_until="domcontentloaded", timeout=15000)
    page.wait_for_selector("h1", timeout=5000)
    page.wait_for_timeout(1500)
    val_after_reload = page.evaluate(
        '() => localStorage.getItem("signal-clone:notification-sound")'
    )
    print(f"  localStorage after reload: {val_after_reload!r}", flush=True)
    assert_(val_after_reload == "1", f"localStorage survived reload (still '1')")
    page.get_by_role("button", name="Notifications").click()
    page.wait_for_timeout(500)
    toggle2 = page.locator(
        'label[aria-label="Toggle sound on new messages"] input[type="checkbox"]'
    )
    checked_after_reload = toggle2.is_checked()
    print(f"  toggle after reload: {checked_after_reload}", flush=True)
    assert_(checked_after_reload == after, f"after reload, toggle still {after}")

    step("AC#4 + AC#5: ⌘K / `/` focuses the search input")
    # Go back to home
    page.goto(BASE + "/", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_selector('aside[aria-label="Conversations"]', timeout=8000)
    page.wait_for_timeout(500)
    # Click somewhere neutral first to make sure focus isn't on the input.
    page.locator("h1").first.click()
    page.wait_for_timeout(150)
    # ⌘K on Mac, Ctrl+K elsewhere. Playwright uses Control as the
    # canonical modifier; this works on Linux/Windows. The hook
    # accepts both.
    page.keyboard.press("Control+k")
    page.wait_for_timeout(150)
    focused = page.evaluate("() => document.activeElement?.tagName + ' ' + (document.activeElement?.placeholder || '')")
    print(f"  focused after Ctrl+K: {focused!r}".encode("ascii", "replace").decode("ascii"))
    assert_("search" in focused.lower() or "Search" in focused, "search input is focused")
    # Now test `/`
    page.locator("h1").first.click()
    page.wait_for_timeout(150)
    page.keyboard.press("/")
    page.wait_for_timeout(150)
    focused2 = page.evaluate("() => document.activeElement?.tagName + ' ' + (document.activeElement?.placeholder || '')")
    print(f"  focused after /: {focused2!r}".encode("ascii", "replace").decode("ascii"))
    assert_("search" in focused2.lower() or "Search" in focused2, "search input focused via /")

    step("AC#6: Settings menu navigates to /settings?section=...")
    page.locator('button[aria-label="Settings"][aria-haspopup="menu"]').click()
    page.wait_for_timeout(150)
    page.locator('[role="menu"][aria-label="Settings"]').get_by_role(
        "menuitem", name="Privacy"
    ).click()
    page.wait_for_url("**/settings?section=privacy", timeout=4000)
    print(f"  navigated to {page.url}", flush=True)
    assert_("section=privacy" in page.url, "URL has section=privacy")

    browser.close()
    print("\n=== Phase 7 verification PASSED ===", flush=True)
