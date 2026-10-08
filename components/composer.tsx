"use client";

/**
 * Phase 5 message composer.
 *
 * Send:
 *   - Build a temp `Message` (`id: "temp-<uuid>"`, `status: "sending"`)
 *     and append to the messages cache immediately (optimistic).
 *   - POST to `/conversations/{id}/messages`.
 *   - On 2xx: replace the temp with the server's MessageOut.
 *   - On error: leave the temp in place with `status: "failed"` so the
 *     bubble component can show a retry triangle.
 *
 * Typing:
 *   - On each keystroke, restart a 500ms debounce. When it fires, if
 *     the user hasn't already typed in this conversation, send
 *     `typing.start`.
 *   - After 6s of inactivity (separate timer), send `typing.stop`.
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
import {
  ApiError,
  sendMessage,
  type Message,
  type User,
} from "@/lib/api";
import { getQueryClient, queryKeys } from "@/lib/api";
import { send as realtimeSend } from "@/lib/realtime";

interface Props {
  conversationId: number | null;
  currentUser: User | null;
  onSend: (msg: Message) => void;
}

const MAX_ROWS = 5;
const LINE_PX = 20; // approximate single-line height in px
const TYPING_DEBOUNCE_MS = 500;
const TYPING_IDLE_MS = 6_000;

export function Composer({ conversationId, currentUser, onSend }: Props) {
  const [value, setValue] = useState("");
  const [composing, setComposing] = useState(false);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-grow up to MAX_ROWS.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const max = MAX_ROWS * LINE_PX;
    const next = Math.min(ta.scrollHeight, max);
    ta.style.height = `${next}px`;
  }, [value]);

  // Reset on conversation change.
  useEffect(() => {
    setValue("");
    taRef.current?.focus();
  }, [conversationId]);

  // Typing indicator state. We track whether we've already fired a
  // `typing.start` for this composer instance so debounce doesn't
  // double-send.
  const typingActiveRef = useRef(false);
  const debounceTimerRef = useRef<number | null>(null);
  const idleTimerRef = useRef<number | null>(null);
  const lastConvRef = useRef<number | null>(null);

  function clearTimers() {
    if (debounceTimerRef.current != null) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (idleTimerRef.current != null) {
      window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }

  // Reset typing state when the user navigates to a different conversation.
  useEffect(() => {
    if (lastConvRef.current !== null && lastConvRef.current !== conversationId) {
      // Send typing.stop for the old conversation (if WS is connected).
      if (typingActiveRef.current) {
        realtimeSend({
          type: "typing.stop",
          conversation_id: lastConvRef.current,
        });
        typingActiveRef.current = false;
      }
      clearTimers();
    }
    lastConvRef.current = conversationId;
    // If we leave this composer mounted with active typing, the cleanup
    // function below will also send typing.stop.
    return () => {
      clearTimers();
      if (typingActiveRef.current && conversationId != null) {
        realtimeSend({
          type: "typing.stop",
          conversation_id: conversationId,
        });
        typingActiveRef.current = false;
      }
    };
  }, [conversationId]);

  function noteTyping() {
    if (conversationId == null) return;
    // Debounce 500ms before announcing typing.start.
    if (debounceTimerRef.current != null) window.clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = window.setTimeout(() => {
      debounceTimerRef.current = null;
      if (!typingActiveRef.current) {
        const ok = realtimeSend({
          type: "typing.start",
          conversation_id: conversationId,
        });
        if (ok) typingActiveRef.current = true;
      }
    }, TYPING_DEBOUNCE_MS);

    // Reset the 6s idle timer that fires typing.stop.
    if (idleTimerRef.current != null) window.clearTimeout(idleTimerRef.current);
    idleTimerRef.current = window.setTimeout(() => {
      idleTimerRef.current = null;
      if (typingActiveRef.current && conversationId != null) {
        realtimeSend({
          type: "typing.stop",
          conversation_id: conversationId,
        });
        typingActiveRef.current = false;
      }
    }, TYPING_IDLE_MS);
  }

  function handleChange(text: string) {
    setValue(text);
    if (text.length > 0) noteTyping();
    else if (typingActiveRef.current && conversationId != null) {
      // Empty box → announce stop immediately, no debounce.
      realtimeSend({ type: "typing.stop", conversation_id: conversationId });
      typingActiveRef.current = false;
      clearTimers();
    }
  }

  function reset() {
    setValue("");
    const ta = taRef.current;
    if (ta) {
      ta.style.height = `${LINE_PX}px`;
      ta.focus();
    }
    if (typingActiveRef.current && conversationId != null) {
      realtimeSend({ type: "typing.stop", conversation_id: conversationId });
      typingActiveRef.current = false;
    }
    clearTimers();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!conversationId) return;
    if (!currentUser) return;
    const trimmed = value.trim();
    if (!trimmed) return;

    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const optimistic: Message = {
      id: Number.NaN, // Mark this as a pending row; backend uses numeric ids only
      conversation_id: conversationId,
      sender_id: currentUser.id,
      sender: currentUser,
      content: trimmed,
      type: "text",
      created_at: new Date().toISOString(),
      parent_id: null,
      attachments: [],
      status: "sending",
    };

    // Optimistic append to the React Query cache. The chat pane reads
    // from this cache; there's no separate local-overlay path on
    // Phase 5 — the `onSend` callback is kept as a prop for future
    // shortcuts (e.g. a Cmd+K send) but isn't wired here.
    const qc = getQueryClient();
    qc.setQueryData<Message[]>(
      queryKeys.messages(conversationId),
      (prev) => [...(prev ?? []), optimistic],
    );
    void onSend; // reserved for future shortcuts; not used by the cache path

    reset();

    try {
      const real = await sendMessage(conversationId, {
        content: trimmed,
        type: "text",
        parent_id: null,
      });
      // Replace optimistic with server message.
      qc.setQueryData<Message[]>(
        queryKeys.messages(conversationId),
        (prev) => {
          if (!prev) return [real];
          return prev.map((m) =>
            Object.is(m.id, optimistic.id) ||
            // Compare by created_at + content as a fallback, since we
            // synthesised non-numeric ids optimistically.
            (m.content === real.content && m.sender_id === real.sender_id &&
             m.created_at === optimistic.created_at)
              ? real
              : m,
          );
        },
      );
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Couldn't send message";
      // Mark the bubble as failed so the user can retry.
      qc.setQueryData<Message[]>(
        queryKeys.messages(conversationId),
        (prev) => {
          if (!prev) return prev;
          return prev.map((m) =>
            m.content === trimmed && m.sender_id === currentUser.id &&
            m.created_at === optimistic.created_at
              ? { ...m, status: "failed" as const }
              : m,
          );
        },
      );
      toast.error(msg);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !composing) {
      event.preventDefault();
      const form = event.currentTarget.form;
      if (form) {
        form.requestSubmit();
      }
    }
  }

  const empty = value.trim().length === 0;
  const disabled = !conversationId || empty || !currentUser;
  const sendAria = `Send${disabled ? " (disabled)" : ""}`;

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
        onChange={(e) => handleChange(e.target.value)}
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
