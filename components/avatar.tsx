/**
 * Round avatar with an optional online dot.
 *
 * Phase 5 wiring: pass `online={isUserOnline(userId)}` to override the
 * `last_seen` heuristic. When `online` is provided as a boolean it
 * wins (so a recently active user whose WS just disconnected gets the
 * offline dot back immediately).
 */

interface AvatarProps {
  subject: {
    avatar_url: string;
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

  return (
    <span
      className="relative inline-flex shrink-0"
      style={{ width: size, height: size }}
      aria-label={subject.display_name}
    >
      {/* The avatar itself — image with initials fallback via
          `onError`. Using an inline <img> keeps the component pure
          client-side and avoids `next/image` config for Phase 3
          (placeholder raster URLs aren't worth the optimization). */}
      <img
        src={subject.avatar_url}
        alt=""
        width={size}
        height={size}
        className="rounded-full bg-[var(--color-bg-tertiary)] object-cover"
        style={{ width: size, height: size }}
        onError={(e) => {
          const target = e.currentTarget;
          target.style.display = "none";
          const fallback = target.nextElementSibling as HTMLElement | null;
          if (fallback) fallback.style.display = "flex";
        }}
      />
      <span
        aria-hidden
        className="absolute inset-0 hidden items-center justify-center rounded-full text-xs font-semibold text-[var(--color-fg-secondary)]"
        style={{
          backgroundColor: "var(--color-bg-tertiary)",
          fontSize: size * 0.36,
        }}
      >
        {initials}
      </span>
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
