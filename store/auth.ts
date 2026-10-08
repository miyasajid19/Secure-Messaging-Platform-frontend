/**
 * Zustand auth store.
 *
 * Holds the JWT + User, persisted manually to `localStorage` under the
 * `signal-clone:` prefix. We deliberately avoid the `zustand/middleware`
 * `persist` because it tries to read `localStorage` during module
 * evaluation — which crashes the moment this module is imported by a
 * Server Component in the App Router (no `window`).
 *
 * Pattern:
 *   - `useAuthStore` is the React-bound store
 *   - `hydrate()` reads `localStorage` and marks the store hydrated;
 *     call it once from a client-side `useEffect` at app root
 *   - `clear()` and `setAuth()` both write through to `localStorage`
 *   - `useAuthStore.getState()` works from non-React code (e.g. `apiFetch`)
 *     without subscribing — handy for one-shot reads inside event handlers
 *
 * Spec: @task.md §3 ("Auth store").
 */

import { create } from "zustand";
import type { User } from "@/lib/api";

const TOKEN_KEY = "signal-clone:token";
const USER_KEY = "signal-clone:user";

interface StoredUser {
  id: number;
  phone: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  created_at: string;
  last_seen: string | null;
}

export interface AuthState {
  token: string | null;
  user: User | null;
  hydrated: boolean;
  setAuth: (token: string, user: User) => void;
  clear: () => void;
  hydrate: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  user: null,
  hydrated: false,
  setAuth: (token, user) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(TOKEN_KEY, token);
      window.localStorage.setItem(USER_KEY, JSON.stringify(user));
    }
    set({ token, user, hydrated: true });
  },
  clear: () => {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(TOKEN_KEY);
      window.localStorage.removeItem(USER_KEY);
    }
    set({ token: null, user: null, hydrated: true });
  },
  hydrate: () => {
    if (typeof window === "undefined") {
      // Server safety net — never reach `localStorage` here.
      return;
    }
    const token = window.localStorage.getItem(TOKEN_KEY);
    const userRaw = window.localStorage.getItem(USER_KEY);
    let user: User | null = null;
    if (userRaw) {
      try {
        user = JSON.parse(userRaw) as StoredUser;
      } catch {
        user = null;
        window.localStorage.removeItem(USER_KEY);
      }
    }
    set({ token: token ?? null, user, hydrated: true });
  },
}));

/** Selector — `useAuthStore(selectIsAuthenticated)` re-renders on auth flips. */
export const selectIsAuthenticated = (s: AuthState) => s.token !== null;

/** Selector — gets the current user without subscribing. */
export const selectUser = (s: AuthState) => s.user;
