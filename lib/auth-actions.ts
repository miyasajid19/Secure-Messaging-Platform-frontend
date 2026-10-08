/**
 * Shared client-side logout action.
 *
 * Used by both the left-rail avatar popover (`components/left-rail.tsx`)
 * and the new Settings menu in the conversation list
 * (`components/conversation-list-pane.tsx`). Lives outside any
 * component to avoid the two callers drifting in behaviour — logout
 * is destructive and must always do the same cleanup dance.
 *
 * Pipeline:
 *   1. POST /auth/logout (best-effort; ignore errors)
 *   2. clear the auth store (clears token + user; the Zustand
 *      `clear()` also resets the realtime store so the WS context
 *      is torn down by the React-tree consumer)
 *   3. redirect to /auth/phone
 *
 * `router` is `import.meta.client`-safe to use at the top of an
 * effect — it returns a noop outside the App Router context, which is
 * fine for this shared helper (it's only ever called from a
 * `'use client'` component).
 */

import { logout as logoutApi } from "./api";
import { useAuthStore } from "@/store/auth";
import { useRouter } from "next/navigation";

export async function performLogout(
  router: ReturnType<typeof useRouter>,
): Promise<void> {
  await logoutApi();
  useAuthStore.getState().clear();
  // Reset the realtime store too — `clear()` on the auth store
  // cascades; this also fires `disconnect()` in providers.tsx via the
  // token-change effect.
  router.replace("/auth/phone");
}
