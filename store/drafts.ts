import { create } from "zustand";

interface DraftState {
  drafts: Record<number, string>;
  setDraft: (conversationId: number, value: string) => void;
  clearDraft: (conversationId: number) => void;
}

export const useDraftStore = create<DraftState>((set) => ({
  drafts: {},
  setDraft: (conversationId, value) =>
    set((state) => {
      const drafts = { ...state.drafts };
      if (value.trim()) drafts[conversationId] = value;
      else delete drafts[conversationId];
      return { drafts };
    }),
  clearDraft: (conversationId) =>
    set((state) => {
      if (!(conversationId in state.drafts)) return state;
      const drafts = { ...state.drafts };
      delete drafts[conversationId];
      return { drafts };
    }),
}));
