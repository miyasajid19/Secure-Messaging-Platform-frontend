"use client";

/**
 * Client-side providers wrapping the App Router tree.
 *
 * Lives in `app/` so the layout can stay a Server Component (RSC) and
 * still hydrate this client subtree. Three responsibilities:
 *
 * 1. A single `QueryClient` for TanStack Query, lazy-initialised in
 *    `useState` so HMR in dev doesn't leak observers between reloads.
 * 2. `useAuthStore.hydrate()` once on mount — reads `localStorage` and
 *    populates the auth store. We deliberately don't do this during
 *    module init because Next.js may import the store from RSC.
 * 3. The `<Toaster />` from `sonner` so any auth error surfaces as a
 *    toast. Position is bottom-right, matching typical web UX.
 *
 * Spec: @task.md §5 ("App bootstrap") + §8 ("Toaster").
 */

import { useEffect, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { useAuthStore } from "@/store/auth";

export function Providers({ children }: { children: ReactNode }) {
  // Lazy-init so the client survives HMR (a fresh client per re-import
  // would invalidate cached queries on every save during dev).
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

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster
        position="bottom-right"
        richColors
        closeButton
        toastOptions={{
          // Defaults so per-call overrides aren't necessary for common cases.
          duration: 4000,
        }}
      />
    </QueryClientProvider>
  );
}
