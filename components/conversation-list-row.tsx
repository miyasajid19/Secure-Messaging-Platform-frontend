"use client";

/**
 * One row in the conversation list pane.
 *
 * Layout (left-to-right): avatar | (name + preview, flex-1 truncated) |
 * (timestamp + unread badge stack, right-aligned).
 *
 * `Conversation` is the live shape from `lib/api.ts` (Phase 4). A live
 * conversation may have `name = null` (typically for direct chats);
 * we synthesize a friendly title from participants in that case.
 *
 * Title derivation lives in `lib/conversation-title.ts` so this row
 * and the chat-pane header share the same logic.
 */

import { Archive, Ban, BellOff, Check, CheckCheck, Clock3, Images, LogOut, MessageSquare, MoreHorizontal, Pin, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ConversationAvatar } from "./conversation-avatar";
import {
  type Conversation,
  type MessagePreview,
  ApiError,
  blockUser,
  unblockUser,
  updateConversationActions,
  queryKeys,
  deleteConversationForMe,
  leaveGroup,
  listConversationMedia,
  setDisappearingTimer,
  DISAPPEARING_TIMER_OPTIONS,
} from "@/lib/api";
import { formatConversationTimestamp } from "@/lib/format";
import { useRealtimeStore } from "@/store/realtime";
import { useAuthStore } from "@/store/auth";
import { conversationTitle } from "@/lib/conversation-title";
import { useDraftStore } from "@/store/drafts";

interface Props {
  conversation: Conversation;
  selected: boolean;
  onSelect: (id: number | null) => void;
}

/** Resolved display strings. Computed once per render. */
interface Display {
  title: string;
  avatar: { avatar_url: string | null; display_name: string; last_seen?: string | null };
  preview: string;
}

function resolveDisplay(conv: Conversation, currentUserId: number | null): Display {
  const title = conversationTitle(conv, currentUserId);
  const preview = previewFromLastMessage(conv, currentUserId);
  const avatar = avatarSubjectForConv(conv, currentUserId);
  return { title, preview, avatar };
}

/**
 * Derive an (avatar_url, display_name) pair for the Avatar component.
 * For direct chats we use the other participant's avatar; for
 * groups we use the conversation's avatar_url (or fall back to
 * the title when the conversation has no avatar).
 */
function avatarSubjectForConv(
  conv: Conversation,
  currentUserId: number | null,
): {
  avatar_url: string | null;
  display_name: string;
  last_seen?: string | null;
} {
  if (conv.avatar_url) {
    return {
      avatar_url: conv.avatar_url,
      display_name: conversationTitle(conv, currentUserId),
    };
  }
  // Fall back to first non-self participant.
  const other = conv.participants?.find((p) => p.id !== currentUserId);
  if (other) {
    return {
      avatar_url: other.avatar_url,
      display_name: other.display_name ?? other.phone ?? "?",
      last_seen: other.last_seen ?? null,
    };
  }
  return {
    avatar_url: null,
    display_name: conversationTitle(conv, currentUserId),
  };
}

function previewFromLastMessage(
  conv: Conversation,
  currentUserId: number | null,
): string {
  const last: MessagePreview | null = conv.last_message;
  if (!last) return "No messages yet";
  // Backend's MessagePreview doesn't include the sender display name,
  // so we resolve it from `conv.participants` for groups (Phase 7 §6
  // — "Alice: see you at 5"). Direct conversations don't prefix.
  const isMine = last.sender_id === currentUserId;
  let prefix = "";
  if (isMine) {
    prefix = "You: ";
  } else if (conv.type === "group") {
    const sender = conv.participants?.find(
      (p) => p.id === last.sender_id,
    );
    const name = sender?.display_name?.split(" ")[0] ?? "Someone";
    prefix = `${name}: `;
  }
  const content = last.content || (last.type === "image" ? "📷 Photo" : "📎 Attachment");
  return `${prefix}${truncate(content, 48)}`;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "…";
}

export function ConversationListRow({
  conversation,
  selected,
  onSelect,
}: Props) {
  const unread = conversation.unread_count ?? 0;
  const time = conversation.last_message_at
    ? formatConversationTimestamp(conversation.last_message_at)
    : "";
  // Read the current user id once. Subscribing means the row will
  // re-render if the user logs out / switches — at which point
  // currentUserId is null and the title falls back to "Unknown".
  const currentUserId = useAuthStore((s) => s.user?.id ?? null);
  const { title, preview, avatar } = resolveDisplay(
    conversation,
    currentUserId,
  );
  const draft = useDraftStore((s) => s.drafts[conversation.id] ?? "");

  // Subscribe to the realtime presence store so the green dot lights
  // up the moment the WS tells us the other party connected.
  const presenceByUser = useRealtimeStore((s) => s.presenceByUser);
  // For direct conversations we want the *other* participant's id; for
  // groups we don't show a green dot (no per-participant indicator).
  const otherParticipant = conversation.participants?.find(
    (p) => p.id !== currentUserId,
  );
  const otherOnline = conversation.type === "direct" && otherParticipant
    ? Boolean(presenceByUser[otherParticipant.id])
    : false;
  const queryClient = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [timerOpen, setTimerOpen] = useState(false);
  const [timerValue, setTimerValue] = useState<number | null>(conversation.disappear_after_seconds);
  const [actionPending, setActionPending] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const mediaQuery = useQuery({
    queryKey: ["conversation-media", conversation.id],
    queryFn: () => listConversationMedia(conversation.id),
    enabled: mediaOpen,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  async function togglePin() {
    await updateAction({ pinned: !conversation.pinned }, conversation.pinned ? "Chat unpinned" : "Chat pinned");
  }

  async function updateAction(actions: { muted?: boolean; pinned?: boolean; archived?: boolean; marked_unread?: boolean }, success: string) {
    setActionPending(true);
    setMenuOpen(false);
    try {
      await updateConversationActions(conversation.id, actions);
      await queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
      if (selected && (actions.archived !== undefined || actions.marked_unread)) onSelect(null);
      toast.success(success);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Couldn't update this chat");
    } finally {
      setActionPending(false);
    }
  }

  async function deleteChat() {
    const confirmed = window.confirm("Delete this chat from your list? It will remain visible to other participants.");
    if (!confirmed) return;
    setActionPending(true);
    setMenuOpen(false);
    try {
      await deleteConversationForMe(conversation.id);
      await queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
      if (selected) onSelect(null);
      toast.success("Chat deleted for you");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Couldn't delete this chat");
    } finally {
      setActionPending(false);
    }
  }

  async function exitGroup() {
    const confirmed = window.confirm(`Leave “${conversation.name ?? "this group"}”?`);
    if (!confirmed) return;
    setActionPending(true);
    setMenuOpen(false);
    try {
      await leaveGroup(conversation.id);
      await queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
      if (selected) onSelect(null);
      toast.success("Left group");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Couldn't leave this group");
    } finally {
      setActionPending(false);
    }
  }

  async function saveDisappearingTimer() {
    setActionPending(true);
    try {
      await setDisappearingTimer(conversation.id, timerValue);
      await queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
      setTimerOpen(false);
      toast.success("Disappearing message timer updated");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Couldn't update the timer");
    } finally {
      setActionPending(false);
    }
  }

  async function toggleBlock() {
    if (!otherParticipant) return;
    const name = otherParticipant.display_name ?? otherParticipant.username ?? otherParticipant.phone ?? "this person";
    const isBlocked = !!conversation.blocked_by_me;
    if (!window.confirm(isBlocked
      ? `Unblock ${name}?`
      : `Block ${name}? Neither of you will be able to send messages in this chat.`)) return;
    setActionPending(true);
    setMenuOpen(false);
    try {
      if (isBlocked) {
        await unblockUser(otherParticipant.id);
      } else {
        await blockUser(otherParticipant.id);
        if (selected) onSelect(null);
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
      toast.success(isBlocked ? `${name} unblocked` : `${name} blocked`);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : `Couldn't ${isBlocked ? "unblock" : "block"} this person`);
    } finally {
      setActionPending(false);
    }
  }

  return (
    <>
    <div className="group relative mx-2 my-1 flex w-[calc(100%-1rem)] items-stretch rounded-xl transition hover:bg-[var(--color-bg-tertiary)]" style={{ backgroundColor: selected ? "var(--color-bg-tertiary)" : undefined }}>
      <button type="button" onClick={() => onSelect(conversation.id)} aria-pressed={selected} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-3 pr-1 text-left">
        <ConversationAvatar avatarUrl={avatar.avatar_url} displayName={avatar.display_name} isGroup={conversation.type === "group"} size={52} online={otherOnline} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-1.5 truncate text-sm font-semibold text-[var(--color-fg-primary)]">
            <span className="truncate">{title}</span>
            {conversation.pinned ? <Pin size={12} className="shrink-0 text-[var(--color-fg-muted)]" aria-label="Pinned" /> : null}
            {conversation.muted ? <BellOff size={12} className="shrink-0 text-[var(--color-fg-muted)]" aria-label="Muted" /> : null}
          </span>
          <span className="truncate text-xs" style={{ color: unread > 0 ? "var(--color-fg-primary)" : "var(--color-fg-secondary)" }}>
            {draft.trim() ? <><span className="mr-1 font-medium italic text-[var(--color-fg-secondary)]">Draft:</span><span className="italic">{truncate(draft.trim(), 44)}</span></> : preview}
          </span>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 pr-1">
          <span className="text-[11px] text-[var(--color-fg-muted)]">{time}</span>
          {unread > 0 ? <span className="flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-accent-fg)]" style={{ backgroundColor: "var(--color-accent)" }} aria-label={`${unread} unread`}>{unread > 99 ? "99+" : unread}</span> : null}
        </div>
      </button>
      <div ref={menuRef} className="relative flex shrink-0 items-center pr-1">
        <button type="button" disabled={actionPending} aria-label={`Actions for ${title}`} title="Chat actions" aria-expanded={menuOpen} aria-haspopup="menu" onClick={() => setMenuOpen((open) => !open)} className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--color-fg-muted)] opacity-70 transition hover:bg-[var(--color-bg-primary)] hover:text-[var(--color-fg-primary)] hover:opacity-100 focus:opacity-100 disabled:opacity-40">
          <MoreHorizontal size={19} />
        </button>
        {menuOpen ? <div role="menu" aria-label={`${title} actions`} className="absolute right-1 top-full z-50 mt-1 max-h-[70vh] w-52 overflow-y-auto rounded-xl border bg-[var(--color-bg-elevated)] p-1.5 shadow-xl" style={{ borderColor: "var(--color-border-subtle)" }}>
          <button type="button" role="menuitem" onClick={() => { setTimerValue(conversation.disappear_after_seconds); setTimerOpen(true); setMenuOpen(false); }} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-[var(--color-fg-primary)] hover:bg-[var(--color-bg-tertiary)]">
            <Clock3 size={15} className="text-[var(--color-fg-secondary)]" />Disappearing messages
          </button>
          <button type="button" role="menuitem" onClick={() => void togglePin()} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-[var(--color-fg-primary)] hover:bg-[var(--color-bg-tertiary)]">
            <Pin size={15} className="text-[var(--color-fg-secondary)]" />{conversation.pinned ? "Unpin chat" : "Pin chat"}
          </button>
          <button type="button" role="menuitem" onClick={() => void updateAction({ muted: !conversation.muted }, conversation.muted ? "Chat unmuted" : "Chat muted")} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-[var(--color-fg-primary)] hover:bg-[var(--color-bg-tertiary)]">
            <BellOff size={15} className="text-[var(--color-fg-secondary)]" />{conversation.muted ? "Unmute notifications" : "Mute notifications"}
          </button>
          <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setMediaOpen(true); }} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-[var(--color-fg-primary)] hover:bg-[var(--color-bg-tertiary)]">
            <Images size={15} className="text-[var(--color-fg-secondary)]" />All media
          </button>
          <div className="my-1 h-px" style={{ backgroundColor: "var(--color-border-subtle)" }} />
          <button type="button" role="menuitem" onClick={() => void updateAction({ marked_unread: true }, "Marked as unread")} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-[var(--color-fg-primary)] hover:bg-[var(--color-bg-tertiary)]">
            <MessageSquare size={15} className="text-[var(--color-fg-secondary)]" />Mark as unread
          </button>
          <button type="button" role="menuitem" onClick={() => void updateAction({ archived: !conversation.archived }, conversation.archived ? "Chat unarchived" : "Chat archived")} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-[var(--color-fg-primary)] hover:bg-[var(--color-bg-tertiary)]">
            <Archive size={15} className="text-[var(--color-fg-secondary)]" />{conversation.archived ? "Unarchive" : "Archive"}
          </button>
          {conversation.type === "direct" && otherParticipant ? <button type="button" role="menuitem" onClick={() => void toggleBlock()} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-[var(--color-fg-primary)] hover:bg-[var(--color-bg-tertiary)]">
            <Ban size={15} className="text-[var(--color-fg-secondary)]" />{conversation.blocked_by_me ? "Unblock" : "Block"}
          </button> : null}
          {conversation.type === "group" ? <button type="button" role="menuitem" onClick={() => void exitGroup()} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-[var(--color-fg-primary)] hover:bg-[var(--color-bg-tertiary)]">
            <LogOut size={15} className="text-[var(--color-fg-secondary)]" />Leave group
          </button> : null}
          <button type="button" role="menuitem" onClick={() => void deleteChat()} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-red-600 hover:bg-red-500/10">
            <Trash2 size={15} />Delete chat
          </button>
        </div> : null}
      </div>
    </div>
    {mediaOpen ? <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setMediaOpen(false); }}>
      <section role="dialog" aria-modal="true" aria-labelledby={`media-title-${conversation.id}`} className="flex max-h-[min(80vh,720px)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border bg-[var(--color-bg-primary)] shadow-2xl" style={{ borderColor: "var(--color-border-subtle)" }}>
        <header className="flex items-center gap-3 border-b px-5 py-4" style={{ borderColor: "var(--color-border-subtle)" }}><Images size={19} className="text-[var(--color-accent)]" aria-hidden /><h2 id={`media-title-${conversation.id}`} className="flex-1 text-lg font-semibold text-[var(--color-fg-primary)]">All media · {title}</h2><button type="button" onClick={() => setMediaOpen(false)} aria-label="Close media" className="rounded-full p-2 text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-tertiary)]"><X size={18} /></button></header>
        <div className="min-h-40 flex-1 overflow-y-auto p-4">
          {mediaQuery.isLoading ? <p className="py-10 text-center text-sm text-[var(--color-fg-muted)]">Loading media…</p> : mediaQuery.error ? <div className="py-10 text-center"><p className="text-sm text-[var(--color-status-error)]">Couldn’t load chat media.</p><button type="button" onClick={() => void mediaQuery.refetch()} className="mt-2 text-sm text-[var(--color-accent)]">Try again</button></div> : mediaQuery.data?.length ? <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {mediaQuery.data.map((item) => <li key={item.id} className="min-w-0 overflow-hidden rounded-xl border" style={{ borderColor: "var(--color-border-subtle)" }}><a href={item.url} target="_blank" rel="noreferrer" className="block">{item.mime.startsWith("image/") ? <img src={item.url} alt="Chat attachment" loading="lazy" className="aspect-square w-full object-cover" /> : item.mime.startsWith("video/") ? <video src={item.url} preload="metadata" className="aspect-square w-full object-cover" /> : <div className="flex aspect-square items-center justify-center bg-[var(--color-bg-secondary)] text-sm text-[var(--color-fg-secondary)]">File</div>}<time dateTime={item.created_at} className="block truncate px-2 py-1.5 text-xs text-[var(--color-fg-muted)]">{new Date(item.created_at).toLocaleDateString()}</time></a></li>)}
          </ul> : <p className="py-10 text-center text-sm text-[var(--color-fg-muted)]">No media or attachments in this chat yet.</p>}
        </div>
      </section>
    </div> : null}
    {timerOpen ? <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setTimerOpen(false); }}>
      <section role="dialog" aria-modal="true" aria-labelledby={`timer-title-${conversation.id}`} className="w-full max-w-sm rounded-2xl border bg-[var(--color-bg-primary)] p-5 shadow-2xl" style={{ borderColor: "var(--color-border-subtle)" }}>
        <div className="mb-4 flex items-start gap-3"><Clock3 size={19} className="mt-1 text-[var(--color-accent)]" aria-hidden /><div className="flex-1"><h2 id={`timer-title-${conversation.id}`} className="text-lg font-semibold text-[var(--color-fg-primary)]">Disappearing messages</h2><p className="mt-1 text-sm text-[var(--color-fg-secondary)]">New messages in this chat disappear after the selected time.</p></div><button type="button" onClick={() => setTimerOpen(false)} aria-label="Close timer settings" className="rounded-full p-1.5 text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-tertiary)]"><X size={17} /></button></div>
        <label htmlFor={`timer-select-${conversation.id}`} className="mb-1.5 block text-sm font-medium text-[var(--color-fg-primary)]">Delete messages after</label>
        <select id={`timer-select-${conversation.id}`} value={timerValue ?? "off"} onChange={(event) => setTimerValue(event.target.value === "off" ? null : Number(event.target.value))} className="mb-5 min-h-11 w-full rounded-lg border bg-[var(--color-bg-secondary)] px-3 text-sm text-[var(--color-fg-primary)]" style={{ borderColor: "var(--color-border-subtle)" }}>
          {DISAPPEARING_TIMER_OPTIONS.map((option) => <option key={option.label} value={option.value ?? "off"}>{option.label}</option>)}
        </select>
        <div className="flex justify-end gap-2"><button type="button" onClick={() => setTimerOpen(false)} className="rounded-lg px-3 py-2 text-sm text-[var(--color-fg-secondary)] hover:bg-[var(--color-bg-tertiary)]">Cancel</button><button type="button" disabled={actionPending} onClick={() => void saveDisappearingTimer()} className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Save</button></div>
      </section>
    </div> : null}
    </>
  );
}

// Re-export so the parent can also re-use the read-receipt helpers
// if/when needed.
export { Check, CheckCheck };
