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
  UserPlus,
  Video,
  X,
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
  searchMessages,
  getMessageContext,
  leaveGroup,
  markRead,
  queryKeys,
  sendMessage,
  type Conversation,
  type Message,
  blockUser,
  deleteConversationForMe,
  hideMessageForMe,
  listConversationMedia,
  updateConversationActions,
  unblockUser,
} from "@/lib/api";
import { getQueryClient } from "@/lib/api";
import { useUiStore } from "@/store/ui";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/store/auth";
import { useRealtimeStore } from "@/store/realtime";
import { useReplyStore } from "@/store/reply";
import { conversationTitle } from "@/lib/conversation-title";
import { useVoiceCall } from "@/components/voice-call-provider";

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

function outgoingReadersForMessage(
  message: Message,
  conversation: Conversation,
): Conversation["participants"] {
  // A read receipt belongs to a recipient, never the message's sender.
  const readers = (message.seen_by ?? []).filter(
    (reader) => reader.id !== message.sender_id,
  );
  if (readers.length > 0 || message.status !== "read" || conversation.type !== "direct") {
    return readers;
  }

  // The status endpoint is authoritative for direct chats. If an older
  // backend response has a missing/incorrect seen_by list, the other
  // participant is the only possible reader.
  const recipient = conversation.participants.find(
    (participant) => participant.id !== message.sender_id,
  );
  return recipient ? [recipient] : readers;
}

export function ChatPane({ showBackButton = false, onBack }: Props) {
  const { startCall, startGroupCall, joinGroupCall, reinviteGroupCall } = useVoiceCall();
  const conversationId = useUiStore((s) => s.selectedConversationId);
  const setSelectedConversation = useUiStore((s) => s.setSelected);
  const storedUser = useAuthStore((s) => s.user);
  const typingByConversation = useRealtimeStore((s) => s.typingByConversation);
  const presenceByUser = useRealtimeStore((s) => s.presenceByUser);
  const activeGroupCall = useRealtimeStore((s) => conversationId == null ? undefined : s.activeGroupCalls[conversationId]);

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
    queryFn: () => listConversations(),
    staleTime: 10_000,
  });
  const conversation = useMemo(
    () =>
      conversationId
        ? conversationsQuery.data?.find((c) => c.id === conversationId)
        : undefined,
    [conversationId, conversationsQuery.data],
  );
  const groupCallInviteCandidates = conversation?.type === "group" && activeGroupCall && myUserId != null
    && activeGroupCall.participants.some((participant) => participant.id === myUserId)
    ? conversation.participants
      .filter((participant) => participant.id !== myUserId && !activeGroupCall.participants.some((active) => active.id === participant.id))
      .map((participant) => ({ id: participant.id, name: participant.display_name ?? participant.username ?? participant.phone ?? "Signal user" }))
    : [];

  // Fetch messages for the active conversation.
  const messagesQuery = useQuery({
    queryKey: queryKeys.messages(conversationId),
    queryFn: () => listMessages(conversationId as number),
    enabled: conversationId !== null,
    staleTime: 10_000,
  });
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Message[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [viewingSearchResult, setViewingSearchResult] = useState(false);
  const [jumpMessageId, setJumpMessageId] = useState<number | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<number | null>(null);
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<number>>(() => new Set());
  const [mediaOpen, setMediaOpen] = useState(false);
  const mediaQuery = useQuery({
    queryKey: ["conversation-media", conversationId],
    queryFn: () => listConversationMedia(conversationId as number),
    enabled: mediaOpen && conversationId != null,
    staleTime: 30_000,
  });

  useEffect(() => {
    let cancelled = false;
    const query = searchQuery.trim();
    setSearchError(null);
    if (!searchOpen || conversationId == null || query.length < 2) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    const timer = window.setTimeout(() => {
      void searchMessages(conversationId, query)
        .then((results) => { if (!cancelled) setSearchResults(results); })
        .catch(() => { if (!cancelled) { setSearchResults([]); setSearchError("Search couldn't be completed. Try again."); } })
        .finally(() => { if (!cancelled) setSearchLoading(false); });
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [conversationId, searchOpen, searchQuery]);

  useEffect(() => {
    setSearchOpen(false);
    setSearchQuery("");
    setViewingSearchResult(false);
    setSelectedMessageIds(new Set());
    setMediaOpen(false);
    setSelectionMode(false);
  }, [conversationId]);

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
      const readers = conversation
        ? outgoingReadersForMessage(message, conversation)
        : (message.seen_by ?? []).filter((reader) => reader.id !== message.sender_id);
      for (const reader of readers) {
        const previous = lastSeen.get(reader.id) ?? 0;
        if (message.id > previous) lastSeen.set(reader.id, message.id);
      }
    }
    return lastSeen;
  }, [allMessages, conversation, myUserId]);

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
  const [selectionMode, setSelectionMode] = useState(false);

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

  useEffect(() => {
    if (jumpMessageId == null) return;
    const frame = requestAnimationFrame(() => {
      const target = scrollRef.current?.querySelector<HTMLElement>(`[data-message-id="${jumpMessageId}"]`);
      target?.scrollIntoView({ block: "center", behavior: "smooth" });
      setHighlightedMessageId(jumpMessageId);
      setJumpMessageId(null);
      window.setTimeout(() => setHighlightedMessageId((current) => current === jumpMessageId ? null : current), 1800);
    });
    return () => cancelAnimationFrame(frame);
  }, [allMessages, jumpMessageId]);

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

  async function jumpToSearchResult(message: Message) {
    if (conversationId == null) return;
    try {
      const context = await getMessageContext(conversationId, message.id);
      getQueryClient().setQueryData<Message[]>(queryKeys.messages(conversationId), context);
      setViewingSearchResult(true);
      setSearchOpen(false);
      setJumpMessageId(message.id);
    } catch {
      toast.error("Couldn't open that message. It may have expired or been deleted.");
    }
  }

  async function returnToLatestMessages() {
    setViewingSearchResult(false);
    setPendingNewCount(0);
    await messagesQuery.refetch();
    requestAnimationFrame(() => requestAnimationFrame(() => scrollToBottom({ smooth: false })));
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

  async function handleLeaveGroup() {
    setChatMenuOpen(false);
    if (!window.confirm(`Leave “${conv.name ?? "this group"}”?`)) return;
    try {
      await leaveGroup(conv.id);
      toast.success("Left group");
      setSelectedConversation(null);
      await getQueryClient().invalidateQueries({ queryKey: queryKeys.conversations });
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Couldn't leave group");
      await getQueryClient().invalidateQueries({ queryKey: queryKeys.conversations });
    }
  }

  async function saveConversationAction(actions: { muted?: boolean; pinned?: boolean; archived?: boolean; marked_unread?: boolean }) {
    setChatMenuOpen(false);
    try {
      await updateConversationActions(cid, actions);
      await getQueryClient().invalidateQueries({ queryKey: queryKeys.conversations });
      if (actions.archived !== undefined || actions.marked_unread) setSelectedConversation(null);
      if (actions.muted !== undefined) toast.success(actions.muted ? "Chat muted" : "Chat unmuted");
      if (actions.pinned !== undefined) toast.success(actions.pinned ? "Chat pinned" : "Chat unpinned");
      if (actions.archived !== undefined) toast.success(actions.archived ? "Chat archived" : "Chat unarchived");
      if (actions.marked_unread) toast.success("Marked as unread");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Couldn't update chat");
    }
  }

  async function handleDeleteChat() {
    setChatMenuOpen(false);
    if (!window.confirm("Delete this chat from your conversation list? Messages remain visible to other participants.")) return;
    try {
      await deleteConversationForMe(cid);
      setSelectedConversation(null);
      await getQueryClient().invalidateQueries({ queryKey: queryKeys.conversations });
      toast.success("Chat deleted for you");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Couldn't delete chat");
    }
  }

  async function handleBlock() {
    if (!otherParticipant) return;
    setChatMenuOpen(false);
    const name = otherParticipant.display_name ?? otherParticipant.username ?? otherParticipant.phone ?? "this person";
    try {
      if (conv.blocked_by_me) {
        if (!window.confirm(`Unblock ${name}?`)) return;
        await unblockUser(otherParticipant.id);
        toast.success(`${name} unblocked`);
      } else {
        if (!window.confirm(`Block ${name}? Neither of you will be able to send messages in this chat.`)) return;
        await blockUser(otherParticipant.id);
        setSelectedConversation(null);
        toast.success(`${name} blocked`);
      }
      await getQueryClient().invalidateQueries({ queryKey: queryKeys.conversations });
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Couldn't block this person");
    }
  }

  async function deleteSelectedForMe() {
    const ids = [...selectedMessageIds];
    if (!ids.length) return;
    try {
      await Promise.all(ids.map((id) => hideMessageForMe(id)));
      getQueryClient().setQueryData<Message[]>(queryKeys.messages(cid), (previous) => previous?.filter((message) => !selectedMessageIds.has(message.id)));
      setSelectedMessageIds(new Set());
      toast.success(`${ids.length} message${ids.length === 1 ? "" : "s"} deleted for you`);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Couldn't delete selected messages");
      void getQueryClient().invalidateQueries({ queryKey: queryKeys.messages(cid) });
    }
  }

  return (
    <section
      className="flex h-full min-w-0 flex-1 flex-col overflow-hidden"
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
        onLeaveGroup={handleLeaveGroup}
        muted={!!conv.muted}
        pinned={!!conv.pinned}
        archived={!!conv.archived}
        blockedByMe={!!conv.blocked_by_me}
        onToggleMute={() => void saveConversationAction({ muted: !conv.muted })}
        onOpenMedia={() => { setChatMenuOpen(false); setMediaOpen(true); }}
        onSelectMessages={() => { setChatMenuOpen(false); setSelectedMessageIds(new Set()); setSelectionMode((value) => !value); }}
        onMarkUnread={() => void saveConversationAction({ marked_unread: true })}
        onTogglePin={() => void saveConversationAction({ pinned: !conv.pinned })}
        onToggleArchive={() => void saveConversationAction({ archived: !conv.archived })}
        onBlock={() => void handleBlock()}
        onDeleteChat={() => void handleDeleteChat()}
        canVoiceCall={conv.type === "direct" && !!otherParticipant}
        canGroupCall={conv.type === "group" && conv.participants.length > 1}
        onGroupAudioCall={() => void startGroupCall(cid, conv.name ?? "Group call", conv.avatar_url ?? null, conv.participants.map((participant) => ({ id: participant.id, displayName: participant.display_name ?? participant.username ?? participant.phone ?? "Signal user", avatarUrl: participant.avatar_url })), "audio")}
        onGroupVideoCall={() => void startGroupCall(cid, conv.name ?? "Group call", conv.avatar_url ?? null, conv.participants.map((participant) => ({ id: participant.id, displayName: participant.display_name ?? participant.username ?? participant.phone ?? "Signal user", avatarUrl: participant.avatar_url })), "video")}
        showJoinGroupCall={conv.type === "group" && !!activeGroupCall && !activeGroupCall.participants.some((participant) => participant.id === myUserId)}
        onJoinGroupCall={() => { if (activeGroupCall) void joinGroupCall(activeGroupCall, conv.avatar_url); }}
        groupCallInviteCandidates={groupCallInviteCandidates}
        onInviteGroupCallMember={(userId) => { if (activeGroupCall) reinviteGroupCall(activeGroupCall, userId); }}
        onSearchClick={() => { setSearchOpen((open) => !open); setSearchQuery(""); }}
        onVoiceCall={() => {
          if (!otherParticipant) return;
          void startCall(
            cid,
            otherParticipant.id,
            otherParticipant.display_name ?? otherParticipant.username ?? otherParticipant.phone ?? "Signal user",
            otherParticipant.avatar_url,
          );
        }}
        onVideoCall={() => {
          if (!otherParticipant) return;
          void startCall(
            cid,
            otherParticipant.id,
            otherParticipant.display_name ?? otherParticipant.username ?? otherParticipant.phone ?? "Signal user",
            otherParticipant.avatar_url,
            "video",
          );
        }}
      />

      {searchOpen ? <section className="z-20 border-b px-3 py-3 sm:px-4" style={{ backgroundColor: "var(--color-bg-primary)", borderColor: "var(--color-border-subtle)" }} aria-label="Search messages">
        <div className="flex items-center gap-2 rounded-xl border px-3" style={{ borderColor: "var(--color-border-subtle)", backgroundColor: "var(--color-bg-secondary)" }}>
          <Search size={17} className="shrink-0 text-[var(--color-fg-muted)]" />
          <input autoFocus value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setSearchOpen(false); }} placeholder="Search messages in this chat" aria-label="Search messages in this chat" className="h-11 min-w-0 flex-1 bg-transparent text-sm text-[var(--color-fg-primary)] outline-none placeholder:text-[var(--color-fg-muted)]" />
          {searchLoading ? <span className="text-xs text-[var(--color-fg-muted)]">Searching…</span> : null}
          <button type="button" onClick={() => setSearchOpen(false)} aria-label="Close search" className="rounded-lg p-1.5 text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-tertiary)]"><X size={17} /></button>
        </div>
        {searchQuery.trim().length < 2 ? <p className="px-2 pt-2 text-xs text-[var(--color-fg-muted)]">Enter at least 2 characters.</p> : searchError ? <p role="alert" className="px-2 pt-2 text-xs text-[var(--color-status-error)]">{searchError}</p> : !searchLoading && searchResults.length === 0 ? <p className="px-2 pt-2 text-xs text-[var(--color-fg-muted)]">No matching messages.</p> : searchResults.length ? <ul className="mt-2 max-h-64 overflow-y-auto">
          {searchResults.map((result) => <li key={result.id}><button type="button" onClick={() => void jumpToSearchResult(result)} className="w-full rounded-lg px-3 py-2 text-left transition hover:bg-[var(--color-bg-tertiary)]">
            <span className="flex items-center justify-between gap-3 text-xs text-[var(--color-fg-secondary)]"><span className="truncate font-medium">{result.sender.display_name ?? result.sender.username ?? result.sender.phone ?? "Signal user"}</span><time dateTime={result.created_at}>{new Date(result.created_at).toLocaleString()}</time></span>
            <span className="mt-1 block truncate text-sm text-[var(--color-fg-primary)]">{result.content || (result.attachments.length ? "Attachment" : "Message")}</span>
          </button></li>)}
        </ul> : null}
      </section> : null}

      {selectionMode ? <div className="flex items-center gap-2 border-b px-3 py-2" style={{ borderColor: "var(--color-border-subtle)" }}>
        <span className="flex-1 text-sm font-medium text-[var(--color-fg-primary)]">{selectedMessageIds.size} selected</span>
        <button type="button" disabled={!selectedMessageIds.size} onClick={() => void deleteSelectedForMe()} className="rounded-lg px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-500/10 disabled:opacity-40">Delete for me</button>
        <button type="button" onClick={() => { setSelectionMode(false); setSelectedMessageIds(new Set()); }} className="rounded-lg px-3 py-2 text-sm text-[var(--color-fg-secondary)] hover:bg-[var(--color-bg-tertiary)]">Cancel</button>
      </div> : null}

      <div
        ref={scrollRef}
        className="relative min-w-0 flex-1 overflow-x-hidden overflow-y-auto"
        aria-label="Messages"
      >
        {viewingSearchResult ? <div className="sticky top-2 z-10 flex justify-center px-3">
          <button type="button" onClick={() => void returnToLatestMessages()} className="rounded-full border px-3 py-1.5 text-xs font-semibold shadow-md" style={{ backgroundColor: "var(--color-bg-primary)", color: "var(--color-fg-primary)", borderColor: "var(--color-border-subtle)" }}>Back to latest messages</button>
        </div> : null}
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
          <ul className="flex min-w-0 flex-col gap-1 overflow-x-hidden py-4">
            {allMessages.map((m) => (
              <li key={m.client_id ?? (Number.isSafeInteger(m.id) ? String(m.id) : `pending-${m.sender_id}-${m.created_at}`)} data-message-id={Number.isSafeInteger(m.id) ? String(m.id) : undefined} className={`flex items-center rounded-xl transition-colors duration-500 ${highlightedMessageId === m.id ? "bg-[var(--color-accent)]/10 ring-2 ring-[var(--color-accent)]/50" : ""}`}>
                {selectionMode && m.type !== "system" && Number.isSafeInteger(m.id) ? <input type="checkbox" aria-label={`Select message from ${m.sender.display_name ?? "user"}`} checked={selectedMessageIds.has(m.id)} onChange={() => setSelectedMessageIds((current) => { const next = new Set(current); if (next.has(m.id)) next.delete(m.id); else next.add(m.id); return next; })} className="ml-3 h-4 w-4 shrink-0 accent-[var(--color-accent)]" /> : null}
                {m.type === "system" ? (
                  <SystemMessage message={m} />
                ) : (
                  <MessageBubble
                    message={m}
                    seenBy={
                      myUserId !== null && m.sender_id === myUserId
                        ? outgoingReadersForMessage(m, conv).filter(
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

      {conv.type === "direct" && (conv.blocked_by_me || conv.blocked_me) ? <div className="border-t px-4 py-4 text-center text-sm text-[var(--color-fg-muted)]" style={{ borderColor: "var(--color-border-subtle)" }}>
        {conv.blocked_by_me ? "You blocked this person. Messages are disabled." : "You can’t send messages in this chat."}
      </div> : <Composer
        conversationId={cid}
        currentUser={meQuery.data ?? null}
        onSend={handleSend}
      />}

      <GroupInfoModal
        open={groupInfoOpen}
        onClose={() => setGroupInfoOpen(false)}
        conversation={conv}
        currentUserId={myUserId}
      />
      {mediaOpen ? <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setMediaOpen(false); }}>
        <section role="dialog" aria-modal="true" aria-labelledby="conversation-media-title" className="flex max-h-[min(80vh,720px)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border bg-[var(--color-bg-primary)] shadow-2xl" style={{ borderColor: "var(--color-border-subtle)" }}>
          <header className="flex items-center gap-3 border-b px-5 py-4" style={{ borderColor: "var(--color-border-subtle)" }}>
            <Images size={19} className="text-[var(--color-accent)]" aria-hidden />
            <h2 id="conversation-media-title" className="flex-1 text-lg font-semibold text-[var(--color-fg-primary)]">All media</h2>
            <button type="button" onClick={() => setMediaOpen(false)} aria-label="Close media" className="rounded-full p-2 text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-tertiary)]"><X size={18} /></button>
          </header>
          <div className="min-h-40 flex-1 overflow-y-auto p-4">
            {mediaQuery.isLoading ? <p className="py-10 text-center text-sm text-[var(--color-fg-muted)]">Loading media…</p> : mediaQuery.error ? <div className="py-10 text-center"><p className="text-sm text-[var(--color-status-error)]">Couldn’t load chat media.</p><button type="button" onClick={() => void mediaQuery.refetch()} className="mt-2 text-sm text-[var(--color-accent)]">Try again</button></div> : mediaQuery.data?.length ? <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {mediaQuery.data.map((item) => <li key={item.id} className="min-w-0 overflow-hidden rounded-xl border" style={{ borderColor: "var(--color-border-subtle)" }}>
                <a href={item.url} target="_blank" rel="noreferrer" className="block">
                  {item.mime.startsWith("image/") ? <img src={item.url} alt="Chat attachment" loading="lazy" className="aspect-square w-full object-cover" /> : item.mime.startsWith("video/") ? <video src={item.url} preload="metadata" className="aspect-square w-full object-cover" /> : <div className="flex aspect-square items-center justify-center bg-[var(--color-bg-secondary)] text-sm text-[var(--color-fg-secondary)]">File</div>}
                  <time dateTime={item.created_at} className="block truncate px-2 py-1.5 text-xs text-[var(--color-fg-muted)]">{new Date(item.created_at).toLocaleDateString()}</time>
                </a>
              </li>)}
            </ul> : <p className="py-10 text-center text-sm text-[var(--color-fg-muted)]">No media or attachments in this chat yet.</p>}
          </div>
        </section>
      </div> : null}
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
  onLeaveGroup: () => void;
  muted: boolean;
  pinned: boolean;
  archived: boolean;
  blockedByMe: boolean;
  onToggleMute: () => void;
  onOpenMedia: () => void;
  onSelectMessages: () => void;
  onMarkUnread: () => void;
  onTogglePin: () => void;
  onToggleArchive: () => void;
  onBlock: () => void;
  onDeleteChat: () => void;
  canVoiceCall: boolean;
  canGroupCall: boolean;
  onGroupAudioCall: () => void;
  onGroupVideoCall: () => void;
  onSearchClick: () => void;
  showJoinGroupCall: boolean;
  onJoinGroupCall: () => void;
  groupCallInviteCandidates: Array<{ id: number; name: string }>;
  onInviteGroupCallMember: (userId: number) => void;
  onVoiceCall: () => void;
  onVideoCall: () => void;
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
  onLeaveGroup,
  muted,
  pinned,
  archived,
  blockedByMe,
  onToggleMute,
  onOpenMedia,
  onSelectMessages,
  onMarkUnread,
  onTogglePin,
  onToggleArchive,
  onBlock,
  onDeleteChat,
  canVoiceCall,
  canGroupCall,
  onGroupAudioCall,
  onGroupVideoCall,
  onSearchClick,
  showJoinGroupCall,
  onJoinGroupCall,
  groupCallInviteCandidates,
  onInviteGroupCallMember,
  onVoiceCall,
  onVideoCall,
}: ChatHeaderProps) {
  const [inviteMenuOpen, setInviteMenuOpen] = useState(false);
  return (
    <header
      className="flex min-w-0 items-center gap-2 border-b px-2 py-3 sm:gap-3 sm:px-4"
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
      {canVoiceCall ? (
        <IconBtn aria-label="Start voice call" title="Start voice call" onClick={onVoiceCall}>
          <Phone size={18} />
        </IconBtn>
      ) : null}
      {canGroupCall ? <>
        <IconBtn aria-label="Start group voice call" title="Start group voice call" onClick={onGroupAudioCall}><Phone size={18} /></IconBtn>
        <IconBtn aria-label="Start group video call" title="Start group video call" onClick={onGroupVideoCall} className="hidden sm:flex"><Video size={18} /></IconBtn>
      </> : null}
      {!isGroup ? <IconBtn
        aria-label="Video call"
        title="Start video call"
        onClick={onVideoCall}
        className="hidden sm:flex"
      >
        <Video size={18} />
      </IconBtn> : null}
      {showJoinGroupCall ? <button type="button" onClick={onJoinGroupCall} className="shrink-0 rounded-full bg-green-600 px-3 py-2 text-sm font-semibold text-white hover:bg-green-700 sm:px-4">Join call</button> : null}
      {groupCallInviteCandidates.length ? <div className="relative">
        <IconBtn aria-label="Invite a group member to the call" title="Invite a group member to the call" aria-expanded={inviteMenuOpen} onClick={() => setInviteMenuOpen((open) => !open)}><UserPlus size={18} /></IconBtn>
        {inviteMenuOpen ? <div className="absolute right-0 top-full z-40 mt-2 max-h-64 w-60 overflow-y-auto rounded-xl border p-1 shadow-xl" style={{ backgroundColor: "var(--color-bg-primary)", borderColor: "var(--color-border-subtle)" }}>
          {groupCallInviteCandidates.map((candidate) => <button key={candidate.id} type="button" onClick={() => { onInviteGroupCallMember(candidate.id); setInviteMenuOpen(false); }} className="block w-full rounded-lg px-3 py-2 text-left text-sm text-[var(--color-fg-primary)] hover:bg-[var(--color-bg-tertiary)]">Call {candidate.name} again</button>)}
        </div> : null}
      </div> : null}
      <IconBtn aria-label="Search in conversation" title="Search messages" onClick={onSearchClick}>
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
        {menuOpen ? <ChatOptionsMenu isGroup={isGroup} muted={muted} pinned={pinned} archived={archived} blockedByMe={blockedByMe} onClose={onMenuClose} onGroupSettings={onGroupSettings} onLeaveGroup={onLeaveGroup} onToggleMute={onToggleMute} onOpenMedia={onOpenMedia} onSelectMessages={onSelectMessages} onMarkUnread={onMarkUnread} onTogglePin={onTogglePin} onToggleArchive={onToggleArchive} onBlock={onBlock} onDeleteChat={onDeleteChat} /> : null}
      </div>
    </header>
  );
}

function ChatOptionsMenu({ isGroup, muted, pinned, archived, blockedByMe, onClose, onGroupSettings, onLeaveGroup, onToggleMute, onOpenMedia, onSelectMessages, onMarkUnread, onTogglePin, onToggleArchive, onBlock, onDeleteChat }: {
  isGroup: boolean; muted: boolean; pinned: boolean; archived: boolean; blockedByMe: boolean; onClose: () => void; onGroupSettings: () => void; onLeaveGroup: () => void;
  onToggleMute: () => void; onOpenMedia: () => void; onSelectMessages: () => void; onMarkUnread: () => void;
  onTogglePin: () => void; onToggleArchive: () => void; onBlock: () => void; onDeleteChat: () => void;
}) {
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

  const items = [
    { label: "Disappearing messages", icon: <Clock3 size={15} />, action: onGroupSettings, arrow: true },
    { label: muted ? "Unmute notifications" : "Mute notifications", icon: <BellOff size={15} />, action: onToggleMute },
    ...(isGroup ? [{ label: "Group settings", icon: <Settings size={15} />, action: onGroupSettings, arrow: false }] : []),
    { label: "All media", icon: <Images size={15} />, action: onOpenMedia },
    { label: "Select messages", icon: <CheckCircle2 size={15} />, action: onSelectMessages, dividerBefore: true },
    { label: "Mark as unread", icon: <MessageSquare size={15} />, action: onMarkUnread, dividerBefore: true },
    { label: pinned ? "Unpin chat" : "Pin chat", icon: <Pin size={15} />, action: onTogglePin },
    { label: archived ? "Unarchive" : "Archive", icon: <Archive size={15} />, action: onToggleArchive },
    ...(!isGroup ? [{ label: blockedByMe ? "Unblock" : "Block", icon: <Ban size={15} />, action: onBlock }] : []),
    { label: "Delete chat", icon: <Trash2 size={15} />, action: onDeleteChat },
    ...(isGroup ? [{ label: "Leave group", icon: <LogOut size={15} />, action: onLeaveGroup }] : []),
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
