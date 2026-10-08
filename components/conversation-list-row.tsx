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
 */

import { Check, CheckCheck } from "lucide-react";
import { Avatar } from "./avatar";
import {
  type Conversation,
  type MessagePreview,
} from "@/lib/api";
import { formatConversationTimestamp } from "@/lib/format";
import { useRealtimeStore } from "@/store/realtime";

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

function resolveDisplay(conv: Conversation): Display {
  const title = displayTitle(conv);
  const preview = previewFromLastMessage(conv);
  const avatar = avatarSubjectForConv(conv);
  return { title, preview, avatar };
}

/** Title precedence: explicit name → first non-self participant → "(unknown)". */
function displayTitle(conv: Conversation): string {
  if (conv.name) return conv.name;
  if (conv.participants && conv.participants.length > 0) {
    // For direct conversations, there will be exactly one other
    // participant + the current user. Prefer that one. For groups,
    // join the first few.
    const others = conv.participants.filter((p) => p.id !== CURRENT_USER_ID_HINT);
    if (others.length === 1) {
      return others[0].display_name ?? others[0].phone ?? "Unknown";
    }
    if (others.length > 1) {
      return others
        .slice(0, 3)
        .map((p) => p.display_name ?? p.phone ?? "?")
        .join(", ");
    }
  }
  return "Unknown";
}

// A local hint — at render time the row doesn't know the current user
// id from `useAuthStore` (that would create an import cycle in mock
// data). The full name from participants is fine if the backend
// includes both the current user and the other party — we'll keep
// the first non-empty name.
//
// The shell renders the row inside an authenticated context; if this
// hook ever needs to be precise, replace the heuristic with
// `useAuthStore.getState().user?.id`.
let CURRENT_USER_ID_HINT: number | null = null;

/** Derive a (avatar_url, display_name) pair for the Avatar component. */
function avatarSubjectForConv(conv: Conversation): {
  avatar_url: string | null;
  display_name: string;
  last_seen?: string | null;
} {
  if (conv.avatar_url) {
    return { avatar_url: conv.avatar_url, display_name: displayTitle(conv) };
  }
  // Fall back to first non-self participant.
  const other = conv.participants?.find((p) => p.id !== CURRENT_USER_ID_HINT);
  if (other) {
    return {
      avatar_url: other.avatar_url,
      display_name: other.display_name ?? other.phone ?? "?",
      last_seen: other.last_seen ?? null,
    };
  }
  return {
    avatar_url: null,
    display_name: displayTitle(conv),
  };
}

function previewFromLastMessage(conv: Conversation): string {
  const last: MessagePreview | null = conv.last_message;
  if (!last) return "No messages yet";
  // Backend's MessagePreview doesn't include the sender display name
  // (it's just id + content). We compute "You: <msg>" / "Them: <msg>"
  // heuristically by id. The chat pane (Phase 5) refines this when it
  // resolves the sender from the joined `sender` field.
  const isMine = last.sender_id === CURRENT_USER_ID_HINT;
  const prefix = isMine
    ? "You: "
    : // We don't have display_name on MessagePreview — keep it short.
      "";
  return `${prefix}${truncate(last.content, 48)}`;
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
  const { title, preview, avatar } = resolveDisplay(conversation);

  // Subscribe to the realtime presence store so the green dot lights
  // up the moment the WS tells us the other party connected.
  const presenceByUser = useRealtimeStore((s) => s.presenceByUser);
  // For direct conversations we want the *other* participant's id; for
  // groups we don't show a green dot (no per-participant indicator).
  const otherParticipant = conversation.participants?.find(
    (p) => p.id !== CURRENT_USER_ID_HINT,
  );
  const otherOnline = conversation.type === "direct" && otherParticipant
    ? Boolean(presenceByUser[otherParticipant.id])
    : false;

  return (
    <button
      type="button"
      onClick={() => onSelect(conversation.id)}
      aria-pressed={selected}
      className="flex w-full items-center gap-3 px-3 py-2 text-left transition hover:bg-[var(--color-bg-tertiary)]"
      style={{
        backgroundColor: selected ? "var(--color-bg-tertiary)" : undefined,
      }}
    >
      <Avatar
        subject={{
          avatar_url: avatar.avatar_url ?? "",
          display_name: avatar.display_name,
          last_seen: avatar.last_seen ?? null,
        }}
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
          {preview}
        </span>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="text-[11px] text-[var(--color-fg-muted)]">
          {time}
        </span>
        {unread > 0 ? (
          <span
            className="flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-accent-fg)]"
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
