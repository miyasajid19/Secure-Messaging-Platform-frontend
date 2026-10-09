"use client";

/**
 * Phase 9.5 — authenticated chat shell, now at `/chat`.
 * Phase 10   — responsive layout.
 *
 * History: this lived at `/` (app/page.tsx) from Phase 3 onward. As of
 * Phase 9.5 the public landing page owns `/`, so the chat shell moves to
 * `/chat`. Auth redirects in `/auth/otp` and `/onboarding` are updated
 * to push users here after sign-in. The auth-guard below redirects
 * unauthenticated visitors to `/auth/phone`.
 *
 * Responsive structure:
 *   - Mobile / tablet (<lg, 1023px): single-pane toggle between the
 *     conversation list and the chat pane. The left rail is hidden
 *     (its 68px width would be wasted real estate on a 375px viewport);
 *     a hamburger in the list header brings it back as an overlay if
 *     the user really needs it.
 *   - Laptop / desktop (lg+, 1024px+): three-pane layout — left rail +
 *     conversation list + chat — all visible side-by-side.
 *
 * `mobileFocus` flips between "list" and "chat" on the single-pane
 * viewports when the user selects a conversation or hits the back
 * arrow in the chat header.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ApiError, getMe, queryKeys } from "@/lib/api";
import {
  selectIsAuthenticated,
  useAuthStore,
} from "@/store/auth";
import { LeftRail } from "@/components/left-rail";
import { ConversationListPane } from "@/components/conversation-list-pane";
import { ChatPane } from "@/components/chat-pane";
import { ChatBottomNav } from "@/components/chat-bottom-nav";
import { useUiStore } from "@/store/ui";

const LG_BREAKPOINT = 1024;

export default function ChatPage() {
  const router = useRouter();
  const hydrated = useAuthStore((s) => s.hydrated);
  const isAuthed = useAuthStore(selectIsAuthenticated);
  const clear = useAuthStore((s) => s.clear);
  const storedUser = useAuthStore((s) => s.user);

  // Reset mobile focus onto the list whenever a conversation deselects
  // (e.g. user logs out, then back in).
  const [mobileFocus, setMobileFocus] = useState<"list" | "chat">("list");
  // The left rail is hidden by default on compact (mobile/tablet)
  // viewports — there's no room for a 68px icon strip. On lg+ the rail
  // is visible by default. The user can still toggle it on either
  // viewport via the hamburger in the list header. We default to
  // `false` because most users hit /chat on a phone first; the
  // matchMedia effect below flips it to `true` if the viewport is
  // already `lg+` on mount. After the user manually toggles, we
  // stop auto-flipping (useRef flag).
  const [railVisible, setRailVisible] = useState(false);
  const railUserOverrodeRef = useRef(false);
  const [isCompact, setIsCompact] = useState(true);
  useEffect(() => {
    setMobileFocus("list");
  }, [hydrated && isAuthed]);

  // Subscribe to the UI store so we can flip mobile focus when the
  // user picks a conversation.
  const selectedId = useUiStore((s) => s.selectedConversationId);
  useEffect(() => {
    if (selectedId !== null) setMobileFocus("chat");
  }, [selectedId]);

  // Track viewport to decide which layout to render. On compact
  // (mobile/tablet) the rail is hidden by default; on lg+ it's shown.
  // Once the user manually toggles, we respect their choice on
  // subsequent viewport changes.
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${LG_BREAKPOINT - 1}px)`);
    const update = () => {
      const compact = mq.matches;
      setIsCompact(compact);
      if (!railUserOverrodeRef.current) {
        setRailVisible(!compact);
      }
      if (compact) {
        setMobileFocus((focus) => (focus === "chat" ? "chat" : "list"));
      }
    };
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // Wrapper that marks the rail as user-overridden so the viewport
  // effect stops auto-flipping it.
  function toggleRailVisible(visible: boolean) {
    railUserOverrodeRef.current = true;
    setRailVisible(visible);
  }

  // Boot-time redirect: if hydration finds no token, send to login.
  useEffect(() => {
    if (hydrated && !isAuthed) {
      router.replace("/auth/phone");
    }
  }, [hydrated, isAuthed, router]);

  const meQuery = useQuery({
    queryKey: queryKeys.me,
    queryFn: getMe,
    enabled: hydrated && isAuthed,
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
      <FullScreenCenter>
        <span className="text-sm text-[var(--color-fg-muted)]">
          Loading…
        </span>
      </FullScreenCenter>
    );
  }
  if (!isAuthed) {
    return (
      <FullScreenCenter>
        <span className="text-sm text-[var(--color-fg-muted)]">
          Redirecting to sign-in…
        </span>
      </FullScreenCenter>
    );
  }

  // Use the live meQuery data when available, fall back to the cached
  // stored user so the greeting still works in dev when the backend
  // isn't reachable.
  void storedUser;

  return (
    <div
      className="flex h-screen w-screen overflow-hidden"
      style={{ backgroundColor: "var(--color-bg-primary)" }}
    >
      {/*
        Left rail: desktop-only. On mobile / tablet the bottom nav
        (<ChatBottomNav />) handles primary navigation, so the rail
        is never rendered there — neither in the flex flow nor as an
        overlay. The list-pane hamburger that would normally toggle
        the rail is therefore unnecessary on mobile; we pass
        `navigationHidden` such that the hamburger doesn't appear.
      */}
      {!isCompact && railVisible ? (
        <div className="relative">
          <LeftRail onHide={() => toggleRailVisible(false)} />
        </div>
      ) : null}

      {/* Mobile visibility: at < 1024px, only the focused pane renders.
          Desktop: both always render side-by-side. Bottom padding
          reserves room for the fixed <ChatBottomNav /> on mobile. */}
      {isCompact ? (
        <div className="flex min-w-0 flex-1 flex-col pb-[calc(56px+env(safe-area-inset-bottom))]">
          {mobileFocus === "list" ? (
            // On mobile the rail is desktop-only, so the rail-toggle
            // hamburger in the list header is redundant — pass
            // `navigationHidden={false}` so the hamburger doesn't
            // appear (the prop's convention: hamburger shows when
            // the rail is hidden, but here the rail is never
            // available on mobile at all).
            <ConversationListPane
              navigationHidden={false}
            />
          ) : (
            <ChatPane
              showBackButton
              onBack={() => setMobileFocus("list")}
            />
          )}
        </div>
      ) : (
        <>
          <ConversationListPane
            navigationHidden={!railVisible}
            onShowNavigation={() => toggleRailVisible(true)}
          />
          <ChatPane />
        </>
      )}

      {/* Mobile bottom nav — fixed, hidden on lg+. Mirrors the
          Signal-Android pattern (Chats / Calls / Stories) plus a
          Settings jump. */}
      <ChatBottomNav />
    </div>
  );
}

function FullScreenCenter({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex h-screen items-center justify-center">
      {children}
    </main>
  );
}