"use client";

/**
 * Phase 8 — Messenger-style "seen by" avatar row.
 *
 * Used below outgoing bubbles in group chats to show who has read the
 * message. Caps visible avatars at `maxVisible` (default 10); if
 * `users.length > maxVisible`, the last slot becomes a `+N` pill that
 * opens a popover listing the rest.
 *
 * Visual: 20px overlapping circles, with a ring in
 * `--color-bg-elevated` to separate from the background. All colors
 * via `tokens.css` — no hex literals.
 */

import { useEffect, useRef, useState } from "react";
import { Avatar } from "./avatar";
import type { User } from "@/lib/api";

interface SeenByAvatarsProps {
  users: User[];
  maxVisible?: number;
  align?: "left" | "right";
}

const AVATAR_SIZE = 20;
const AVATAR_OVERLAP = 8;

export function SeenByAvatars({
  users,
  maxVisible = 10,
  align = "right",
}: SeenByAvatarsProps) {
  if (users.length === 0) return null;

  const overflowCount = Math.max(0, users.length - maxVisible);
  // If there are too many users, leave room for the "+N" pill.
  const visible = overflowCount > 0 ? users.slice(0, maxVisible - 1) : users.slice(0, maxVisible);

  return (
    <div
      className={`mt-1 flex items-center gap-0 ${align === "right" ? "justify-end" : "justify-start"}`}
      aria-label={`Seen by ${users.length} ${users.length === 1 ? "person" : "people"}`}
      title={users.map((u) => u.display_name ?? u.phone).join(", ")}
    >
      {visible.map((u, i) => (
        <span
          key={u.id}
          style={{
            marginLeft: i === 0 ? 0 : -AVATAR_OVERLAP,
            zIndex: visible.length - i,
          }}
        >
          <Avatar
            subject={{
              avatar_url: u.avatar_url,
              display_name: u.display_name ?? u.phone ?? "?",
              last_seen: u.last_seen,
            }}
            size={AVATAR_SIZE}
            showOnline={false}
          />
        </span>
      ))}
      {overflowCount > 0 ? (
        <OverflowPill
          count={overflowCount}
          remaining={users.slice(maxVisible - 1)}
        />
      ) : null}
    </div>
  );
}

/**
 * The "+N" pill. Renders the count, opens a small popover on click
 * with the remaining names listed. Closes on outside click / Esc.
 */
function OverflowPill({ count, remaining }: { count: number; remaining: User[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(e: MouseEvent) {
      if (!ref.current) return;
      if (ref.current.contains(e.target as Node)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  return (
    <span
      ref={ref}
      className="relative inline-block"
      style={{ marginLeft: -AVATAR_OVERLAP, zIndex: 0 }}
    >
      <button
        type="button"
        aria-label={`${count} more ${count === 1 ? "person" : "people"}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-center rounded-full text-[10px] font-semibold"
        style={{
          width: AVATAR_SIZE,
          height: AVATAR_SIZE,
          backgroundColor: "var(--color-accent)",
          color: "var(--color-accent-fg)",
        }}
      >
        +{count}
      </button>
      {open ? (
        <div
          role="menu"
          aria-label={`${count} more viewers`}
          className="absolute top-full z-50 mt-1 w-56 overflow-hidden rounded-lg border bg-[var(--color-bg-elevated)] py-1 shadow-lg"
          style={{
            right: 0,
            borderColor: "var(--color-border-subtle)",
          }}
        >
          <div
            className="px-3 py-1 text-[11px] font-semibold uppercase"
            style={{ color: "var(--color-fg-muted)" }}
          >
            Seen by
          </div>
          <ul className="max-h-60 overflow-y-auto">
            {remaining.map((u) => (
              <li
                key={u.id}
                className="flex items-center gap-2 px-3 py-1.5 text-sm"
                style={{ color: "var(--color-fg-primary)" }}
              >
                <span className="w-6">
                  <Avatar
                    subject={{
                      avatar_url: u.avatar_url,
                      display_name: u.display_name ?? u.phone ?? "?",
                      last_seen: u.last_seen,
                    }}
                    size={16}
                    showOnline={false}
                  />
                </span>
                <span className="truncate">
                  {u.display_name ?? u.phone ?? "Unknown"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </span>
  );
}
