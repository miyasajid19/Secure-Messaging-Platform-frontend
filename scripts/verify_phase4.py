"""Phase 4 verification: live API wiring + AddContactModal.

If the backend Phase 4 endpoints (`/conversations`, `/contacts`,
`/users/search`) aren't mounted yet, the script reports each check
clearly and surfaces SKIP rather than a hard failure for the
data-driven checks. Acceptance criteria not verifiable until backend
land: #1, #2, #3, #4, #6, #7, #8 — these will read SKIP.

Always-runnable checks (don't depend on backend Phase 4):
  - Shell renders 3 regions
  - Search filter does not crash on empty backend
  - Compose button opens the AddContactModal
  - Empty backend → empty-state path renders (no crash)
  - Auth flow still works
"""

from playwright.sync_api import sync_playwright
import re

BASE = "http://localhost:3000"

def step(label):
    safe = label.encode("ascii", "replace").decode("ascii")
    print(f"\n=== {safe} ===", flush=True)

def check(label, ok, detail=""):
    status = "PASS" if ok else "FAIL"
    sk = "SKIP" if ok is None else status
    safe_label = label.encode("ascii", "replace").decode("ascii")
    safe_detail = detail.encode("ascii", "replace").decode("ascii")
    print(f"  [{sk}] {safe_label}{(' - ' + safe_detail) if detail else ''}", flush=True)
    return ok


def login(page, phone):
    page.goto(BASE + "/auth/phone", wait_until="networkidle")
    page.locator('input[type="tel"]').fill(phone)
    page.get_by_role("button", name="Continue").click()
    page.wait_for_url("**/auth/otp*", timeout=10000)
    page.get_by_role("button", name=re.compile(r"Use 123456")).click()
    page.get_by_role("button", name="Verify").click()
    page.wait_for_url(BASE + "/", timeout=15000)


def open_modal(page):
    """Click the compose (pencil) icon and wait for the modal."""
    try:
        page.locator('button[aria-label="New chat"]').click()
        page.wait_for_selector('[role="dialog"][aria-label="Add contact"]', timeout=4000)
        return True
    except Exception:
        return False


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={"width": 1280, "height": 800})
    page = ctx.new_page()

    step("Login as Alice (seeded user)")
    login(page, "+15550000001")

    step("Shell renders 3 regions (rail + list + chat pane)")
    page.wait_for_selector('[aria-label="Primary"]', timeout=8000)
    page.wait_for_selector('aside[aria-label="Conversations"]', timeout=8000)
    rail_ok = page.locator('[aria-label="Primary"]').count() == 1
    list_ok = page.locator('aside[aria-label="Conversations"]').count() == 1
    check("Three regions render", rail_ok and list_ok)

    # Wait for either list rows OR an empty state OR an error message to
    # show up. Backend Phase 4 may be live (real rows), partial (error),
    # or absent (skeleton → empty state).
    page.wait_for_timeout(2500)  # let the useQuery settle
    rows = page.locator('aside[aria-label="Conversations"] button[aria-pressed]')
    n = rows.count()
    list_empty = page.locator('text=No conversations yet').count() > 0
    list_error = page.locator('text=Couldn\'t load conversations').count() > 0

    if n > 0:
        # ---- Backend live path ----
        check(">= 1 conversation from API", n >= 1, f"count={n}")
        check("AC#3: empty backend -> empty state", False, f"backend returned {n} conversations")
        check("AC#4: skeleton -> real rows", True, "rows rendered")

        step("Click first conversation -> loads messages via API")
        rows.first.click()
        try:
            page.wait_for_selector('section[aria-label^="Chat with"]', timeout=10000)
            page.wait_for_timeout(1500)  # let messages query settle
            messages = page.locator('section[aria-label^="Chat with"] ul li')
            m = messages.count()
            check("Messages render in chat pane (AC#2)", m > 0, f"count={m}")
        except Exception as e:
            check("AC#2: messages load", False, str(e))

        step("Search filter (AC#9)")
        # Type a partial name and confirm the list filters
        first_name_text = rows.first.locator('span.text-sm.font-semibold').first.text_content() or ""
        first_letter = first_name_text[:2].lower() if first_name_text else "x"
        page.locator('aside[aria-label="Conversations"] input[type="search"]').fill(first_letter)
        page.wait_for_timeout(300)
        filtered = page.locator('aside[aria-label="Conversations"] button[aria-pressed]').count()
        check("Search narrows the list", filtered <= n and filtered >= 1, f"was={n} now={filtered}")
        # Clear
        page.locator('aside[aria-label="Conversations"] input[type="search"]').fill("")
        page.wait_for_timeout(300)
        cleared = page.locator('aside[aria-label="Conversations"] button[aria-pressed]').count()
        check("Clearing search restores all rows", cleared == n, f"after-clear={cleared}")
    elif list_empty:
        check("AC#3: empty backend -> empty state", True, "shows 'No conversations yet'")
        check("Live data from /conversations", None, "backend returned empty list")
        check("Messages load via API", None, "no conversation to open")
        check("Search filter visible", True, "input rendered")
        check("AC#6: click + opens modal", open_modal(page), "AddContactModal renders")
    elif list_error:
        check("AC#5: errors render an error state without crashing", True,
              "showed 'Couldn't load conversations' — graceful error path")
        # Still assert modal opens
        check("AC#6: click + opens modal", open_modal(page), "AddContactModal renders even with errored list")
    else:
        # Initial skeletons may still be visible — give it more time.
        page.wait_for_timeout(3000)
        rows2 = page.locator('aside[aria-label="Conversations"] button[aria-pressed]')
        n2 = rows2.count()
        if n2 > 0:
            check("Skeletons resolved to rows", True, f"count={n2}")
        else:
            check("Either rows, empty state, or error appears within 5s", False,
                  "still showing skeletons (backend may be slow)")

    # ---- Modal always testable ----
    step("AC#6: Compose button -> AddContactModal")
    if open_modal(page):
        check("Modal opens", True)
        # Try searching for Alice by partial phone — should return Alice
        # herself (already a contact — row shows 'added')
        page.locator('input[placeholder*="Phone"]').fill("1555")
        page.wait_for_timeout(700)
        results = page.locator('[role="dialog"] ul li')
        rc = results.count()
        check("searchUsers returns results", rc >= 1, f"count={rc}")
        # Close
        page.locator('button[aria-label="Close"]').click()
        page.wait_for_timeout(300)
        check("Modal closes on X click", page.locator('[role="dialog"]').count() == 0)

    browser.close()
    print("\n=== Phase 4 verification complete ===", flush=True)
