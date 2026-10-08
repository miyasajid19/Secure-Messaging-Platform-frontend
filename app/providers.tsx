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
import { getOnlineUsers } from "@/lib/api";
import { useRealtimeStore } from "@/store/realtime";
import { connect, disconnect } from "@/lib/realtime";

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
    // 2) Open the WS (idempotent).
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
