/**
 * Round avatar with an optional online dot.
 *
 * Two render branches:
 *   - avatar URL is present and not yet known-broken  →  <img>
 *   - otherwise                                      →  initials in a
 *     placeholder disk (tertiary bg)
 *
 * We never render `<img src="">`, which triggers a Next.js warning
 * and an unwanted page re-fetch in some browsers. The two branches
 * alternate on a single piece of state (`imgBroken`) that flips to
 * true on `onError`.
 *
 * Phase 5 wiring: pass `online={isUserOnline(userId)}` to override
 * the `last_seen` heuristic. When `online` is provided as a boolean
 * it wins (so a recently active user whose WS just disconnected gets
 * the offline dot back immediately).
 */

import { useState } from "react";

interface AvatarProps {
  subject: {
    avatar_url: string | null;
    display_name: string;
    last_seen?: string | null;
  };
  size?: number;
  showOnline?: boolean;
  onlineThresholdMs?: number;
  /** Phase 5 explicit online flag, sourced from the WS presence store. */
  online?: boolean;
}

export function Avatar({
  subject,
  size = 40,
  showOnline = true,
  onlineThresholdMs = 5 * 60 * 1000,
  online,
}: AvatarProps) {
  const initials = (subject.display_name || "?")
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const isOnline =
    online !== undefined
      ? Boolean(showOnline && online)
      : Boolean(
          showOnline &&
            subject.last_seen &&
            Date.now() - new Date(subject.last_seen).getTime() < onlineThresholdMs,
        );

  const [imgBroken, setImgBroken] = useState(false);
  // If `avatar_url` is null/empty we never mount the img — this is the
  // half that fixes the warning. `imgBroken` covers the failure
  // (404/expired URL) case.
  const showImg = Boolean(subject.avatar_url) && !imgBroken;

  return (
    <span
      className="relative inline-flex shrink-0"
      style={{ width: size, height: size }}
      aria-label={subject.display_name}
    >
      {showImg ? (
        <img
          src={subject.avatar_url as string}
          alt=""
          width={size}
          height={size}
          className="rounded-full bg-[var(--color-bg-tertiary)] object-cover"
          style={{ width: size, height: size }}
          onError={() => setImgBroken(true)}
        />
      ) : (
        <span
          aria-hidden
          className="absolute inset-0 flex items-center justify-center rounded-full font-semibold"
          style={{
            backgroundColor: "var(--color-bg-tertiary)",
            color: "var(--color-fg-secondary)",
            fontSize: size * 0.36,
          }}
        >
          {initials}
        </span>
      )}
      {isOnline ? (
        <span
          aria-hidden
          className="absolute right-0 bottom-0 rounded-full ring-2 ring-[var(--color-bg-primary)]"
          style={{
            backgroundColor: "var(--color-status-online)",
            width: Math.max(8, size * 0.28),
            height: Math.max(8, size * 0.28),
          }}
        />
      ) : null}
    </span>
  );
}
