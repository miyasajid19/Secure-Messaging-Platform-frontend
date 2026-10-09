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
import { Loader2, Paperclip, Send, Smile, X } from "lucide-react";
import { toast } from "sonner";
import {
  ApiError,
  sendMessage,
  uploadMessageAttachments,
  type Message,
  type User,
} from "@/lib/api";
import { getQueryClient, queryKeys } from "@/lib/api";
import { send as realtimeSend } from "@/lib/realtime";
import { useRealtimeStore } from "@/store/realtime";
import { useReplyStore } from "@/store/reply";
import { useDraftStore } from "@/store/drafts";

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
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const setDraft = useDraftStore((s) => s.setDraft);
  const activeConversationRef = useRef<number | null>(null);
  // wsReady gates sends per Phase 6 §1: we never POST a message
  // before the WS has finished registering, otherwise the sender
  // won't get the broadcast and the bubble appears nowhere.
  const wsReady = useRealtimeStore((s) => s.wsReady);
  // Phase 8.1 — quoted-parent preview bar.
  const replyingTo = useReplyStore((s) => s.replyingTo);
  const clearReply = useReplyStore((s) => s.clear);

  // Auto-grow up to MAX_ROWS.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const max = MAX_ROWS * LINE_PX;
    const next = Math.min(ta.scrollHeight, max);
    ta.style.height = `${next}px`;
  }, [value]);

  // Keep unsent text with its conversation and restore it when returning.
  useEffect(() => {
    const previousConversationId = activeConversationRef.current;
    if (previousConversationId === conversationId) return;
    if (previousConversationId !== null) {
      setDraft(previousConversationId, value);
    }
    activeConversationRef.current = conversationId;
    setValue(
      conversationId === null
        ? ""
        : useDraftStore.getState().drafts[conversationId] ?? "",
    );
    setSelectedFiles([]);
    taRef.current?.focus();
  }, [conversationId, setDraft, value]);

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
    if (conversationId !== null) setDraft(conversationId, text);
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
    if (conversationId !== null) {
      useDraftStore.getState().clearDraft(conversationId);
    }
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
    const filesToSend = selectedFiles;
    if (!trimmed && filesToSend.length === 0) return;
    if (uploading) return;

    // Phase 8.1 — read reply state right before the POST so we
    // capture the value and can clear it after a successful send.
    const reply = useReplyStore.getState().replyingTo;
    const parentIdForSend =
      reply && reply.conversation_id === conversationId ? reply.id : null;

    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const optimistic: Message = {
      id: Number.NaN, // Mark this as a pending row; backend uses numeric ids only
      conversation_id: conversationId,
      sender_id: currentUser.id,
      sender: currentUser,
      content: trimmed || "Sending attachment…",
      type: filesToSend.some((file) => file.type.startsWith("image/")) ? "image" : "text",
      created_at: new Date().toISOString(),
      parent_id: parentIdForSend,
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

    if (filesToSend.length === 0) reset();
    setUploading(filesToSend.length > 0);

    try {
      const attachments = filesToSend.length
        ? await uploadMessageAttachments(conversationId, filesToSend)
        : [];
      const real = await sendMessage(conversationId, {
        content: trimmed,
        type: attachments.some((attachment) => attachment.mime.startsWith("image/")) ? "image" : "text",
        parent_id: parentIdForSend,
        attachments,
      });
      // Reply state is cleared on a successful send.
      if (parentIdForSend) useReplyStore.getState().clear();
      // Replace optimistic with server message. Idempotent: if the
      // server's WS `message.new` has already pushed the same id (it
      // does, since the sender is a participant), dedup instead of
      // appending a second copy.
      qc.setQueryData<Message[]>(
        queryKeys.messages(conversationId),
        (prev) => {
          if (!prev) return [real];
          // Drop any prior copy of this server id AND our local
          // optimistic row (status === "sending"), then append the
          // canonical server row. Handles all three races:
          //   - WS `message.new` already pushed the real before
          //     POST returned
          //   - POST returned before WS pushed (we already replaced
          //     the optimistic; WS appends a dup if we didn't filter)
          //   - Optimistic still in cache (id=NaN, status="sending")
          const without =
            prev.filter((m) => m.id !== real.id && m.status !== "sending");
          return [...without, real];
        },
      );
      if (filesToSend.length > 0) {
        reset();
        setSelectedFiles([]);
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Couldn't send message";
      if (filesToSend.length > 0) {
        qc.setQueryData<Message[]>(
          queryKeys.messages(conversationId),
          (prev) => prev?.filter((message) => message.created_at !== optimistic.created_at),
        );
        toast.error(msg);
        return;
      }
      // Mark the bubble as failed so the user can retry.
      qc.setQueryData<Message[]>(
        queryKeys.messages(conversationId),
        (prev) => {
          if (!prev) return prev;
          return prev.map((m) =>
            m.sender_id === currentUser.id &&
            m.created_at === optimistic.created_at
              ? { ...m, status: "failed" as const }
              : m,
          );
        },
      );
      toast.error(msg);
    } finally {
      setUploading(false);
    }
  }

  function addFiles(fileList: FileList | null) {
    if (!fileList) return;
    const incoming = Array.from(fileList);
    const accepted = incoming.filter((file) => {
      if (file.size === 0 || file.size > 25 * 1024 * 1024) {
        toast.error(`${file.name} must be between 1 byte and 25 MB`);
        return false;
      }
      return true;
    });
    setSelectedFiles((current) => {
      const available = Math.max(0, 10 - current.length);
      if (accepted.length > available) {
        toast.error("You can attach up to 10 files per message");
      }
      const next = [...current, ...accepted.slice(0, available)];
      if (next.reduce((total, file) => total + file.size, 0) > 50 * 1024 * 1024) {
        toast.error("Attachments must total 50 MB or less");
        return current;
      }
      return next;
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !composing) {
      event.preventDefault();
      // Phase 6 §1: don't submit while WS is still connecting.
      if (!wsReady) {
        toast.info("Connecting to the server — try again in a moment.");
        return;
      }
      const form = event.currentTarget.form;
      if (form) {
        form.requestSubmit();
      }
    }
  }

  const empty = value.trim().length === 0 && selectedFiles.length === 0;
  const disabled = !conversationId || empty || !currentUser || !wsReady || uploading;
  const sendAria = uploading ? "Uploading attachments" : `Send${disabled ? " (disabled)" : ""}`;

  function placeholderFeature(name: string) {
    return () => toast.info(`${name} — coming soon`, { duration: 2000 });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-0 border-t"
      style={{
        borderColor: "var(--color-border-subtle)",
        opacity: wsReady ? 1 : 0.75,
      }}
    >
      {/* Phase 8.1 — quoted-parent preview bar. */}
      {replyingTo && replyingTo.conversation_id === conversationId ? (
        <div
          aria-label="Replying to"
          className="flex items-center gap-2 border-b px-3 py-2"
          style={{ borderColor: "var(--color-border-subtle)" }}
        >
          <div
            aria-hidden
            className="w-1 self-stretch rounded-full"
            style={{ backgroundColor: "var(--color-accent)" }}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold" style={{ color: "var(--color-fg-primary)" }}>
              Replying to {replyingTo.sender_name ?? "Unknown"}
            </p>
            <p className="truncate text-xs" style={{ color: "var(--color-fg-secondary)" }}>
              {replyingTo.type === "image" ? "Photo" : replyingTo.content}
            </p>
          </div>
          <button
            type="button"
            aria-label="Cancel reply"
            onClick={clearReply}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-tertiary)]"
          >
            <X size={14} />
          </button>
        </div>
      ) : null}
      {selectedFiles.length > 0 ? (
        <div className="flex flex-wrap gap-2 px-3 pt-2" aria-label="Selected attachments">
          {selectedFiles.map((file, index) => (
            <span key={`${file.name}-${file.lastModified}-${index}`} className="flex max-w-full items-center gap-1 rounded-lg border px-2 py-1 text-xs text-[var(--color-fg-secondary)]" style={{ borderColor: "var(--color-border-subtle)" }}>
              <span className="max-w-48 truncate">{file.name}</span>
              <button type="button" aria-label={`Remove ${file.name}`} onClick={() => setSelectedFiles((current) => current.filter((_, i) => i !== index))} className="rounded p-0.5 hover:bg-[var(--color-bg-tertiary)]"><X size={12} /></button>
            </span>
          ))}
        </div>
      ) : null}
      <div
        className="flex items-end gap-2 px-3 py-3"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="sr-only"
        aria-label="Choose files to attach"
        onChange={(event) => addFiles(event.currentTarget.files)}
      />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        aria-label="Add attachment"
        disabled={!conversationId || uploading}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-tertiary)] active:bg-[var(--color-bg-tertiary)]"
      >
        <Paperclip size={18} />
      </button>
      <button
        type="button"
        onClick={placeholderFeature("Emoji")}
        aria-label="Open emoji picker"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-tertiary)] active:bg-[var(--color-bg-tertiary)]"
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
        placeholder={
          !wsReady
            ? "Connecting to the server…"
            : conversationId
              ? "Message"
              : "Select a conversation"
        }
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={onKeyDown}
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={() => setComposing(false)}
        disabled={!conversationId || uploading}
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
        title={!wsReady ? "Connecting…" : "Send"}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition active:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        style={{
          backgroundColor: "var(--color-accent)",
          color: "var(--color-accent-fg)",
        }}
      >
        {wsReady && !uploading ? (
          <Send size={16} />
        ) : (
          <Loader2
            size={16}
            className="animate-spin"
            aria-label="Connecting to server"
          />
        )}
      </button>
      </div>
    </form>
  );
}
