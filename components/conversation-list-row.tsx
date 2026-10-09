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

import { Check, CheckCheck } from "lucide-react";
import { ConversationAvatar } from "./conversation-avatar";
import {
  type Conversation,
  type MessagePreview,
} from "@/lib/api";
import { formatConversationTimestamp } from "@/lib/format";
import { useRealtimeStore } from "@/store/realtime";
import { useAuthStore } from "@/store/auth";
import { conversationTitle } from "@/lib/conversation-title";
import { useDraftStore } from "@/store/drafts";

interface Props {
  conversation: Conversation;
  selected: boolean;
  onSelect: (id: number) => void;
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

  return (
    <button
      type="button"
      onClick={() => onSelect(conversation.id)}
      aria-pressed={selected}
      className="mx-2 my-1 flex w-[calc(100%-1rem)] items-center gap-3 rounded-xl px-3 py-3 text-left transition hover:bg-[var(--color-bg-tertiary)]"
      style={{
        backgroundColor: selected ? "var(--color-bg-tertiary)" : undefined,
      }}
    >
      <ConversationAvatar
        avatarUrl={avatar.avatar_url}
        displayName={avatar.display_name}
        isGroup={conversation.type === "group"}
        size={52}
        online={otherOnline}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-semibold text-[var(--color-fg-primary)]">
          {title}
        </span>
        <span
          className="truncate text-xs"
          style={{
            color: unread > 0
              ? "var(--color-fg-primary)"
              : "var(--color-fg-secondary)",
          }}
        >
          {draft.trim() ? (
            <>
              <span className="mr-1 font-medium italic text-[var(--color-fg-secondary)]">
                Draft:
              </span>
              <span className="italic">{truncate(draft.trim(), 44)}</span>
            </>
          ) : (
            preview
          )}
        </span>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="text-[11px] text-[var(--color-fg-muted)]">
          {time}
        </span>
        {unread > 0 ? (
          <span
            className="flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-accent-fg)"
            style={{ backgroundColor: "var(--color-accent)" }}
            aria-label={`${unread} unread`}
          >
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </div>
    </button>
  );
}

// Re-export so the parent can also re-use the read-receipt helpers
// if/when needed.
export { Check, CheckCheck };
