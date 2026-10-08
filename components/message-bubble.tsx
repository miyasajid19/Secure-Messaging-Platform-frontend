"use client";

/**
 * Single message bubble.
 *
 * Bubble shape: `rounded-2xl` everywhere except one corner which is
 * less rounded to create the "tail" effect Signal uses. We override
 * the corner via `borderRadius` rather than Tailwind's per-corner
 * classes because v4's `rounded-*` syntax + arbitrary corners gets
 * fiddly.
 *
 * Status icons for outgoing bubbles:
 *   undefined  → single tick until the receipt endpoint hydrates it
 *   sending    → small spinner
 *   sent       → single `Check`
 *   delivered  → muted `CheckCheck`
 *   read       → small hollow circle in white
 *
 * Reply and reaction actions appear beside the bubble on hover (and
 * keyboard focus). The quoted preview appears above reply content.
 */

import {
  AlertCircle,
  Check,
  CheckCheck,
  Circle,
  CornerUpLeft,
  Loader2,
  SmilePlus,
  Timer,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Avatar } from "./avatar";
import { type Message, type ReactionGroup } from "@/lib/api";
import { formatBubbleTime } from "@/lib/format";
import { SeenByAvatars } from "./seen-by-avatars";
import { useReplyStore, type ReplyTarget } from "@/store/reply";
import { getQueryClient, queryKeys } from "@/lib/api";
import { addReaction, removeReaction, ApiError } from "@/lib/api";
import { toast } from "sonner";

interface Props {
  message: Message;
  /** Computed by the parent — true when the current user sent it. */
  isOutgoing: boolean;
  /** Optional last-seen placement for group receipts. */
  seenBy?: Message["seen_by"];
  /** Show sender name + avatar above the bubble (for group chats).
   *  Phase 4 mock data passes false; live data flips it on for groups. */
  showSenderHeader?: boolean;
  /** Phase 5: invoked when the user clicks the retry triangle on a
   *  failed outgoing bubble. */
  onRetry?: (msg: Message) => void;
  /** Phase 8: enables the "seen by" avatar row on outgoing group
   *  messages. Direct chats and incoming bubbles ignore this. */
  isGroup?: boolean;
  /** Phase 8.1: the parent message, if this bubble is a reply. The
   *  chat-pane looks it up by `message.parent_id` from its messages
   *  cache. */
  parent?: Message | null;
  /** Phase 8.2: current user's id, used to highlight badges the
   *  user has reacted to. */
  currentUserId?: number | null;
  /** Online state of the peer in a direct conversation. */
  recipientOnline?: boolean;
}

export function MessageBubble({
  message,
  seenBy: seenByOverride,
  isOutgoing,
  showSenderHeader = false,
  onRetry,
  isGroup = false,
  parent,
  currentUserId = null,
  recipientOnline = false,
}: Props) {
  const time = formatBubbleTime(message.created_at);

  // Phase 8.4 — disappearing-message timer. Re-derive the remaining
  // seconds every tick and force a re-render so the chip counts
  // down live. Remove the expired row from the local cache at the
  // deadline as well as waiting for the server's periodic delete
  // event; this keeps an open chat correct if that event is delayed
  // or missed during a reconnect.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (message.disappear_after_seconds == null) return;
    const seconds = message.disappear_after_seconds;
    const expiresAt = parseMessageTimestamp(message.created_at) + seconds * 1000;
    const handle = window.setInterval(() => {
      const currentNow = Date.now();
      setNow(currentNow);
      if (currentNow >= expiresAt) {
        window.clearInterval(handle);
        getQueryClient().setQueryData<Message[]>(
          queryKeys.messages(message.conversation_id),
          (messages) => messages?.filter((item) => item.id !== message.id),
        );
      }
    }, 1000);
    return () => window.clearInterval(handle);
  }, [message.created_at, message.disappear_after_seconds]);
  const isDisappearing = message.disappear_after_seconds != null;
  const expiresAtMs =
    isDisappearing
    ? parseMessageTimestamp(message.created_at) +
        message.disappear_after_seconds! * 1000
      : null;
  const remainingMs =
    expiresAtMs != null ? Math.max(0, expiresAtMs - now) : null;

  // Tail corner: outgoing trims the top-right, incoming trims the top-left.
  const radiusStyle = isOutgoing
    ? { borderTopRightRadius: 6, borderTopLeftRadius: 16 }
    : { borderTopLeftRadius: 6, borderTopRightRadius: 16 };

  const bubbleBg = isOutgoing ? "var(--color-bubble-out)" : "var(--color-bubble-in)";
  const bubbleFg = isOutgoing
    ? "var(--color-bubble-out-fg)"
    : "var(--color-fg-primary)";
  const mutedFg = isOutgoing
    ? "var(--color-bubble-out-fg-muted)"
    : "var(--color-fg-muted)";

  // Phase 8 — seen-by avatar row replaces the read-check icon for
  // outgoing group messages. We only show the avatar row when at
  // least one user has read; otherwise fall back to the standard
  // status icon (sending/sent/delivered).
  const seenBy = seenByOverride ?? message.seen_by ?? [];
  const showSeenBy = isOutgoing && seenBy.length > 0;

  const setReplyingTo = useReplyStore((s) => s.setReplyingTo);

  function openReply() {
    setReplyingTo({
      id: message.id,
      conversation_id: message.conversation_id,
      sender_name:
        message.sender.display_name ?? message.sender.phone ?? "Unknown",
      content: parent?.content ?? message.content.slice(0, 120),
      type: message.type,
    });
  }

  // Phase 8.2 — reaction picker state. Toggling the same emoji the
  // user already has removes their reaction; picking a new emoji
  // adds it. We optimistically mutate the message in the React
  // Query cache, then fire the POST/DELETE. The backend's
  // `reactions.update` WS event reconciles any drift.
  const reactions = message.reactions ?? [];
  const [pickerOpen, setPickerOpen] = useState(false);

  function userHasReacted(emoji: string): boolean {
    if (currentUserId == null) return false;
    const group = reactions.find((g) => g.emoji === emoji);
    return group?.users.some((u) => u.id === currentUserId) ?? false;
  }

  function toggleReaction(emoji: string) {
    if (currentUserId == null) return;
    const me = currentUserId;
    const hasMine = userHasReacted(emoji);
    // Optimistic write — update the message's `reactions` array
    // directly via the cache so the badge flips immediately.
    const qc = getQueryClient();
    const cid = message.conversation_id;
    qc.setQueryData<Message[]>(queryKeys.messages(cid), (prev) => {
      if (!prev) return prev;
      return prev.map((m) => {
        if (m.id !== message.id) return m;
        const next = (m.reactions ?? []).slice();
        const idx = next.findIndex((g) => g.emoji === emoji);
        if (idx === -1) {
          next.push({
            emoji,
            count: 1,
            users: [
              { id: me, display_name: null, avatar_url: null },
            ],
          });
        } else {
          const g = next[idx];
          if (hasMine) {
            // Remove this user
            const users = g.users.filter((u) => u.id !== me);
            if (users.length === 0) {
              next.splice(idx, 1);
            } else {
              next[idx] = { ...g, count: g.count - 1, users };
            }
          } else {
            next[idx] = {
              ...g,
              count: g.count + 1,
              users: [
                ...g.users,
                { id: me, display_name: null, avatar_url: null },
              ],
            };
          }
        }
        return { ...m, reactions: next };
      });
    });
    setPickerOpen(false);
    // Fire the actual API call. The WS event reconciles any drift.
    const promise = hasMine
      ? removeReaction(message.id, emoji)
      : addReaction(message.id, emoji);
    promise
      .then((server) => {
        // POST returns the canonical ReactionGroup — use it to replace
        // the optimistic row (in case the server computed a different
        // count, e.g. another user reacted concurrently).
        if (server && !hasMine) {
          qc.setQueryData<Message[]>(queryKeys.messages(cid), (prev) => {
            if (!prev) return prev;
            return prev.map((m) => {
              if (m.id !== message.id) return m;
              const next = (m.reactions ?? []).filter(
                (g) => g.emoji !== emoji,
              );
              next.push(server);
              return { ...m, reactions: next };
            });
          });
        }
      })
      .catch((err) => {
        // 409 = "you already reacted" — treat as a no-op. The next
        // WS event or a follow-up refetch will reconcile.
        if (err instanceof ApiError && err.status === 409) return;
        // Roll back the optimistic write on hard errors and toast.
        qc.setQueryData<Message[]>(queryKeys.messages(cid), (prev) => {
          if (!prev) return prev;
          return prev.map((m) => {
            if (m.id !== message.id) return m;
            const next = (m.reactions ?? []).slice();
            const idx = next.findIndex((g) => g.emoji === emoji);
            if (idx === -1) return m;
            const g = next[idx];
            // Reverse the optimistic flip:
            if (hasMine) {
              const users = g.users.filter((u) => u.id !== me);
              if (users.length === 0) {
                next.splice(idx, 1);
              } else {
                next[idx] = { ...g, count: g.count - 1, users };
              }
            } else {
              const wasMine = g.users.some((u) => u.id === me);
              if (wasMine) {
                const users = g.users.filter((u) => u.id !== me);
                if (users.length === 0) {
                  next.splice(idx, 1);
                } else {
                  next[idx] = { ...g, count: g.count - 1, users };
                }
              }
            }
            return { ...m, reactions: next };
          });
        });
        toast.error("Couldn't add reaction — try again.");
      });
  }

  return (
    <div
      className={`relative flex w-full gap-2 px-4 py-1 ${
        isOutgoing ? "flex-row-reverse" : "flex-row"
      }`}
    >
      {!isOutgoing && showSenderHeader ? (
        <Avatar
          subject={{
            avatar_url: message.sender.avatar_url ?? "",
            display_name: message.sender.display_name ?? message.sender.phone,
            last_seen: message.sender.last_seen,
          }}
          size={28}
          showOnline={false}
        />
      ) : !isOutgoing ? (
        <span className="w-7" aria-hidden />
      ) : null}

      <div
        className={`group relative flex min-w-0 max-w-[78%] flex-col gap-1 ${
          isOutgoing ? "items-end" : "items-start"
        }`}
      >
        {showSenderHeader ? (
          <span className="px-3 text-[11px] font-semibold text-[var(--color-fg-secondary)]">
            {message.sender.display_name ?? message.sender.phone}
          </span>
        ) : null}

        <div
          role="toolbar"
          aria-label="Message actions"
          className="pointer-events-none absolute top-1/2 z-30 flex -translate-y-1/2 items-center gap-1 rounded-full border bg-[var(--color-bg-elevated)] p-1 opacity-0 shadow-lg transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"
          style={{
            [isOutgoing ? "right" : "left"]: "calc(100% - 0.5rem)",
            borderColor: "var(--color-border-subtle)",
          }}
        >
          <button
            type="button"
            aria-label="Reply"
            title="Reply"
            onClick={openReply}
            className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--color-fg-secondary)] transition-colors hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-fg-primary)] focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"
          >
            <CornerUpLeft size={16} aria-hidden />
          </button>
          <button
            type="button"
            aria-label="React"
            title="React"
            onClick={() => setPickerOpen(true)}
            className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--color-fg-secondary)] transition-colors hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-fg-primary)] focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"
          >
            <SmilePlus size={16} aria-hidden />
          </button>
        </div>

        {/* Phase 8.2 — emoji picker popover. Shown after the user
            picks "React" in the context menu. Quick row of 6 common
            emojis + a second row of 3 more, per spec. */}
        {pickerOpen ? (
          <EmojiPicker
            onPick={(emoji) => toggleReaction(emoji)}
            onClose={() => setPickerOpen(false)}
            align={isOutgoing ? "right" : "left"}
          />
        ) : null}

        {parent ? (
          <div
            className={`flex w-fit min-w-0 max-w-full flex-col gap-0.5 ${
              isOutgoing ? "items-end" : "items-start"
            }`}
          >
            <span className="flex items-center gap-1 px-1 text-[11px] leading-4 text-[var(--color-fg-muted)]">
              <CornerUpLeft size={11} aria-hidden />
              {replyContextLabel(message, parent, isOutgoing, currentUserId)}
            </span>
            <QuotedParent parent={parent} />
          </div>
        ) : null}

        <div
          className="flex w-fit min-w-0 max-w-full flex-col gap-1 px-3 py-2 shadow-sm"
          style={{
            backgroundColor: bubbleBg,
            color: bubbleFg,
            borderRadius: 16,
            ...radiusStyle,
            ...(isDisappearing
              ? {
                  outline: "1px dashed var(--color-border-default)",
                  outlineOffset: "-1px",
                  opacity: remainingMs === 0 ? 0.72 : 1,
                  transition: "opacity 250ms ease",
                }
              : {}),
          }}
        >
          <span className="whitespace-pre-wrap break-words text-sm leading-snug">
            {message.content}
          </span>
        </div>
        <div
          className={`flex items-center gap-1 px-1 ${
            isOutgoing ? "justify-end" : "justify-start"
          }`}
        >
          <span className="text-[10px]" style={{ color: mutedFg }}>
            {time}
          </span>
          {remainingMs != null ? (
            <span
              aria-label={`Disappears in ${formatRemaining(remainingMs)}`}
              title="Disappearing message"
              className="flex items-center gap-0.5 text-[10px]"
              style={{ color: "var(--color-fg-muted)" }}
            >
              <Timer size={10} aria-hidden />
              {formatRemaining(remainingMs)}
            </span>
          ) : null}
          {isOutgoing && !showSeenBy ? (
            <ReceiptMark
              status={message.status}
              mutedFg={mutedFg}
              isGroup={isGroup}
              recipientOnline={recipientOnline}
              onRetry={onRetry ? () => onRetry(message) : undefined}
            />
          ) : null}
        </div>
        {showSeenBy ? <SeenByAvatars users={seenBy} /> : null}
        {reactions.length > 0 ? (
          <ReactionRow
            reactions={reactions}
            currentUserId={currentUserId}
            align={isOutgoing ? "right" : "left"}
            onToggle={toggleReaction}
          />
        ) : null}
      </div>
    </div>
  );
}

/**
 * The small quoted bubble shown above a reply, separate from the
 * reply's own message bubble.
 */
function QuotedParent({ parent }: { parent: Message }) {
  return (
    <div
      data-testid="quoted-parent"
      className="w-fit min-w-0 max-w-full overflow-hidden rounded-2xl px-3 py-1.5"
      style={{
        backgroundColor: "var(--color-bg-tertiary)",
        maxWidth: "min(78vw, 24rem)",
      }}
    >
      <div
        className="max-w-full truncate text-xs"
        style={{ color: "var(--color-fg-secondary)" }}
      >
        {parent.type === "image" ? "📷 Photo" : parent.content}
      </div>
    </div>
  );
}

function replyContextLabel(
  message: Message,
  parent: Message,
  isOutgoing: boolean,
  currentUserId: number | null,
): string {
  const parentSender =
    parent.sender.display_name ?? parent.sender.phone ?? "this person";
  if (isOutgoing) {
    return parent.sender_id === message.sender_id
      ? "You replied to yourself"
      : `You replied to ${parentSender}`;
  }
  const replyAuthor = message.sender.display_name ?? message.sender.phone ?? "Someone";
  return parent.sender_id === currentUserId
    ? `${replyAuthor} replied to you`
    : `${replyAuthor} replied to ${parentSender}`;
}

function ReceiptMark({
  status,
  mutedFg,
  isGroup,
  recipientOnline,
  onRetry,
}: {
  status: Message["status"];
  mutedFg: string;
  isGroup: boolean;
  recipientOnline: boolean;
  onRetry?: () => void;
}) {
  const effective = status ?? "sent";

  if (effective === "failed") {
    // Red retry triangle. Same colour as the error token so the user
    // notices immediately.
    return (
      <button
        type="button"
        onClick={onRetry}
        aria-label="Retry send"
        className="flex h-5 w-5 items-center justify-center rounded-full"
        style={{ color: "var(--color-status-error)" }}
      >
        <AlertCircle size={14} strokeWidth={2.5} aria-hidden />
      </button>
    );
  }
  if (effective === "sending") {
    return (
      <Loader2
        size={12}
        className="animate-spin"
        style={{ color: mutedFg }}
        aria-label="sending"
      />
    );
  }
  if (effective === "read") {
    return (
      <Circle
        size={12}
        strokeWidth={2}
        style={{ color: mutedFg }}
        aria-label="seen"
      />
    );
  }
  if ((isGroup && effective === "delivered") || (!isGroup && recipientOnline)) {
    return (
      <CheckCheck
        size={14}
        strokeWidth={2.5}
        style={{ color: mutedFg, opacity: 0.8 }}
        aria-label="delivered"
      />
    );
  }
  return (
    <Check
      size={14}
      strokeWidth={2.5}
      style={{ color: mutedFg }}
      aria-label="sent"
    />
  );
}

function formatRemaining(ms: number): string {
  if (ms <= 0) return "0s";
  const totalSeconds = Math.ceil(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.ceil(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const totalHours = Math.ceil(totalMinutes / 60);
  if (totalHours < 24) return `${totalHours}h`;
  const totalDays = Math.ceil(totalHours / 24);
  return `${totalDays}d`;
}

/** Backend timestamps may be ISO strings without a timezone suffix; those
 * represent UTC. Make that explicit so browser-local timezone offsets do not
 * make fresh messages appear to have expired immediately. */
function parseMessageTimestamp(value: string): number {
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
  return Date.parse(hasTimezone ? value : `${value}Z`);
}

/**
 * Phase 8.2 — small row of reaction badges rendered below the
 * bubble. Each badge is an emoji + count. If the current user is in
 * the badge's `users` list, the badge's border is the accent colour
 * so they can see their own reaction at a glance.
 */
function ReactionRow({
  reactions,
  currentUserId,
  align,
  onToggle,
}: {
  reactions: ReactionGroup[];
  currentUserId: number | null;
  align: "left" | "right";
  onToggle: (emoji: string) => void;
}) {
  return (
    <div
      className={`mt-1 flex flex-wrap items-center gap-1 ${
        align === "right" ? "justify-end" : "justify-start"
      }`}
    >
      {reactions.map((group) => {
        const hasMine =
          currentUserId != null &&
          group.users.some((u) => u.id === currentUserId);
        const display = group.count > 99 ? "99+" : String(group.count);
        return (
          <button
            key={group.emoji}
            type="button"
            onClick={() => onToggle(group.emoji)}
            aria-pressed={hasMine}
            aria-label={`${display} ${group.emoji} reactions`}
            className="flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs transition hover:opacity-80"
            style={{
              backgroundColor: "var(--color-bg-elevated)",
              borderColor: hasMine
                ? "var(--color-accent)"
                : "var(--color-border-subtle)",
              color: "var(--color-fg-primary)",
            }}
          >
            <span aria-hidden>{group.emoji}</span>
            <span>{display}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Compact reaction picker. It starts with six common emojis; the plus
 * button expands the additional choices. Picking an emoji closes it.
 */
const QUICK_EMOJIS = ["❤️", "😆", "😮", "😢", "😠", "👍"];
const MORE_EMOJIS = ["🙏", "🎉", "🔥", "👀", "🥰", "🤔", "👏", "💯"];

function EmojiPicker({
  onPick,
  onClose,
  align,
}: {
  onPick: (emoji: string) => void;
  onClose: () => void;
  align: "left" | "right";
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [showMore, setShowMore] = useState(false);

  useEffect(() => {
    function onPointer(e: MouseEvent) {
      if (!ref.current) return;
      if (ref.current.contains(e.target as Node)) return;
      onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Pick a reaction"
      className="absolute top-1/2 z-30 -translate-y-1/2 flex flex-col gap-1 rounded-xl border bg-[var(--color-bg-elevated)] p-2 shadow-lg"
      style={{
        [align === "right" ? "right" : "left"]: "calc(100% - 0.5rem)",
        borderColor: "var(--color-border-subtle)",
      }}
    >
      <div className="flex gap-1">
        {QUICK_EMOJIS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => onPick(emoji)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-lg transition hover:bg-[var(--color-bg-tertiary)]"
            aria-label={`React with ${emoji}`}
          >
            {emoji}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setShowMore((open) => !open)}
          aria-label="More reactions"
          aria-expanded={showMore}
          title={showMore ? "Fewer reactions" : "More reactions"}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-base text-[var(--color-fg-secondary)] transition hover:bg-[var(--color-bg-tertiary)]"
        >
          {showMore ? "−" : "+"}
        </button>
      </div>
      {showMore ? (
        <div className="flex max-w-72 flex-wrap gap-1">
          {MORE_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => onPick(emoji)}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-lg transition hover:bg-[var(--color-bg-tertiary)]"
              aria-label={`React with ${emoji}`}
            >
              {emoji}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
