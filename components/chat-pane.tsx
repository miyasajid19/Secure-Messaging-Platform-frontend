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

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArrowDown,
  ArrowLeft,
  Ban,
  BellOff,
  CheckCircle2,
  Clock3,
  Images,
  LogOut,
  MessageSquare,
  MoreHorizontal,
  Pin,
  Phone,
  Search,
  Settings,
  Trash2,
  Video,
} from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "./empty-state";
import { MessageSquareText } from "lucide-react";
import { MessageBubble } from "./message-bubble";
import { SystemMessage } from "./system-message";
import { Composer } from "./composer";
import { ConversationAvatar } from "./conversation-avatar";
import { GroupInfoModal } from "./group-info-modal";
import {
  getMe,
  getMessageStatus,
  ApiError,
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
import { useReplyStore } from "@/store/reply";
import { conversationTitle } from "@/lib/conversation-title";

interface Props {
  /** On mobile this component is hidden unless conversationId is set. */
  showBackButton?: boolean;
  onBack?: () => void;
}

/** Retry transient network/server failures for receipt requests. */
async function retryTransient<T>(request: () => Promise<T>): Promise<T> {
  const delays = [250, 750];
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await request();
    } catch (error) {
      const retryable =
        !(error instanceof ApiError) || error.status >= 500;
      if (!retryable || attempt >= delays.length) throw error;
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
  }
}

export function ChatPane({ showBackButton = false, onBack }: Props) {
  const conversationId = useUiStore((s) => s.selectedConversationId);
  const storedUser = useAuthStore((s) => s.user);
  const typingByConversation = useRealtimeStore((s) => s.typingByConversation);
  const presenceByUser = useRealtimeStore((s) => s.presenceByUser);

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

  // Read-on-open must wait for the messages query: on a hard refresh the
  // cache is empty when the conversation id changes, so an effect keyed
  // only on conversationId silently skips the read receipt. Re-run when
  // newer messages arrive while this chat is active as well.
  const latestMessageId = messagesQuery.data?.reduce(
    (latest, message) =>
      Number.isSafeInteger(message.id) ? Math.max(latest, message.id) : latest,
    0,
  ) ?? 0;
  useEffect(() => {
    if (conversationId == null || latestMessageId <= 0) return;
    const qc = getQueryClient();
    let cancelled = false;
    const markLatestRead = () => retryTransient(() => markRead(conversationId, latestMessageId));
    void markLatestRead()
      .then(() => {
        if (!cancelled) void qc.invalidateQueries({ queryKey: queryKeys.conversations });
      })
      .catch(() => {
        // A focus/online event retries this if the first request failed.
      });
    const retryRead = () => {
      void markLatestRead().then(() => {
        if (!cancelled) void qc.invalidateQueries({ queryKey: queryKeys.conversations });
      }).catch(() => {});
    };
    window.addEventListener("focus", retryRead);
    window.addEventListener("online", retryRead);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", retryRead);
      window.removeEventListener("online", retryRead);
    };
  }, [conversationId, latestMessageId]);

  // MessageOut does not contain caller-specific delivery receipts.
  // Hydrate them when this chat's cached timeline changes so old
  // outgoing messages keep the right tick after a refresh/reconnect.
  useEffect(() => {
    if (conversationId == null || !messagesQuery.data?.length) return;
    const ids = messagesQuery.data
      .map((message) => message.id)
      .filter((id) => Number.isSafeInteger(id) && id > 0);
    if (!ids.length) return;
    let cancelled = false;
    const hydrateStatuses = () => retryTransient(() => getMessageStatus(conversationId, ids))
      .then((statuses) => {
        if (cancelled) return;
        const rank = { sending: 0, sent: 1, delivered: 2, read: 3, failed: 4 } as const;
        const qc = getQueryClient();
        qc.setQueryData<Message[]>(queryKeys.messages(conversationId), (prev) => {
          if (!prev) return prev;
          let changed = false;
          const next = prev.map((message) => {
            const status = statuses[String(message.id)];
            if (!status || status === "unknown") return message;
            const currentRank = message.status ? rank[message.status] : -1;
            if (currentRank >= rank[status]) return message;
            changed = true;
            return { ...message, status };
          });
          return changed ? next : prev;
        });
      })
      .catch(() => {
        // Keep rendering the timeline; focus/online will retry hydration.
      });
    const refreshStatuses = () => { void hydrateStatuses(); };
    void hydrateStatuses();
    window.addEventListener("focus", refreshStatuses);
    window.addEventListener("online", refreshStatuses);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", refreshStatuses);
      window.removeEventListener("online", refreshStatuses);
    };
  }, [conversationId, messagesQuery.data]);

  // The compose path writes directly to the TanStack Query cache
  // (see composer.tsx). The React Query cache is the single source
  // of truth for the message list — no separate local-overlay
  // state. (Phase 7 left extraMessages as belt-and-suspenders, but
  // it caused duplicates after the WS `message.new` broadcast
  // returned the canonical message, so it was removed in Phase 8.)
  const extraMessages: Message[] = [];

  const allMessages = useMemo(() => {
    if (!conversationId) return [];
    return (messagesQuery.data ?? []).slice();
  }, [conversationId, messagesQuery.data]);

  // Read receipts are cumulative. Keep each reader's avatar on only
  // the newest outgoing message they've seen, rather than repeating
  // it under every earlier message (for both direct and group chats).
  const lastSeenMessageByUser = useMemo(() => {
    const lastSeen = new Map<number, number>();
    if (myUserId == null) return lastSeen;
    for (const message of allMessages) {
      if (message.sender_id !== myUserId) continue;
      for (const reader of message.seen_by ?? []) {
        const previous = lastSeen.get(reader.id) ?? 0;
        if (message.id > previous) lastSeen.set(reader.id, message.id);
      }
    }
    return lastSeen;
  }, [allMessages, conversation?.type, myUserId]);

  // The composer no longer routes optimistic messages through
  // `onSend`; it writes directly to the React Query cache. The
  // signature is kept for API compatibility with `<Composer>`.
  function handleSend(_msg: Message) {
    /* no-op: composer writes to the React Query cache directly. */
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

  // Group info modal state. Always declared (BEFORE the early-return
  // below) so React's Rules of Hooks are satisfied across the
  // conversationId null ↔ defined transition. We don't conditionally
  // open it; the modal itself ignores the conversation type at render.
  const [groupInfoOpen, setGroupInfoOpen] = useState(false);
  const [chatMenuOpen, setChatMenuOpen] = useState(false);

  // Smart-scroll state (Phase 7 UX follow-up). We track the *id* of
  // the last message so the smart-scroll effect can fire only when a
  // genuinely new message lands (not on every re-render). The
  // `pendingNewCount` is the "you scrolled up — N new messages" pill
  // counter; `scrollRef` is the message list's overflow container.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [pendingNewCount, setPendingNewCount] = useState(0);
  const lastSeenMessageIdRef = useRef<number | null>(null);
  // Phase 8.1 — when the user switches conversations, wipe the
  // reply state so the new conversation doesn't render a stale
  // quoted parent. Declared BEFORE the empty-state early return so
  // Rules of Hooks are satisfied across the conversationId null ↔
  // defined transition.
  const lastConvIdForReply = useRef<number | null>(null);
  useEffect(() => {
    if (lastConvIdForReply.current !== null && lastConvIdForReply.current !== conversationId) {
      useReplyStore.getState().clear();
    }
    lastConvIdForReply.current = conversationId;
  }, [conversationId]);
  // Force-scroll to bottom (e.g. on conversation change, or when the
  // current user sends a message). Bypasses the smart-scroll logic.
  const forceScrollToBottom = useRef(false);

  /**
   * Scroll the message container to its bottom. `smooth` is nice for
   * user-driven scrolls; the call sites that need immediate (jump
   * to bottom on conversation open) pass `{ smooth: false }`.
   */
  function scrollToBottom(opts: { smooth?: boolean } = { smooth: true }) {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({
      top: el.scrollHeight,
      behavior: opts.smooth ? "smooth" : "auto",
    });
  }

  /**
   * "Near bottom" — true when the user is within `THRESHOLD_PX` of
   * the scrollable bottom. The threshold is forgiving because tall
   * bubbles + long messages can make the bottom edge ambiguous.
   */
  const THRESHOLD_PX = 96;
  function isNearBottom(): boolean {
    const el = scrollRef.current;
    if (!el) return true; // optimistic default
    return el.scrollHeight - el.scrollTop - el.clientHeight <= THRESHOLD_PX;
  }

  // When the conversation changes, jump to the bottom. Wait a frame
  // so the new messages have rendered before we measure scrollHeight.
  useEffect(() => {
    if (conversationId == null) return;
    const el = scrollRef.current;
    if (!el) return;
    // Two RAFs: the first lets React commit the new message list,
    // the second runs after the browser has measured the new height.
    const raf1 = requestAnimationFrame(() => {
      const raf2 = requestAnimationFrame(() => {
        forceScrollToBottom.current = true;
        scrollToBottom({ smooth: false });
      });
      // Cancel raf2 if the component unmounts.
      return () => cancelAnimationFrame(raf2);
    });
    // Reset the pending-new counter on conversation switch.
    setPendingNewCount(0);
    lastSeenMessageIdRef.current = null;
    return () => cancelAnimationFrame(raf1);
  }, [conversationId]);

  // When a new message arrives, decide whether to auto-scroll or
  // surface the "N new messages" pill. Depends on the latest
  // message id and on the current user (senders always scroll).
  useEffect(() => {
    if (allMessages.length === 0) return;
    const latest = allMessages[allMessages.length - 1];
    if (latest.id === lastSeenMessageIdRef.current) return; // no new msg

    if (forceScrollToBottom.current) {
      // Either initial mount or the user just sent. Auto-scroll.
      forceScrollToBottom.current = false;
      lastSeenMessageIdRef.current = latest.id;
      requestAnimationFrame(() => scrollToBottom({ smooth: false }));
      return;
    }

    const isMine = myUserId != null && latest.sender_id === myUserId;
    if (isMine || isNearBottom()) {
      // Sender, or user is already at the bottom — auto-scroll.
      lastSeenMessageIdRef.current = latest.id;
      setPendingNewCount(0);
      requestAnimationFrame(() => scrollToBottom({ smooth: isMine }));
    } else {
      // User is scrolled up. Show the pill.
      lastSeenMessageIdRef.current = latest.id;
      setPendingNewCount((n) => n + 1);
    }
  }, [allMessages, myUserId]);

  // Manual scroll listener — when the user scrolls back to (or
  // past) the bottom, clear the "N new messages" pill. Also clears
  // the `forceScrollToBottom` flag, because once the user has
  // scrolled away from the bottom, the next incoming message should
  // be treated as off-screen (i.e. surface the pill) rather than
  // auto-scrolled because of the stale flag.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    function onScroll() {
      if (isNearBottom()) {
        setPendingNewCount(0);
      } else {
        forceScrollToBottom.current = false;
      }
    }
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // No conversation selected (or conversations list still loading):
  // render the empty state. Declared BEFORE any `conv.*` access so we
  // don't reach for `.participants` on `undefined`.
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

  // TS can't narrow `conversation` past the early-return above,
  // so assert it's defined here. The early-return already handles the
  // null case at runtime.
  const conv = conversation as Conversation;
  const cid = conversationId as number;

  const headerSubject = headerSubjectFor(conv, myUserId);
  // Typing indicator for both direct and group conversations. For
  // groups we render multi-typer text per spec §5.
  const typingRaw = typingByConversation[cid] ?? {};
  const typingUserIds = Object.keys(typingRaw)
    .map((s) => Number(s))
    .filter((id) => id !== myUserId);
  const typingNames = typingUserIds.map((id) =>
    participantName(conv, id, myUserId),
  );
  const typingLabel = typingNames.length
    ? typingNames.length === 1
      ? `${typingNames[0]} is typing…`
      : typingNames.length === 2
        ? `${typingNames[0]} and ${typingNames[1]} are typing…`
        : `${typingNames.length} people are typing…`
    : null;

  const otherParticipant =
    conv.participants?.find((p) => p.id !== myUserId) ?? null;
  const otherOnline = otherParticipant
    ? Boolean(presenceByUser[otherParticipant.id])
    : false;

  const memberCount = countOthers(conv, myUserId);
  const memberNames = (conv.participants ?? [])
    .filter((p) => p.id !== myUserId)
    .slice(0, 3)
    .map((p) => p.display_name ?? p.phone ?? "?");

  const displaySubtitle =
    typingLabel != null
      ? typingLabel
      : conv.type === "group"
        ? `${memberNames.join(", ")}${memberNames.length > 0 ? " · " : ""}${memberCount} members`
        : otherOnline
          ? "online"
          : headerSubject.last_seen
            ? relativeSeen(headerSubject.last_seen)
            : "last seen recently";

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

  // REACHED HERE ONLY when conversationId AND conversation are both
  // non-null. Render the chat shell.

  return (
    <section
      className="flex h-full flex-1 flex-col"
      style={{ backgroundColor: "var(--color-bg-primary)" }}
      aria-label={`Chat with ${conversationTitle(conv, myUserId)}`}
    >
      <ChatHeader
        headerSubject={headerSubject}
        title={conversationTitle(conv, myUserId)}
        subtitle={displaySubtitle}
        showBackButton={showBackButton}
        onBack={onBack}
        onTitleClick={() => setGroupInfoOpen(true)}
        isGroup={conv.type === "group"}
        menuOpen={chatMenuOpen}
        onMenuToggle={() => setChatMenuOpen((open) => !open)}
        onMenuClose={() => setChatMenuOpen(false)}
        onGroupSettings={() => { setChatMenuOpen(false); setGroupInfoOpen(true); }}
      />

      <div
        ref={scrollRef}
        className="relative flex-1 overflow-y-auto"
        aria-label="Messages"
      >
        {pendingNewCount > 0 ? (
          <button
            type="button"
            onClick={() => {
              // Click means "I want to read the latest now" — clear
              // the counter immediately and snap to the bottom.
              // Don't rely on the scroll listener to clear it, since
              // smooth scrolling would leave the pill visible for the
              // ~150ms duration of the animation.
              setPendingNewCount(0);
              forceScrollToBottom.current = true;
              scrollToBottom({ smooth: true });
            }}
            aria-label={`${pendingNewCount} new ${pendingNewCount === 1 ? "message" : "messages"}. Click to jump to latest.`}
            className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold shadow-lg transition hover:opacity-90"
            style={{
              backgroundColor: "var(--color-accent)",
              color: "var(--color-accent-fg)",
            }}
          >
            <ArrowDown size={14} aria-hidden />
            {pendingNewCount} new {pendingNewCount === 1 ? "message" : "messages"}
          </button>
        ) : null}

        {conv.type === "group" ? (
          <GroupIntroCard
            conversation={conv}
            memberCount={(conv.participants ?? []).filter((person) => person.id !== myUserId).length}
            onOpen={() => setGroupInfoOpen(true)}
          />
        ) : null}

        {messagesQuery.isLoading ? (
          <SkeletonBubbles />
        ) : messagesQuery.error ? (
          <ErrorBlock
            message="Couldn't load messages."
            onRetry={() => messagesQuery.refetch()}
          />
        ) : allMessages.length === 0 ? (
          <div className="flex h-full items-center justify-center px-8 text-center text-sm text-[var(--color-fg-muted)]">
            No messages yet — say hi to start the conversation.
          </div>
        ) : (
          <ul className="flex flex-col gap-1 py-4">
            {allMessages.map((m) => (
              <li key={String(m.id)}>
                {m.type === "system" ? (
                  <SystemMessage message={m} />
                ) : (
                  <MessageBubble
                    message={m}
                    seenBy={
                      myUserId !== null && m.sender_id === myUserId
                        ? (m.seen_by ?? []).filter(
                            (reader) => lastSeenMessageByUser.get(reader.id) === m.id,
                          )
                        : m.seen_by
                    }
                    isOutgoing={myUserId !== null && m.sender_id === myUserId}
                    showSenderHeader={
                      conv.type === "group" &&
                      myUserId !== null &&
                      m.sender_id !== myUserId
                    }
                    onRetry={retrySend}
                    isGroup={conv.type === "group"}
                    recipientOnline={conv.type === "direct" && otherOnline}
                    parent={
                      m.parent_id != null
                        ? (allMessages.find((x) => x.id === m.parent_id) ?? null)
                        : null
                    }
                    currentUserId={myUserId}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <Composer
        conversationId={cid}
        currentUser={meQuery.data ?? null}
        onSend={handleSend}
      />

      <GroupInfoModal
        open={groupInfoOpen}
        onClose={() => setGroupInfoOpen(false)}
        conversation={conv}
        currentUserId={myUserId}
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
  is_group: boolean;
};

/** Header shows the *other* party for direct, a synthetic for group. */
function headerSubjectFor(conv: Conversation, myUserId: number | null): HeaderSubject {
  if (conv.type === "group") {
    return {
      avatar_url: conv.avatar_url ?? "",
      display_name: conv.name ?? "Group",
      last_seen: null,
      is_group: true,
    };
  }
  const other =
    conv.participants?.find((p) => p.id !== myUserId) ?? conv.participants?.[0];
  if (other) {
    return {
      avatar_url: (conv.avatar_url ?? other.avatar_url ?? "") as string,
      display_name: other.display_name ?? other.phone ?? "?",
      last_seen: other.last_seen ?? null,
      is_group: false,
    };
  }
  return {
    avatar_url: (conv.avatar_url ?? "") as string,
    display_name: conv.name ?? "Unknown",
    last_seen: null,
    is_group: false,
  };
}

interface ChatHeaderProps {
  headerSubject: HeaderSubject;
  title: string;
  subtitle: string;
  showBackButton: boolean;
  onBack?: () => void;
  onTitleClick?: () => void;
  isGroup: boolean;
  menuOpen: boolean;
  onMenuToggle: () => void;
  onMenuClose: () => void;
  onGroupSettings: () => void;
}

function ChatHeader({
  headerSubject,
  title,
  subtitle,
  showBackButton,
  onBack,
  onTitleClick,
  isGroup,
  menuOpen,
  onMenuToggle,
  onMenuClose,
  onGroupSettings,
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
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[var(--color-fg-secondary)] hover:bg-[var(--color-bg-tertiary)] active:bg-[var(--color-bg-tertiary)]"
        >
          <ArrowLeft size={20} />
        </button>
      ) : null}
      <ConversationAvatar
        avatarUrl={headerSubject.avatar_url}
        displayName={headerSubject.display_name}
        isGroup={headerSubject.is_group}
        size={40}
      />
      <button
        type="button"
        onClick={onTitleClick}
        className={`flex min-w-0 flex-1 flex-col text-left ${
          onTitleClick ? "cursor-pointer hover:underline" : "cursor-default"
        }`}
          aria-label={onTitleClick ? "Open conversation info" : undefined}
      >
        <span className="truncate text-base font-semibold text-[var(--color-fg-primary)]">
          {title}
        </span>
        <span className="truncate text-xs text-[var(--color-fg-secondary)]">
          {subtitle}
        </span>
      </button>
      <IconBtn
        aria-label="Voice call"
        title="Voice calls — coming soon"
        onClick={() => toast.info("Voice calls — coming soon")}
        className="hidden sm:flex"
      >
        <Phone size={18} />
      </IconBtn>
      <IconBtn
        aria-label="Video call"
        title="Video calls — coming soon"
        onClick={() => toast.info("Video calls — coming soon")}
        className="hidden sm:flex"
      >
        <Video size={18} />
      </IconBtn>
      <IconBtn aria-label="Search in conversation" onClick={() => toast.info("Search in chat — coming soon")} className="hidden sm:flex">
        <Search size={18} />
      </IconBtn>
      <div className="relative">
        <IconBtn
          aria-label="Chat options"
          title="Chat options"
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          onClick={onMenuToggle}
        >
          <MoreHorizontal size={19} />
        </IconBtn>
        {menuOpen ? <ChatOptionsMenu isGroup={isGroup} onClose={onMenuClose} onGroupSettings={onGroupSettings} /> : null}
      </div>
    </header>
  );
}

function ChatOptionsMenu({ isGroup, onClose, onGroupSettings }: { isGroup: boolean; onClose: () => void; onGroupSettings: () => void }) {
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  const comingSoon = (label: string) => {
    onClose();
    toast.info(`${label} — coming soon`);
  };

  const items = [
    { label: "Disappearing messages", icon: <Clock3 size={15} />, action: onGroupSettings, arrow: true },
    { label: "Mute notifications", icon: <BellOff size={15} />, action: () => comingSoon("Mute notifications"), arrow: true },
    ...(isGroup ? [{ label: "Group settings", icon: <Settings size={15} />, action: onGroupSettings, arrow: false }] : []),
    { label: "All media", icon: <Images size={15} />, action: () => comingSoon("All media"), arrow: false },
    { label: "Select messages", icon: <CheckCircle2 size={15} />, action: () => comingSoon("Select messages"), dividerBefore: true },
    { label: "Mark as unread", icon: <MessageSquare size={15} />, action: () => comingSoon("Mark as unread"), dividerBefore: true },
    { label: "Pin chat", icon: <Pin size={15} />, action: () => comingSoon("Pin chat") },
    { label: "Archive", icon: <Archive size={15} />, action: () => comingSoon("Archive") },
    { label: "Block", icon: <Ban size={15} />, action: () => comingSoon("Block") },
    { label: "Delete", icon: <Trash2 size={15} />, action: () => comingSoon("Delete") },
    ...(isGroup ? [{ label: "Leave group", icon: <LogOut size={15} />, action: () => comingSoon("Leave group") }] : []),
  ];

  return (
    <div ref={menuRef} role="menu" aria-label="Chat options" className="absolute right-0 top-full z-40 mt-4 w-60 overflow-hidden rounded-xl border bg-[var(--color-bg-elevated)] p-1.5 shadow-xl" style={{ borderColor: "var(--color-border-subtle)" }}>
      {items.map((item, index) => (
        <div key={item.label}>
          {"dividerBefore" in item && item.dividerBefore ? <div className="mx-2 my-1 h-px" style={{ backgroundColor: "var(--color-border-subtle)" }} /> : null}
          <button type="button" role="menuitem" onClick={item.action} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-[var(--color-fg-primary)] transition hover:bg-[var(--color-bg-tertiary)]">
            <span className="text-[var(--color-fg-secondary)]">{item.icon}</span>
            <span className="min-w-0 flex-1">{item.label}</span>
            {"arrow" in item && item.arrow ? <span aria-hidden className="text-[var(--color-fg-muted)]">›</span> : null}
          </button>
        </div>
      ))}
    </div>
  );
}

function GroupIntroCard({ conversation, memberCount, onOpen }: { conversation: Conversation; memberCount: number; onOpen: () => void }) {
  return (
    <div className="flex justify-center px-4 pb-3 pt-8">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-[220px] max-w-[min(100%,340px)] flex-col items-center rounded-[28px] border px-8 pb-5 pt-0 text-center transition hover:bg-[var(--color-bg-secondary)]"
        style={{ borderColor: "var(--color-border-subtle)" }}
      >
        <span className="-mt-5 mb-2 rounded-full ring-4 ring-[var(--color-bg-primary)]">
          <ConversationAvatar avatarUrl={conversation.avatar_url} displayName={conversation.name ?? "Group"} isGroup size={64} />
        </span>
        <span className="max-w-full truncate text-base font-semibold text-[var(--color-fg-primary)]">{conversation.name ?? "Group"}</span>
        <span className="mt-1 text-xs text-[var(--color-fg-secondary)]">
          {memberCount === 0 ? "No other group members yet" : `${memberCount} ${memberCount === 1 ? "member" : "members"}`}
        </span>
      </button>
    </div>
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
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[var(--color-fg-secondary)] transition hover:bg-[var(--color-bg-tertiary)] active:bg-[var(--color-bg-tertiary)]"
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
