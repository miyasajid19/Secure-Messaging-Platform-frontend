"use client";

/**
 * Vertical icon navigation (~60px wide) on the far left of the shell.
 *
 * Phase 3 just renders placeholders for non-Chats sections — clicking
 * them does nothing yet. The user's avatar sits at the bottom and
 * opens the logout menu on hover/focus.
 *
 * Spec: §2 ("left rail").
 */

import { useState } from "react";
import {
  BookOpen,
  LogOut,
  MessageCircle,
  Phone,
  Settings,
  User as UserIcon,
} from "lucide-react";
import { Avatar } from "./avatar";
import { useAuthStore } from "@/store/auth";
import { useRouter } from "next/navigation";

type RailKey = "chats" | "calls" | "stories" | "settings";

const railIcons: Array<{ key: RailKey; label: string; Icon: typeof MessageCircle }> = [
  { key: "chats", label: "Chats", Icon: MessageCircle },
  { key: "calls", label: "Calls", Icon: Phone },
  { key: "stories", label: "Stories", Icon: BookOpen },
  { key: "settings", label: "Settings", Icon: Settings },
];

export function LeftRail() {
  const [active, setActive] = useState<RailKey>("chats");
  const router = useRouter();
  const clear = useAuthStore((s) => s.clear);
  const storedUser = useAuthStore((s) => s.user);
  // Phase 4 keeps the rail presentational; the avatar subject falls back
  // to a generic "?" if the user isn't hydrated yet (briefly, on first
  // paint after login).
  const me =
    storedUser ?? {
      avatar_url: "",
      display_name: "?",
      last_seen: null,
    };

  function logout() {
    clear();
    router.replace("/auth/phone");
  }

  return (
    <nav
      aria-label="Primary"
      className="flex h-full w-[68px] shrink-0 flex-col items-center justify-between border-r py-4"
      style={{
        backgroundColor: "var(--color-bg-primary)",
        borderColor: "var(--color-border-subtle)",
      }}
    >
      <ul className="flex flex-col items-center gap-3">
        {railIcons.map(({ key, label, Icon }) => {
          const isActive = active === key;
          return (
            <li key={key}>
              <button
                type="button"
                aria-label={label}
                aria-current={isActive ? "page" : undefined}
                title={label}
                onClick={() => setActive(key)}
                className="flex h-11 w-11 items-center justify-center rounded-full transition"
                style={{
                  backgroundColor: isActive
                    ? "var(--color-bg-tertiary)"
                    : "transparent",
                  color: isActive
                    ? "var(--color-accent)"
                    : "var(--color-fg-secondary)",
                }}
              >
                <Icon size={20} />
              </button>
            </li>
          );
        })}
      </ul>

      <div className="group relative">
        <button
          type="button"
          aria-label="Account menu"
          className="rounded-full"
        >
          <Avatar
            subject={{
              avatar_url: me.avatar_url ?? "",
              display_name: me.display_name ?? "?",
              last_seen: me.last_seen ?? null,
            }}
            size={36}
            showOnline
          />
        </button>
        {/* Popover that opens on hover/focus — fine-grained menu lives in Phase 7. */}
        <div
          className="absolute right-full top-1/2 mr-2 -translate-y-1/2 hidden items-center gap-2 rounded-lg border bg-[var(--color-bg-primary)] px-2 py-1 shadow-sm group-hover:flex group-focus-within:flex"
          style={{ borderColor: "var(--color-border-subtle)" }}
          role="menu"
        >
          <span className="px-1 text-xs text-[var(--color-fg-secondary)]">
            {me.display_name}
          </span>
          <button
            type="button"
            onClick={logout}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-[var(--color-fg-primary)] hover:bg-[var(--color-bg-tertiary)]"
          >
            <LogOut size={12} /> Log out
          </button>
        </div>
        <span className="sr-only">
          <UserIcon aria-hidden /> {me.display_name}
        </span>
      </div>
    </nav>
  );
}
