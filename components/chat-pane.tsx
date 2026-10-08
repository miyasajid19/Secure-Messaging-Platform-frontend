"use client";

/**
 * Right pane (flex-1): header for the active conversation, scrollable
 * message area, composer pinned at the bottom.
 *
 * Phase 4: messages come from `useQuery(['messages', id])`. The
 * conversation metadata (avatar, name, etc.) comes from the
 * `['conversations']` cache that the list pane populated — we don't
 * refetch here.
 *
 * Phase 3's local optimistic-append + simulated `setTimeout`
 * progression are kept verbatim. Phase 5 swaps them for real WS
 * events; that's a small surgical edit.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Phone, Search, Video } from "lucide-react";
import { EmptyState } from "./empty-state";
import { MessageSquareText } from "lucide-react";
import { MessageBubble } from "./message-bubble";
import { Composer } from "./composer";
import { Avatar } from "./avatar";
import {
  type Conversation,
  type Message,
  getMe,
  listConversations,
  listMessages,
  queryKeys,
} from "@/lib/api";
import { useUiStore } from "@/store/ui";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/store/auth";

interface Props {
  /** On mobile this component is hidden unless conversationId is set. */
  showBackButton?: boolean;
  onBack?: () => void;
}

export function ChatPane({ showBackButton = false, onBack }: Props) {
  const conversationId = useUiStore((s) => s.selectedConversationId);
  const storedUser = useAuthStore((s) => s.user);

  // Re-validate the current user via /auth/me so Composer can render
  // optimistic messages with the right `sender` shape. Falls back to
  // the locally stored user if the cache is warm.
  const meQuery = useQuery({
    queryKey: queryKeys.me,
    queryFn: getMe,
    staleTime: 30_000,
    enabled: storedUser !== null,
  });
  const myUserId = meQuery.data?.id ?? storedUser?.id ?? null;

  // Pull the conversation metadata out of the cache the list pane already
  // populated. No refetch needed — TanStack Query dedups.
  const conversationsQuery = useQuery({
    queryKey: queryKeys.conversations,
    queryFn: listConversations,
    staleTime: 10_000,
  });
  const conversation = useMemo(
    () =>
      conversationId
        ? conversationsQuery.data?.find((c) => c.id === conversationId)
        : undefined,
    [conversationId, conversationsQuery.data],
  );

  // Fetch messages for the active conversation.
  const messagesQuery = useQuery({
    queryKey: queryKeys.messages(conversationId),
    queryFn: () => listMessages(conversationId as number),
    enabled: conversationId !== null,
    staleTime: 10_000,
  });

  // Local overlay of pending + optimistic messages. Empty until a
  // conversation is selected.
  const [extraMessages, setExtraMessages] = useState<Message[]>([]);
  useEffect(() => {
    setExtraMessages([]);
  }, [conversationId]);

  const allMessages = useMemo(() => {
    if (!conversationId) return [];
    const fromServer = messagesQuery.data ?? [];
    const local = extraMessages.filter(
      (m) => m.conversation_id === conversationId,
    );
    return [...fromServer, ...local].sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
  }, [conversationId, messagesQuery.data, extraMessages]);

  // Local-only status progression so freshly sent bubbles eventually
  // settle at the "read" tick. Phase 5 will replace this with WS events.
  const progressTimers = useRef<number[]>([]);
  useEffect(() => {
    return () => {
      progressTimers.current.forEach((t) => window.clearTimeout(t));
      progressTimers.current = [];
    };
  }, []);

  function handleSend(msg: Message) {
    setExtraMessages((prev) => [...prev, msg]);
    const steps: Array<["sent" | "delivered" | "read", number]> = [
      ["sent", 700],
      ["delivered", 1600],
      ["read", 3200],
    ];
    for (const [status, ms] of steps) {
      const t = window.setTimeout(() => {
        setExtraMessages((prev) =>
          prev.map((m) => (m.id === msg.id ? { ...m, status } : m)),
        );
      }, ms);
      progressTimers.current.push(t);
    }
  }

  // No conversation selected: empty state.
  if (!conversationId || !conversation) {
    return (
      <section
        className="flex h-full flex-1 flex-col"
        style={{ backgroundColor: "var(--color-bg-primary)" }}
        aria-label="No conversation selected"
      >
        <EmptyState
          icon={MessageSquareText}
          title="Select a conversation to start chatting"
          description="Pick someone from the list on the left to see your messages here."
        />
      </section>
    );
  }

  const headerSubject = headerSubjectFor(conversation, myUserId);
  const subtitle =
    conversation.type === "group"
      ? `${countOthers(conversation, myUserId)} members`
      : headerSubject.last_seen
        ? relativeSeen(headerSubject.last_seen)
        : "last seen recently";

  return (
    <section
      className="flex h-full flex-1 flex-col"
      style={{ backgroundColor: "var(--color-bg-primary)" }}
      aria-label={`Chat with ${conversation.name ?? "conversation"}`}
    >
      <ChatHeader
        headerSubject={headerSubject}
        title={conversation.name ?? "(unnamed)"}
        subtitle={subtitle}
        showBackButton={showBackButton}
        onBack={onBack}
      />

      <div className="flex-1 overflow-y-auto">
        {messagesQuery.isLoading ? (
          <SkeletonBubbles />
        ) : messagesQuery.error ? (
          <ErrorBlock
            message="Couldn't load messages."
            onRetry={() => messagesQuery.refetch()}
          />
        ) : allMessages.length === 0 ? (
          <div className="flex h-full items-center justify-center px-8 text-center text-sm text-[var(--color-fg-muted)]">
            No messages yet — say hi.
          </div>
        ) : (
          <ul className="flex flex-col gap-1 py-4">
            {allMessages.map((m) => (
              <li key={m.id}>
                <MessageBubble
                  message={m}
                  isOutgoing={myUserId !== null && m.sender_id === myUserId}
                  showSenderHeader={
                    conversation.type === "group" &&
                    myUserId !== null &&
                    m.sender_id !== myUserId
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <Composer
        conversationId={conversationId}
        currentUser={meQuery.data ?? null}
        onSend={handleSend}
      />
    </section>
  );
}

function countOthers(conv: Conversation, myUserId: number | null): number {
  if (!conv.participants) return 0;
  const others = conv.participants.filter((p) => p.id !== myUserId);
  return others.length || conv.participants.length;
}

/** Avatar-shaped subject for the chat header. */
type HeaderSubject = {
  avatar_url: string;
  display_name: string;
  last_seen: string | null;
};

/** Header shows the *other* party for direct, a synthetic for group. */
function headerSubjectFor(conv: Conversation, myUserId: number | null): HeaderSubject {
  const other =
    conv.participants?.find((p) => p.id !== myUserId) ?? conv.participants?.[0];
  if (other) {
    return {
      avatar_url: (conv.avatar_url ?? other.avatar_url ?? "") as string,
      display_name: other.display_name ?? other.phone ?? "?",
      last_seen: other.last_seen ?? null,
    };
  }
  return {
    avatar_url: (conv.avatar_url ?? "") as string,
    display_name: conv.name ?? "Unknown",
    last_seen: null,
  };
}

interface ChatHeaderProps {
  headerSubject: HeaderSubject;
  title: string;
  subtitle: string;
  showBackButton: boolean;
  onBack?: () => void;
}

function ChatHeader({
  headerSubject,
  title,
  subtitle,
  showBackButton,
  onBack,
}: ChatHeaderProps) {
  return (
    <header
      className="flex items-center gap-3 border-b px-4 py-3"
      style={{
        borderColor: "var(--color-border-subtle)",
        backgroundColor: "var(--color-bg-primary)",
      }}
    >
      {showBackButton ? (
        <button
          type="button"
          aria-label="Back"
          onClick={onBack}
          className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--color-fg-secondary)] hover:bg-[var(--color-bg-tertiary)]"
        >
          <ArrowLeft size={18} />
        </button>
      ) : null}
      <Avatar subject={headerSubject} size={40} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-base font-semibold text-[var(--color-fg-primary)]">
          {title}
        </span>
        <span className="truncate text-xs text-[var(--color-fg-secondary)]">
          {subtitle}
        </span>
      </div>
      <IconBtn aria-label="Search in conversation">
        <Search size={18} />
      </IconBtn>
      <IconBtn aria-label="Voice call">
        <Phone size={18} />
      </IconBtn>
      <IconBtn aria-label="Video call">
        <Video size={18} />
      </IconBtn>
    </header>
  );
}

function IconBtn({
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--color-fg-secondary)] transition hover:bg-[var(--color-bg-tertiary)]"
    >
      {children}
    </button>
  );
}

function relativeSeen(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "online";
  if (diff < 60 * 60_000) return `last seen ${Math.floor(diff / 60_000)}m ago`;
  if (diff < 24 * 60 * 60_000)
    return `last seen ${Math.floor(diff / 3_600_000)}h ago`;
  return "last seen a while ago";
}

/** 6 alternating left/right skeleton bars — matches the chat pane
 *  layout while the message query is in flight. */
function SkeletonBubbles() {
  return (
    <ul className="flex flex-col gap-1 py-4" aria-busy="true" aria-label="Loading messages">
      {[1, 2, 3, 4, 5, 6].map((i) => {
        const isOut = i % 2 === 0;
        const width = 40 + ((i * 13) % 35);
        return (
          <li
            key={i}
            className={`flex w-full gap-2 px-4 py-1 ${
              isOut ? "flex-row-reverse" : "flex-row"
            }`}
          >
            {!isOut ? <span className="w-7" aria-hidden /> : null}
            <div
              className="h-9 animate-pulse rounded-2xl"
              style={{
                width: `${width}%`,
                backgroundColor: "var(--color-bg-tertiary)",
                borderRadius: 12,
              }}
            />
          </li>
        );
      })}
    </ul>
  );
}

function ErrorBlock({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
      <p className="text-sm" style={{ color: "var(--color-status-error)" }}>
        {message}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="text-sm text-[var(--color-accent)] hover:underline"
      >
        Retry
      </button>
    </div>
  );
}
