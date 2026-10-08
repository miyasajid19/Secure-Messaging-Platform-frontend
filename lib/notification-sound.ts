/**
 * Phase 7 — notification-sound toggle + chime playback.
 *
 * Two pieces:
 *
 * 1. **Toggle state** — persisted in `localStorage` under
 *    `signal-clone:notification-sound`. Read on mount via
 *    `useState`'s lazy initializer; updated on toggle. SSR-safe.
 *
 * 2. **Playback** — `playChime()` synthesises a 200ms sine-wave
 *    chime via the Web Audio API (no asset file needed; works fully
 *    offline). The toggle's `supported` flag flips to `false` only if
 *    `AudioContext` is unavailable (very old browsers, JSDOM, etc.).
 *
 * The hook returns a small surface for components:
 *   - `enabled`     — boolean reflecting the toggle
 *   - `setEnabled`  — flip it
 *   - `playChime()` — call when an off-focus message arrives
 *   - `supported`   — false → toggle is disabled
 *
 * The actual <audio>-on-message-new wiring lives in `lib/realtime.ts`
 * so the call site doesn't need to know about the hook.
 */

"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "signal-clone:notification-sound";

function readPersisted(): boolean | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw === "1";
}

let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (audioCtx) return audioCtx;
  // Lazy — don't pay the AudioContext cost until the first chime.
  const Ctor: typeof AudioContext | undefined =
    window.AudioContext ||
    // Safari legacy prefix
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;
  audioCtx = new Ctor();
  return audioCtx;
}

export function useNotificationSound() {
  // SSR-safe: keep `enabled` as `null` on the server and on the very
  // first client render. Hydrate from localStorage in a `useEffect`
  // so SSR HTML and the first client render agree. Avoids the
  // "checked" attribute hydration mismatch (React 19 doesn't always
  // patch the `checked` property post-hydration).
  const [enabled, setEnabledState] = useState<boolean | null>(null);
  const [supported, setSupported] = useState<boolean>(true);

  // Hydrate from localStorage on mount.
  useEffect(() => {
    setEnabledState(readPersisted() ?? false);
  }, []);

  // Detect support — must run after the AudioContext probe.
  useEffect(() => {
    setSupported(getCtx() != null);
  }, []);

  // Wrap setEnabled so persistence happens in the click handler,
  // not in a useEffect. Avoids the effect-rewrite-of-default race.
  const setEnabled = (next: boolean) => {
    setEnabledState(next);
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
  };

  function playChime() {
    if (!enabled) return;
    const ctx = getCtx();
    if (!ctx) return;
    // Lazy-resume — most browsers require a user gesture to start
    // audio, and even after one, suspended contexts need an explicit
    // resume call.
    if (ctx.state === "suspended") void ctx.resume();
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(660, t0); // E5
    osc.frequency.exponentialRampToValueAtTime(880, t0 + 0.05); // A5
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.18, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.22);
  }

  return { enabled, setEnabled, playChime, supported };
}
