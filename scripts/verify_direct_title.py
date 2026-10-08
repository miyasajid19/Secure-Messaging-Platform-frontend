"""verify_direct_title.py — direct-conversation titles.

Asserts the bug fix: opening a direct conversation (Alice ↔ Bob)
shows only Bob's name (or whoever the other party is), never the
caller's name and never "(unnamed)".
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


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={"width": 1280, "height": 800})
    page = ctx.new_page()

    login(page, "+15550000001")  # Alice
    page.wait_for_selector('aside[aria-label="Conversations"]', timeout=8000)
    page.wait_for_timeout(2000)

    # Find a direct conversation. Per Phase 4 the list shows direct
    # conversations with no group name. We pick a row whose title is
    # exactly one of the known seed participants (Bob Martinez,
    # Carla Diaz, Devon Park, etc.) — those are the direct chats.
    rows = page.locator(
        'aside[aria-label="Conversations"] button[aria-pressed]'
    )
    n = rows.count()
    known_direct_names = {
        "Bob Martinez", "Carla Diaz", "Devon Park",
        "Evelyn Roth", "Felipe Ortiz",
    }
    target_idx = None
    target_title = None
    for i in range(n):
        title = rows.nth(i).locator("span.text-sm.font-semibold").first.text_content() or ""
        title = title.strip()
        if title in known_direct_names:
            target_idx = i
            target_title = title
            break
    assert target_idx is not None, (
        f"could not find a direct conversation row; saw "
        f"{[rows.nth(i).inner_text().split(chr(10))[0] for i in range(n)]}"
    )
    print(f"  Picked direct row at index {target_idx}: {target_title!r}", flush=True)

    # The title in the list row should be the *other* party's name,
    # not "Alice Chen" (the caller).
    page_text = rows.nth(target_idx).inner_text()
    print(f"  Row text: {page_text!r}", flush=True)
    assert "Alice Chen" not in target_title, (
        f"row title contains the caller's name: {target_title!r}"
    )

    # Click the row and inspect the chat-pane header.
    rows.nth(target_idx).click()
    page.wait_for_selector('section[aria-label^="Chat with"]', timeout=8000)
    page.wait_for_timeout(800)

    # ChatHeader renders the title inside a `<button>` with
    # `aria-label="Open group info"` (group) or a plain `<button>`
    # (direct). For a direct chat, look for the header span that
    # sits next to the avatar.
    header_title = page.locator(
        'section[aria-label^="Chat with"] header span.text-base'
    ).first.text_content() or ""
    print(f"  Chat header title: {header_title!r}", flush=True)
    assert "Alice Chen" not in header_title, (
        f"header title contains the caller's name: {header_title!r}"
    )
    assert header_title.strip() != "(unnamed)", "header is the placeholder"
    assert header_title.strip() != "", "header is empty"
    assert header_title.strip() == target_title, (
        f"header title {header_title!r} != list-row title {target_title!r}"
    )

    # And the section's aria-label should match.
    section_label = page.locator(
        'section[aria-label^="Chat with"]'
    ).first.get_attribute("aria-label") or ""
    print(f"  Section aria-label: {section_label!r}", flush=True)
    assert "Alice Chen" not in section_label, (
        f"section aria-label leaks caller: {section_label!r}"
    )

    print("\n=== verify_direct_title.py PASSED ===", flush=True)
    browser.close()
