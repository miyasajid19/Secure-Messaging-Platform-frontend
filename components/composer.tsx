"use client";

/**
 * Message composer.
 *
 * - Auto-grows up to ~5 lines
 * - Enter submits, Shift+Enter inserts a newline
 * - IME-composition safe (uses `compositionStart/End` so typing in
 *   CJK / other IMEs doesn't accidentally submit mid-word)
 * - Disables submit when content is empty
 * - Phase 4: Submit hands the message to the parent's `onSend`, which
 *   optimistically appends to the local message list. Phase 5 swaps
 *   the local append for a real WS call.
 *
 * Layout: paperclip + smiley on the left, textarea filling the middle,
 * send button on the right.
 */

import {
  KeyboardEvent,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Paperclip, Send, Smile } from "lucide-react";
import { toast } from "sonner";
import { type Message, type User } from "@/lib/api";

interface Props {
  conversationId: number | null;
  currentUser: User | null;
  onSend: (msg: Message) => void;
}

const MAX_ROWS = 5;
const LINE_PX = 20; // approximate single-line height in px

export function Composer({ conversationId, currentUser, onSend }: Props) {
  const [value, setValue] = useState("");
  const [composing, setComposing] = useState(false);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-grow the textarea up to MAX_ROWS. Resets to ~1 row when value is
  // cleared.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const max = MAX_ROWS * LINE_PX;
    const next = Math.min(ta.scrollHeight, max);
    ta.style.height = `${next}px`;
  }, [value]);

  function reset() {
    setValue("");
    const ta = taRef.current;
    if (ta) {
      ta.style.height = `${LINE_PX}px`;
      ta.focus();
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!conversationId) return;
    if (!currentUser) return;
    const trimmed = value.trim();
    if (!trimmed) return;

    onSend({
      id: Date.now(),
      conversation_id: conversationId,
      sender_id: currentUser.id,
      sender: currentUser,
      content: trimmed,
      type: "text",
      created_at: new Date().toISOString(),
      parent_id: null,
      attachments: [],
      status: "sending",
    });
    reset();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // IME guard: while composing a CJK character, Enter commits text
    // rather than submitting the message.
    if (event.key === "Enter" && !event.shiftKey && !composing) {
      event.preventDefault();
      const form = event.currentTarget.form;
      if (form) {
        form.requestSubmit();
      }
    }
  }

  const empty = value.trim().length === 0;
  const disabled = !conversationId || empty;
  const sendAria = `Send${disabled ? " (disabled)" : ""}`;

  // Just a visual nudge — paperclip and smiley are placeholders for now.
  function placeholderFeature(name: string) {
    return () => toast.info(`${name} — Phase 4+`, { duration: 2000 });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex items-end gap-2 border-t px-3 py-3"
      style={{ borderColor: "var(--color-border-subtle)" }}
    >
      <button
        type="button"
        onClick={placeholderFeature("Attachments")}
        aria-label="Add attachment"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-tertiary)]"
      >
        <Paperclip size={18} />
      </button>
      <button
        type="button"
        onClick={placeholderFeature("Emoji")}
        aria-label="Open emoji picker"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-tertiary)]"
      >
        <Smile size={18} />
      </button>
      <label className="sr-only" htmlFor="composer-input">
        Message
      </label>
      <textarea
        id="composer-input"
        ref={taRef}
        value={value}
        rows={1}
        placeholder={conversationId ? "Message" : "Select a conversation"}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={() => setComposing(false)}
        disabled={!conversationId}
        className="min-h-9 flex-1 resize-none rounded-2xl border bg-[var(--color-bg-primary)] px-3 py-2 text-sm text-[var(--color-fg-primary)] outline-none focus:ring-2 focus:ring-[var(--color-accent)] disabled:opacity-60"
        style={{
          borderColor: "var(--color-border-subtle)",
          lineHeight: `${LINE_PX}px`,
          maxHeight: `${MAX_ROWS * LINE_PX}px`,
        }}
      />
      <button
        type="submit"
        disabled={disabled}
        aria-label={sendAria}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-50"
        style={{
          backgroundColor: "var(--color-accent)",
          color: "var(--color-accent-fg)",
        }}
      >
        <Send size={16} />
      </button>
    </form>
  );
}
