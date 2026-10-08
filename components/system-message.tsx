"use client";

/**
 * Phase 6 — system message row.
 *
 * Rendered as a centered pill (small grey background), aligned to the
 * timeline of regular messages but with no bubble and no status icon.
 * The backend uses these for group lifecycle events (created, member
 * added/removed, promoted, etc.).
 *
 * We intentionally keep the markup minimal so the chat pane's flex
 * layout doesn't fight with the bubble layout (no `flex-row-reverse`
 * or `justify-end` artefacts from copying `<MessageBubble>`).
 */

import { useMemo } from "react";
import { formatBubbleTime } from "@/lib/format";
import type { Message } from "@/lib/api";

interface Props {
  message: Message;
}

export function SystemMessage({ message }: Props) {
  // The backend crafts the human string for system messages, so we
  // simply render it verbatim. Only the time varies.
  const time = useMemo(
    () => formatBubbleTime(message.created_at),
    [message.created_at],
  );

  return (
    <div
      role="note"
      aria-label="System message"
      className="flex w-full justify-center px-4 py-1"
    >
      <div
        className="max-w-[80%] rounded-full px-3 py-1 text-center text-xs"
        style={{
          backgroundColor: "var(--color-bg-tertiary)",
          color: "var(--color-fg-muted)",
        }}
      >
        <span>{message.content}</span>
        <span className="ml-2" aria-hidden>
          · {time}
        </span>
      </div>
    </div>
  );
}
