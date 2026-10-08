"use client";

/**
 * Right pane (flex-1): header for the active conversation, scrollable
 * message area, composer pinned at the bottom.
 *
 * Phase 5:
 *   - Read-on-open: when `conversationId` changes, find the latest
 *     message id and POST `/read`. The WS then carries a
 *     `message.read.bulk` to the sender, and we invalidate the
 *     conversation list so the badge clears.
 *   - Typing indicator: subtitle shows "X is typing…" when the
 *     realtime store's `typingByConversation[id]` contains anyone
 *     other than the current user.
 */

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Phone, Search, Video } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "./empty-state";
import { MessageSquareText } from "lucide-react";
import { MessageBubble } from "./message-bubble";
import { Composer } from "./composer";
import { Avatar } from "./avatar";
import {
  getMe,
  listConversations,
  listMessages,
  markRead,
  queryKeys,
  sendMessage,
  type Conversation,
  type Message,
} from "@/lib/api";
import { getQueryClient } from "@/lib/api";
import { useUiStore } from "@/store/ui";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/store/auth";
import { useRealtimeStore } from "@/store/realtime";

interface Props {
  /** On mobile this component is hidden unless conversationId is set. */
  showBackButton?: boolean;
  onBack?: () => void;
}

export function ChatPane({ showBackButton = false, onBack }: Props) {
  const conversationId = useUiStore((s) => s.selectedConversationId);
  const storedUser = useAuthStore((s) => s.user);
  const typingByConversation = useRealtimeStore((s) => s.typingByConversation);
  const presenceByUser = useRealtimeStore((s) => s.presenceByUser);

  // Read-on-open: when a conversation is selected, post /read for the
  // latest message id. This both clears the unread badge via the
  // backend's `message.read.bulk` event and tells the server the user
  // is "caught up" so future sends get a 'read' tick.
  useEffect(() => {
    if (conversationId == null) return;
    const qc = getQueryClient();
    const msgs = qc.getQueryData<Message[]>(queryKeys.messages(conversationId)) ?? [];
    if (msgs.length === 0) return;
    const latestId = msgs.reduce((max, m) => (m.id > max ? m.id : max), 0);
    if (!latestId) return;
    // Fire and forget.
    void markRead(conversationId, latestId)
      .then(() => {
        void qc.invalidateQueries({ queryKey: queryKeys.conversations });
      })
      .catch(() => {
        // If the request fails we still get a graceful read-of-messages
        // when the WS pushes message.read.bulk later.
      });
  }, [conversationId]);

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

  // Phase 5 — the compose path now writes directly to the TanStack
  // Query cache (see composer.tsx). We just keep `extraMessages` as a
  // belt-and-suspenders for callers that need to push a message
  // through `onSend` (e.g. a future Cmd+K send shortcut).
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

  function handleSend(msg: Message) {
    setExtraMessages((prev) => [...prev, msg]);
  }

  // Retry a previously-failed outgoing bubble by re-issuing the POST
  // and replacing the placeholder row in the cache.
  async function retrySend(failedMessage: Message) {
    if (!conversationId) return;
    const qc = getQueryClient();
    const me = meQuery.data ?? storedUser ?? null;
    // Mark it sending again.
    qc.setQueryData<Message[]>(
      queryKeys.messages(conversationId),
      (prev) =>
        prev
          ? prev.map((m) =>
              m.id === failedMessage.id ? { ...m, status: "sending" } : m,
            )
          : prev,
    );
    try {
      const real = await sendMessage(conversationId, {
        content: failedMessage.content,
        type: failedMessage.type,
        parent_id: failedMessage.parent_id,
      });
      qc.setQueryData<Message[]>(
        queryKeys.messages(conversationId),
        (prev) => (prev ? prev.map((m) => (m.id === failedMessage.id ? real : m)) : prev),
      );
      void me; // me is reserved for future per-message sender_id rewrite
    } catch {
      qc.setQueryData<Message[]>(
        queryKeys.messages(conversationId),
        (prev) =>
          prev
            ? prev.map((m) =>
                m.id === failedMessage.id ? { ...m, status: "failed" } : m,
              )
            : prev,
      );
      toast.error("Resend failed");
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
  // Typing indicator: anyone (other than the current user) typing in
  // this conversation. Phase 5 sees at most one name; Phase 6 will
  // need the multi-typer case.
  const typingUsers = (typingByConversation[conversationId] ?? {})
    ? Object.keys(typingByConversation[conversationId] ?? {})
        .map((s) => Number(s))
        .filter((id) => id !== myUserId)
    : [];
  const typingName = typingUsers.length
    ? participantName(conversation, typingUsers[0], myUserId)
    : null;

  // Detect "online" via the realtime presence store, falling back to
  // the cached `last_seen` if the WS hasn't connected yet.
  const otherParticipant = conversation.participants?.find((p) => p.id !== myUserId);
  const otherOnline = otherParticipant
    ? Boolean(presenceByUser[otherParticipant.id])
    : false;

  const displaySubtitle =
    typingName != null
      ? `${typingName} is typing…`
      : conversation.type === "group"
        ? `${countOthers(conversation, myUserId)} members`
        : otherOnline
          ? "online"
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
        subtitle={displaySubtitle}
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
              <li key={String(m.id)}>
                <MessageBubble
                  message={m}
                  isOutgoing={myUserId !== null && m.sender_id === myUserId}
                  showSenderHeader={
                    conversation.type === "group" &&
                    myUserId !== null &&
                    m.sender_id !== myUserId
                  }
                  onRetry={retrySend}
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

/** Look up a participant's display name for the typing indicator. */
function participantName(
  conv: Conversation,
  userId: number,
  myUserId: number | null,
): string {
  const p = conv.participants?.find((x) => x.id === userId);
  if (p) return p.display_name ?? p.phone ?? "Someone";
  if (userId === myUserId) return "You";
  return "Someone";
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
