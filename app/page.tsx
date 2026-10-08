"use client";

/**
 * Phase 2 placeholder home page.
 *
 * Lives in the root segment because the App Router needs a page there.
 * Phase 3 replaces this with the three-pane Signal shell. For now we:
 *
 *   - wait until the auth store has hydrated from `localStorage`
 *   - redirect to `/auth/phone` if no token
 *   - call `GET /auth/me` via TanStack Query to validate the stored JWT
 *   - render the user's display name (or phone), with a Logout button
 *   - if `/auth/me` returns 401 (expired/stale token), clear the store
 *     and bounce back to login
 *
 * All client-side — no RSC fetches. This satisfies §9 of the spec.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { LogOut, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { ApiError, getMe, queryKeys } from "@/lib/api";
import {
  selectIsAuthenticated,
  useAuthStore,
} from "@/store/auth";

export default function HomePage() {
  const router = useRouter();
  const hydrated = useAuthStore((s) => s.hydrated);
  const isAuthed = useAuthStore(selectIsAuthenticated);
  const clear = useAuthStore((s) => s.clear);
  const storedUser = useAuthStore((s) => s.user);

  // Boot-time redirect: if hydration finds no token, send to login.
  useEffect(() => {
    if (hydrated && !isAuthed) {
      router.replace("/auth/phone");
    }
  }, [hydrated, isAuthed, router]);

  const meQuery = useQuery({
    queryKey: queryKeys.me,
    queryFn: getMe,
    // Only run the validation once we have a token.
    enabled: hydrated && isAuthed,
    // Avoid hammering: cached per token.
    staleTime: 30_000,
  });

  // Surface 401 as a clean logout + redirect.
  useEffect(() => {
    if (meQuery.error instanceof ApiError && meQuery.error.status === 401) {
      clear();
      router.replace("/auth/phone");
    }
  }, [meQuery.error, clear, router]);

  if (!hydrated) {
    return (
      <main className="flex min-h-full items-center justify-center px-4">
        <p className="text-sm text-[var(--color-fg-muted)]">Loading…</p>
      </main>
    );
  }

  // While the redirect effect runs, render a placeholder so we don't
  // briefly flash authenticated chrome for a user with no token.
  if (!isAuthed) {
    return (
      <main className="flex min-h-full items-center justify-center px-4">
        <p className="text-sm text-[var(--color-fg-muted)]">
          Redirecting to sign-in…
        </p>
      </main>
    );
  }

  const user = meQuery.data ?? storedUser;
  const label = user?.display_name || user?.phone || "your account";

  function handleLogout() {
    clear();
    toast.success("Signed out");
    router.replace("/auth/phone");
  }

  return (
    <main className="flex min-h-full flex-col items-center justify-center px-4 py-12">
      <div
        className="w-full max-w-[420px] rounded-2xl border bg-[var(--color-bg-primary)] p-8 text-center shadow-sm"
        style={{ borderColor: "var(--color-border-subtle)" }}
      >
        <div
          className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full"
          style={{
            backgroundColor: "var(--color-bg-tertiary)",
            color: "var(--color-accent)",
          }}
          aria-hidden
        >
          <MessageCircle size={22} />
        </div>
        <h1 className="text-xl font-semibold tracking-tight text-[var(--color-fg-primary)]">
          Welcome back
        </h1>
        <p className="mt-1 text-sm text-[var(--color-fg-secondary)]">
          Logged in as{" "}
          <span className="font-medium text-[var(--color-fg-primary)]">
            {meQuery.isLoading || meQuery.isFetching
              ? "…"
              : label}
          </span>
        </p>
        {meQuery.error instanceof ApiError && meQuery.error.status !== 401 ? (
          <p
            className="mt-3 text-sm"
            style={{ color: "var(--color-status-error)" }}
            role="alert"
          >
            Couldn&apos;t validate session: {meQuery.error.message}
          </p>
        ) : null}
        <button
          type="button"
          onClick={handleLogout}
          className="mt-6 inline-flex items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold transition hover:bg-[var(--color-bg-tertiary)] disabled:cursor-not-allowed disabled:opacity-60"
          style={{
            borderColor: "var(--color-border-default)",
            color: "var(--color-fg-primary)",
          }}
        >
          <LogOut size={16} aria-hidden />
          Log out
        </button>
        <p className="mt-6 text-xs text-[var(--color-fg-muted)]">
          Phase 3 will replace this with the Signal UI shell.
        </p>
      </div>
    </main>
  );
}
