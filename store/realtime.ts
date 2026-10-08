/**
 * Zustand store for ephemeral realtime state — typing indicators and
 * online presence — that the WS client mutates.
 *
 * Both maps are intentionally loose: keys may be missing if no user in
 * a conversation is typing, or if the WS hasn't told us about a user
 * yet. Components check truthiness rather than defaulting to false.
 *
 * Kept separate from `store/auth.ts` (identity) and `store/ui.ts`
 * (selection) per the locked "small stores" guideline.
 */

import { create } from "zustand";

interface RealtimeState {
  typingByConversation: Record<number, Record<number, true>>;
  presenceByUser: Record<number, boolean>;
  /**
   * True once the WS has fully registered (i.e. we've received the
   * `presence.snapshot` the server sends on connect). Used by the
   * composer to gate sends: until WS is ready, outgoing POSTs would
   * race the broadcast and the sender's own message would be lost
   * (Phase 5 race). Phase 6 spec §1.
   */
  wsReady: boolean;

  // typing
  setTypingStart: (conversationId: number, userId: number) => void;
  setTypingStop: (conversationId: number, userId: number) => void;
  clearTypingForConversation: (conversationId: number) => void;
  isAnyoneTyping: (conversationId: number, excludeUserId?: number | null) => number[];

  // presence
  setPresence: (userId: number, online: boolean) => void;
  setPresenceSnapshot: (ids: number[]) => void;

  // ws lifecycle
  setWsReady: (ready: boolean) => void;

  clear: () => void;
}

export const useRealtimeStore = create<RealtimeState>((set, get) => ({
  typingByConversation: {},
  presenceByUser: {},
  wsReady: false,

  setTypingStart: (conversationId, userId) => {
    set((s) => ({
      typingByConversation: {
        ...s.typingByConversation,
        [conversationId]: {
          ...(s.typingByConversation[conversationId] ?? {}),
          [userId]: true,
        },
      },
    }));
  },

  setTypingStop: (conversationId, userId) => {
    set((s) => {
      const cur = s.typingByConversation[conversationId];
      if (!cur || !cur[userId]) return s;
      const next = { ...cur };
      delete next[userId];
      const nextOuter = { ...s.typingByConversation };
      if (Object.keys(next).length === 0) {
        delete nextOuter[conversationId];
      } else {
        nextOuter[conversationId] = next;
      }
      return { typingByConversation: nextOuter };
    });
  },

  clearTypingForConversation: (conversationId) => {
    set((s) => {
      const next = { ...s.typingByConversation };
      delete next[conversationId];
      return { typingByConversation: next };
    });
  },

  // Returns the user_ids typing in `conversationId`, optionally
  // excluding one (so the sender's own typing doesn't render in their
  // own chat pane header).
  isAnyoneTyping: (conversationId, excludeUserId) => {
    const cur = get().typingByConversation[conversationId];
    if (!cur) return [];
    const ids = Object.keys(cur).map((k) => Number(k));
    return excludeUserId == null
      ? ids
      : ids.filter((id) => id !== excludeUserId);
  },

  setPresence: (userId, online) => {
    set((s) => ({
      presenceByUser: { ...s.presenceByUser, [userId]: online },
    }));
  },

  setPresenceSnapshot: (ids) => {
    // Trust the snapshot as the canonical state: any user not in the
    // snapshot is treated as offline.
    set(() => {
      const presenceByUser: Record<number, boolean> = {};
      for (const id of ids) presenceByUser[id] = true;
      return { presenceByUser };
    });
  },

  setWsReady: (ready) => {
    set({ wsReady: ready });
  },

  clear: () => {
    set(() => ({
      typingByConversation: {},
      presenceByUser: {},
      wsReady: false,
    }));
  },
}));
