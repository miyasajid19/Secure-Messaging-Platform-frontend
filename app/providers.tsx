"use client";

/**
 * Client-side providers wrapping the App Router tree.
 *
 * Lives in `app/` so the layout can stay a Server Component (RSC) and
 * still hydrate this client subtree. Responsibilities:
 *
 * 1. A single `QueryClient` for TanStack Query, lazy-initialised in
 *    `useState` so HMR in dev doesn't leak observers between reloads.
 * 2. `useAuthStore.hydrate()` once on mount — reads `localStorage` and
 *    populates the auth store. We deliberately don't do this during
 *    module init because Next.js may import the store from RSC.
 * 3. Boot the realtime WebSocket once a token is present. The WS is
 *    closed on unmount and when the token is cleared (logout).
 * 4. Belt-and-suspenders `GET /users/online` on hydrate to seed the
 *    presence map before the WS snapshot arrives.
 * 5. `<Toaster />` from `sonner` so any auth error surfaces as a toast.
 *
 * Spec: @task.md §2 ("Mount in app/providers.tsx").
 */

import { useEffect, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { useAuthStore } from "@/store/auth";
import { getOnlineUsers, setQueryClient, type Message, queryKeys } from "@/lib/api";
import { useRealtimeStore } from "@/store/realtime";
import { useUiStore } from "@/store/ui";
import { connect, disconnect } from "@/lib/realtime";
import { useNotificationSound } from "@/lib/notification-sound";

// Phase 7 §3 — keyboard shortcuts. We can't put ⌘K / `/` on a
// component because the user is "anywhere" on the page. Mount a single
// keydown handler at provider scope and dispatch a custom event that
// the conversation-list-pane can listen for.
//
// The chosen event is `shortcut:search` so a future refactor (e.g.
// making the search a portal) can be wired without renaming.
const SHORTCUT_SEARCH_EVENT = "shortcut:search";

function installKeyboardShortcuts() {
  function onKey(e: KeyboardEvent) {
    // ⌘K / Ctrl+K
    if (
      (e.metaKey || e.ctrlKey) &&
      !e.shiftKey &&
      !e.altKey &&
      e.key.toLowerCase() === "k"
    ) {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent(SHORTCUT_SEARCH_EVENT));
      return;
    }
    // `/` — but only if the user isn't already typing in an input /
    // textarea / contenteditable. The phase 5 OTP input eats the key
    // too — that's fine, we want to focus the search only when the
    // user is "outside" text fields.
    if (
      e.key === "/" &&
      !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey
    ) {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName.toLowerCase();
      const isEditable =
        tag === "input" ||
        tag === "textarea" ||
        target?.isContentEditable;
      if (!isEditable) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent(SHORTCUT_SEARCH_EVENT));
      }
    }
  }
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}

export { SHORTCUT_SEARCH_EVENT };

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, retry: false },
          mutations: { retry: false },
        },
      }),
  );

  // Bind the singleton so WS handlers + composer use the SAME client
  // instance that <QueryClientProvider> injects via React context.
  // Without this, `setQueryData` in `lib/realtime.ts` writes to a
  // different client than the one `useQuery` reads from — and real-
  // time updates break silently. See DEBUG-FIX: Real-time message
  // reception (task.md).
  useEffect(() => {
    setQueryClient(queryClient);
  }, [queryClient]);

  // Global keyboard shortcuts (Phase 7 §3).
  useEffect(() => installKeyboardShortcuts(), []);

  // Notification sound: subscribe to the React Query cache. Whenever
  // a `['messages', id]` cache entry grows by exactly 1 and the id
  // doesn't match the currently-selected conversation, play a chime.
  // Phase 7 §5.
  const sound = useNotificationSound();
  useEffect(() => {
    const cache = queryClient.getQueryCache();
    const unsubscribe = cache.subscribe((event) => {
      if (event.type !== "updated") return;
      const key = event.query.queryKey;
      if (key[0] !== "messages") return;
      const convId = key[1] as number | null;
      if (convId == null) return;
      const next = queryClient.getQueryData<Message[]>(key) ?? [];
      const prev = (event.query.state as { data?: Message[] }).data ?? [];
      if (next.length <= prev.length) return; // ignore shrinks
      const added = next[next.length - 1];
      if (!added) return;
      const myUserId = useAuthStore.getState().user?.id ?? null;
      const isMine = myUserId != null && added.sender_id === myUserId;
      const activeId = useUiStore.getState().selectedConversationId;
      if (isMine || activeId === convId) return;
      sound.playChime();
    });
    return () => unsubscribe();
  }, [queryClient, sound]);

  // Hydrate auth from localStorage exactly once on mount. This runs in
  // the browser, so `window.localStorage` is always available here.
  const hydrate = useAuthStore((s) => s.hydrate);
  useEffect(() => {
    hydrate();
  }, [hydrate]);

  // Subscribe to the token so the WS opens/closes alongside login.
  const token = useAuthStore((s) => s.token);
  useEffect(() => {
    if (!token) {
      disconnect();
      return;
    }
    // 1) Seed presence immediately so the list pane shows correct dots.
    let cancelled = false;
    void getOnlineUsers()
      .then((ids) => {
        if (!cancelled) useRealtimeStore.getState().setPresenceSnapshot(ids);
      })
      .catch(() => {
        // Belt-and-suspenders only — the WS snapshot will catch up.
      });
    // 2) Reset `wsReady` optimistically while we wait for the new
    //    socket to register — the composer disables send during this
    //    window (Phase 6 §1).
    useRealtimeStore.getState().setWsReady(false);
    // 3) Open the WS (idempotent).
    connect();
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Close the WS on unmount as a safety net (next.js usually navigates
  // instead, but RSC errors or fast refresh can remount this tree).
  useEffect(() => {
    return () => disconnect();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster
        position="bottom-right"
        richColors
        closeButton
        toastOptions={{ duration: 4000 }}
      />
    </QueryClientProvider>
  );
}
