/**
 * Phase 8.1 — "replying to" state.
 *
 * Holds a small snapshot of the message the user wants to reply to so
 * the composer can show a quote preview and include `parent_id` in
 * the POST body. The store is *not* persisted to localStorage: a
 * reply context shouldn't survive a reload.
 *
 * Kept conversation-scoped — the `setReplyingTo` action is called
 * with both the parent id and a small payload. The composer reads
 * the payload as-is (no need to re-look-up the parent in the cache).
 *
 * `clear()` is exposed so the chat-pane can wipe the reply context
 * when the user switches conversations (Phase 8.1 §4).
 */

import { create } from "zustand";

export type MessageType = "text" | "image" | "system";

export interface ReplyTarget {
  /** The parent message's id — used as `parent_id` on POST. */
  id: number;
  /** The conversation id — used to invalidate stale reply state on
   *  conversation switch. */
  conversation_id: number;
  /** Display name of the parent message's sender. */
  sender_name: string | null;
  /** First ~120 chars of the parent's content (the backend already
   *  truncates; we just render). */
  content: string;
  type: MessageType;
}

interface ReplyState {
  replyingTo: ReplyTarget | null;
  setReplyingTo: (target: ReplyTarget) => void;
  clear: () => void;
}

export const useReplyStore = create<ReplyState>((set) => ({
  replyingTo: null,
  setReplyingTo: (target) => set({ replyingTo: target }),
  clear: () => set({ replyingTo: null }),
}));
