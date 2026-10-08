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
 * Status icons (used for outgoing bubbles when `status` is set):
 *   undefined  → no icon (live server message — Phase 4 doesn't
 *                  expose per-message status yet; treated as read)
 *   sending    → small spinner
 *   sent       → single `Check`
 *   delivered  → muted `CheckCheck`
 *   read       → accent-tinted `CheckCheck`
 */

import { AlertCircle, Check, CheckCheck, Loader2 } from "lucide-react";
import { Avatar } from "./avatar";
import { type Message } from "@/lib/api";
import { formatBubbleTime } from "@/lib/format";

interface Props {
  message: Message;
  /** Computed by the parent — true when the current user sent it. */
  isOutgoing: boolean;
  /** Show sender name + avatar above the bubble (for group chats).
   *  Phase 4 mock data passes false; live data flips it on for groups. */
  showSenderHeader?: boolean;
  /** Phase 5: invoked when the user clicks the retry triangle on a
   *  failed outgoing bubble. */
  onRetry?: (msg: Message) => void;
}

export function MessageBubble({
  message,
  isOutgoing,
  showSenderHeader = false,
  onRetry,
}: Props) {
  const time = formatBubbleTime(message.created_at);

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

  return (
    <div
      className={`flex w-full gap-2 px-4 py-1 ${
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
        className={`flex max-w-[78%] flex-col gap-1 ${
          isOutgoing ? "items-end" : "items-start"
        }`}
      >
        {showSenderHeader ? (
          <span className="px-3 text-[11px] font-semibold text-[var(--color-fg-secondary)]">
            {message.sender.display_name ?? message.sender.phone}
          </span>
        ) : null}

        <div
          className="flex flex-col gap-1 px-3 py-2 shadow-sm"
          style={{
            backgroundColor: bubbleBg,
            color: bubbleFg,
            borderRadius: 16,
            ...radiusStyle,
          }}
        >
          <span className="whitespace-pre-wrap break-words text-sm leading-snug">
            {message.content}
          </span>
          <div
            className={`flex items-center gap-1 ${
              isOutgoing ? "justify-end" : "justify-start"
            }`}
          >
            <span className="text-[10px]" style={{ color: mutedFg }}>
              {time}
            </span>
            {isOutgoing ? (
              <ReceiptMark
                status={message.status}
                mutedFg={mutedFg}
                onRetry={onRetry ? () => onRetry(message) : undefined}
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function ReceiptMark({
  status,
  mutedFg,
  onRetry,
}: {
  status: Message["status"];
  mutedFg: string;
  onRetry?: () => void;
}) {
  // Live server messages have `status = undefined` → show the "read"
  // tick (accent color), which matches the existing UX of older
  // outgoing messages. Phase 5 will populate status client-side as
  // WS events fire.
  const effective = status ?? "read";

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
  if (effective === "sent") {
    return (
      <Check
        size={14}
        strokeWidth={2.5}
        style={{ color: mutedFg }}
        aria-label="sent"
      />
    );
  }
  if (effective === "delivered") {
    return (
      <CheckCheck
        size={14}
        strokeWidth={2.5}
        style={{ color: mutedFg, opacity: 0.8 }}
        aria-label="delivered"
      />
    );
  }
  // read → accent tint
  return (
    <CheckCheck
      size={14}
      strokeWidth={2.5}
      style={{ color: "var(--color-status-typing)" }}
      aria-label="read"
    />
  );
}
