/**
 * Tiny UI store for shell-level state that doesn't belong to the auth
 * domain: currently just the selected conversation id. Phase 4 will
 * extend this with the active modal / pane state.
 *
 * Kept separate from `store/auth.ts` so the auth store's localStorage
 * shape stays focused on identity, and so future domain stores (e.g.
 * `store/conversations.ts`) can hold their own caching.
 */

import { create } from "zustand";

interface UiState {
  selectedConversationId: number | null;
  setSelected: (id: number | null) => void;
}

export const useUiStore = create<UiState>((set) => ({
  selectedConversationId: null,
  setSelected: (id) => set({ selectedConversationId: id }),
}));
