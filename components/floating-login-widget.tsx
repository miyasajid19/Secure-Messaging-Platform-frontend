"use client";

/**
 * Phase 9.5 — Floating login widget.
 *
 * A small fixed-position card that sits in the bottom-right corner of
 * the landing page and invites users to sign in to the demo. Mounted
 * from `app/page.tsx` (the landing page). Intentionally NOT mounted on
 * the authenticated chat shell — when the user is signed in they don't
 * need it.
 *
 * Behavior:
 *   - First visit (no sessionStorage flag): the card fades in after
 *     ~800ms so it doesn't fight the hero.
 *   - On mobile (<640px): collapsed to a small floating button (circle
 *     with `LogIn` icon). Tap expands the card; tap again collapses.
 *   - Click "Sign in" → push to `/auth/phone`.
 *   - Click "Just browsing" or the X close button → set the session-
 *     storage flag so the widget stays hidden for the session.
 *   - On `<640px` when collapsed, also auto-dismiss on click of the X.
 *
 * Hidden when an auth token already exists in localStorage
 * (useAuthStore.hydrate runs in app/providers.tsx).
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { LogIn, X } from "lucide-react";
import { useAuthStore } from "@/store/auth";

const SESSION_STORAGE_KEY = "signal-clone:hide-floating-login";
const MOBILE_BREAKPOINT = 640;

function readDismissed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(SESSION_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function markDismissed() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, "1");
  } catch {
    /* sessionStorage may be blocked — silently ignore */
  }
}

export function FloatingLoginWidget() {
  const hydrated = useAuthStore((s) => s.hydrated);
  const token = useAuthStore((s) => s.token);

  // `mounted` is flipped once on the client. While false we render
  // nothing so SSR doesn't paint a flash of the card before auth
  // hydration runs.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Delay the appearance so the widget doesn't fight the hero on first
  // paint. ~800ms per task.md.
  const [appeared, setAppeared] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (dismissed) return;
    setDismissed(readDismissed());
  }, [dismissed]);

  useEffect(() => {
    if (!mounted || dismissed) return;
    const t = window.setTimeout(() => setAppeared(true), 800);
    return () => window.clearTimeout(t);
  }, [mounted, dismissed]);

  // Track viewport so the widget collapses to a small button on mobile.
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // Mobile collapsed/expanded toggle (separate from dismissal).
  const [mobileExpanded, setMobileExpanded] = useState(false);

  // Don't show at all if the user is already authenticated. Wait for
  // hydration so we don't flash the widget for users who actually have
  // a token in localStorage.
  if (!mounted || !hydrated) return null;
  if (token) return null;
  if (dismissed) return null;

  // On mobile, before the widget appears, show nothing.
  if (!appeared) return null;

  // Mobile collapsed state — show just the round button.
  if (isMobile && !mobileExpanded) {
    return (
      <button
        type="button"
        aria-label="Open sign-in widget"
        onClick={() => setMobileExpanded(true)}
        className="fixed bottom-6 right-6 z-40 flex h-12 w-12 items-center justify-center rounded-full text-white shadow-lg transition hover:scale-105 focus:outline-none focus:ring-4"
        style={{
          backgroundColor: "var(--color-accent)",
          boxShadow: "var(--color-widget-shadow)",
        }}
      >
        <LogIn size={20} aria-hidden />
      </button>
    );
  }

  function handleDismiss() {
    markDismissed();
    setDismissed(true);
  }

  return (
    <aside
      aria-label="Sign in to the demo"
      role="complementary"
      className="fixed bottom-6 right-6 z-40 w-[320px] max-w-[calc(100vw-2rem)] rounded-2xl border bg-[var(--color-bg-elevated)] p-4 transition-all duration-200"
      style={{
        borderColor: "var(--color-border-subtle)",
        boxShadow: "var(--color-widget-shadow)",
        // Subtle hover lift (only on devices that support hover).
      }}
      onMouseEnter={(event) => {
        (event.currentTarget as HTMLElement).style.transform =
          "translateY(-2px)";
      }}
      onMouseLeave={(event) => {
        (event.currentTarget as HTMLElement).style.transform = "translateY(0)";
      }}
    >
      <button
        type="button"
        aria-label="Dismiss sign-in widget"
        onClick={handleDismiss}
        className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-tertiary)]"
      >
        <X size={14} aria-hidden />
      </button>

      <h3 className="mb-1 pr-6 text-sm font-semibold text-[var(--color-fg-primary)]">
        Try the live demo
      </h3>
      <p className="mb-3 text-xs leading-relaxed text-[var(--color-fg-secondary)]">
        Sign in with any phone — OTP is always{" "}
        <code className="rounded bg-[var(--color-bg-secondary)] px-1 py-0.5 font-mono text-[11px] text-[var(--color-fg-primary)]">
          123456
        </code>
        .
      </p>
      <Link
        href="/auth/phone"
        className="inline-flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-white transition hover:opacity-95"
        style={{ backgroundColor: "var(--color-accent)" }}
      >
        <LogIn size={14} aria-hidden />
        Sign in
      </Link>
      <button
        type="button"
        onClick={handleDismiss}
        className="mt-2 block w-full text-center text-xs text-[var(--color-fg-muted)] hover:text-[var(--color-fg-secondary)]"
      >
        Just browsing
      </button>
    </aside>
  );
}