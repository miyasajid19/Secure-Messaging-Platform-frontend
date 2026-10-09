"use client";

/**
 * Phase 9.5 — authenticated chat shell, now at `/chat`.
 *
 * History: this lived at `/` (app/page.tsx) from Phase 3 onward. As of
 * Phase 9.5 the public landing page owns `/`, so the chat shell moves to
 * `/chat`. Auth redirects in `/auth/otp` and `/onboarding` are updated
 * to push users here after sign-in. The auth-guard below redirects
 * unauthenticated visitors to `/auth/phone`.
 *
 * Structure:
 *   <auth guard + getMe>
 *     <h-full grid>
 *       <LeftRail />                       ← 60-68px icon nav
 *       <ConversationListPane />           ← 320px list (hidden < 1024 when chat is open)
 *       <ChatPane />                       ← flex-1 chat
 *
 * Collapse rule: on screens narrower than 1024px we toggle between list
 * and chat via the `mobileFocus` state. The "back" button on the chat
 * header returns the user to the list.
 */

import { useEffect, useState } from "react";
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
import { useUiStore } from "@/store/ui";

const MOBILE_BREAKPOINT = 1024;

export default function ChatPage() {
  const router = useRouter();
  const hydrated = useAuthStore((s) => s.hydrated);
  const isAuthed = useAuthStore(selectIsAuthenticated);
  const clear = useAuthStore((s) => s.clear);
  const storedUser = useAuthStore((s) => s.user);

  // Reset mobile focus onto the list whenever a conversation deselects
  // (e.g. user logs out, then back in).
  const [mobileFocus, setMobileFocus] = useState<"list" | "chat">("list");
  const [railVisible, setRailVisible] = useState(true);
  useEffect(() => {
    setMobileFocus("list");
  }, [hydrated && isAuthed]);

  // Subscribe to the UI store so we can flip mobile focus when the
  // user picks a conversation.
  const selectedId = useUiStore((s) => s.selectedConversationId);
  useEffect(() => {
    if (selectedId !== null) setMobileFocus("chat");
  }, [selectedId]);

  // Track viewport to decide whether mobile single-pane view applies.
  const [isCompact, setIsCompact] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const update = () => setIsCompact(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

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
      {railVisible ? <LeftRail onHide={() => setRailVisible(false)} /> : null}

      {/* Mobile visibility: at < 1024px, only the focused pane renders.
          Desktop: both always render side-by-side. */}
      {isCompact ? (
        mobileFocus === "list" ? (
          <ConversationListPane
            navigationHidden={!railVisible}
            onShowNavigation={() => setRailVisible(true)}
          />
        ) : (
          <ChatPane
            showBackButton
            onBack={() => setMobileFocus("list")}
          />
        )
      ) : (
        <>
          <ConversationListPane
            navigationHidden={!railVisible}
            onShowNavigation={() => setRailVisible(true)}
          />
          <ChatPane />
        </>
      )}
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