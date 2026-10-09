"""End-to-end auth flow verification (Phase 2 acceptance).

Walks the full flow against a running dev server at :3000 with the backend
already live on :8000. Reports PASS/FAIL per acceptance criterion and
prints final localStorage state.
"""
from playwright.sync_api import sync_playwright
import re
import sys

BASE = "http://localhost:3000"

def step(label):
    safe = label.encode("ascii", "replace").decode("ascii")
    print(f"\n=== {safe} ===", flush=True)

def check(label, ok, detail=""):
    status = "PASS" if ok else "FAIL"
    safe_label = label.encode("ascii", "replace").decode("ascii")
    safe_detail = detail.encode("ascii", "replace").decode("ascii")
    print(f"  [{status}] {safe_label}{(' - ' + safe_detail) if detail else ''}", flush=True)
    return ok

def get_storage(page):
    return page.evaluate(
        "() => ({ token: localStorage.getItem('signal-clone:token'),"
        " user: localStorage.getItem('signal-clone:user') })"
    )

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={"width": 390, "height": 844})
    page = ctx.new_page()

    # ── AC #2: '/' unauthed → /auth/phone ────────────────────────────────
    step("AC#2: '/' while logged out should land on /auth/phone")
    page.goto(BASE + "/", wait_until="networkidle")
    # Wait for client-side redirect
    page.wait_for_url("**/auth/phone", timeout=8000)
    h1 = page.locator("h1").first.text_content() or ""
    check("Redirected to /auth/phone", "/auth/phone" in page.url, page.url)
    check("Title contains 'Sign in'", "Sign in" in h1, h1)

    # ── AC #3: new phone → /auth/otp → (verify) → /onboarding ─────────────
    # Use a phone the seed script didn't create, so the user starts with
    # no display_name. Pre-clean via the request-otp endpoint.
    import time as _time
    fresh_phone = "+1555000" + str(int(_time.time()) % 10000).zfill(4)
    step(f"AC#3: enter new phone {fresh_phone} → OTP → /onboarding")
    phone_input = page.locator('input[type="tel"]')
    phone_input.fill(fresh_phone)
    page.get_by_role("button", name="Continue").click()
    page.wait_for_url("**/auth/otp*", timeout=8000)
    check("Reached /auth/otp", "/auth/otp" in page.url, page.url)
    # The dev "Use 123456" autofill button should be visible (NODE_ENV is dev)
    page.get_by_role("button", name=re.compile(r"Use 123456")).click()
    # Verify
    page.get_by_role("button", name="Verify").click()
    page.wait_for_url("**/onboarding", timeout=10000)
    check("Landed on /onboarding (new user, no display_name)", "/onboarding" in page.url, page.url)

    # ── AC #4: display name → / ───────────────────────────────────────────
    step("AC#4: submit display name 'Test User' → /")
    name_input = page.locator('input[aria-label="Display name"]')
    name_input.fill("Test User")
    page.get_by_role("button", name="Continue").click()
    page.wait_for_url(BASE + "/chat", timeout=10000)
    # Wait for /auth/me to resolve and the greeting label to settle.
    page.wait_for_selector("text=Logged in as Test User", timeout=10000)
    body_text = page.locator("body").text_content() or ""
    check("On /", page.url.rstrip("/") == BASE, page.url)
    check("Greeting shows 'Logged in as Test User'", "Logged in as Test User" in body_text, body_text[:200])

    # ── AC #5: refresh keeps user logged in ───────────────────────────────
    step("AC#5: reload '/' → user stays logged in")
    storage = get_storage(page)
    token_before = storage["token"]
    check("localStorage token present before reload", bool(token_before), "len=" + str(len(token_before or "")))
    page.reload(wait_until="networkidle")
    page.wait_for_url("**/", timeout=8000)
    storage_after = get_storage(page)
    body_text2 = page.locator("body").text_content() or ""
    check("localStorage token preserved", storage_after["token"] == token_before)
    check("Still on / and shows 'Logged in as Test User'", "Logged in as Test User" in body_text2, body_text2[:200])

    # ── AC #6: logout clears localStorage + pushes /auth/phone ───────────
    step("AC#6: Log out clears localStorage and routes to /auth/phone")
    page.get_by_role("button", name=re.compile(r"Log out")).click()
    page.wait_for_url("**/auth/phone", timeout=8000)
    storage_logout = get_storage(page)
    check("localStorage token cleared", storage_logout["token"] is None, str(storage_logout))
    check("localStorage user cleared", storage_logout["user"] is None, str(storage_logout))
    check("Redirected to /auth/phone", "/auth/phone" in page.url, page.url)

    # ── AC #7: seeded user lands directly on / (already has display_name) ──
    step("AC#7: seeded user +15550000001 → / (skip /onboarding)")
    page.locator('input[type="tel"]').fill("+15550000001")
    page.get_by_role("button", name="Continue").click()
    page.wait_for_url("**/auth/otp*", timeout=8000)
    page.get_by_role("button", name=re.compile(r"Use 123456")).click()
    page.get_by_role("button", name="Verify").click()
    try:
        # Either landing directly on / (AC#7) or /onboarding (if seeded missing display_name)
        page.wait_for_url(lambda url: url.endswith("/") or "/onboarding" in url, timeout=10000)
    except Exception:
        pass
    final_url = page.url
    check("Final URL is / (seeded user has display_name)",
          final_url.rstrip("/") == BASE,
          final_url)

    # Take a screenshot of the final state for the report
    page.screenshot(path="F:/scaler/frontend/scripts/final_state.png", full_page=True)
    print(f"\nFinal URL: {final_url}", flush=True)
    print(f"Final localStorage: {get_storage(page)}", flush=True)

    browser.close()
    print("\n=== Flow complete ===", flush=True)
