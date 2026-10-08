"use client";

/**
 * Phase 8.3 — dark-mode toggle.
 *
 * Persists choice in `localStorage` under `signal-clone:theme`. The
 * provider in `app/providers.tsx` reads it on mount and sets
 * `document.documentElement.dataset.theme = 'dark' | 'light'`. The
 * settings UI calls `setTheme` to flip it.
 *
 * Token defaults: `:root { ... }` in `app/tokens.css` is light.
 * `[data-theme="dark"] { ... }` overrides the same token names with
 * dark values. No component changes needed — they already read
 * `var(--color-…)`.
 */

import { useEffect, useState } from "react";

const STORAGE_KEY = "signal-clone:theme";

export type Theme = "light" | "dark";

function readPersisted(): Theme {
  if (typeof window === "undefined") return "light";
  return localStorage.getItem(STORAGE_KEY) === "dark" ? "dark" : "light";
}

function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  if (theme === "dark") {
    document.documentElement.dataset.theme = "dark";
  } else {
    delete document.documentElement.dataset.theme;
  }
}

export function useTheme(): {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
} {
  // Hydrate from localStorage on mount to match the SSR-safe pattern
  // used in `useNotificationSound`.
  const [theme, setThemeState] = useState<Theme>("light");

  useEffect(() => {
    const t = readPersisted();
    setThemeState(t);
    applyTheme(t);
  }, []);

  function setTheme(t: Theme) {
    setThemeState(t);
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, t);
    }
    applyTheme(t);
  }

  return {
    theme,
    setTheme,
    toggle: () => setTheme(theme === "dark" ? "light" : "dark"),
  };
}
