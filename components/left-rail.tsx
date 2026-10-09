"use client";

/**
 * Vertical icon navigation (~60px wide) on the far left of the shell.
 *
 * Compact primary navigation. The hamburger collapses the rail, and
 * Settings occupies the bottom slot.
 *
 * Spec: §2 ("left rail").
 */

import {
  BookOpen,
  Menu,
  MessageCircle,
  Phone,
  Settings,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

type RailKey = "chats" | "calls" | "stories";

const railIcons: Array<{ key: RailKey; label: string; Icon: typeof MessageCircle }> = [
  { key: "chats", label: "Chats", Icon: MessageCircle },
  { key: "calls", label: "Calls", Icon: Phone },
  { key: "stories", label: "Stories", Icon: BookOpen },
];

export function LeftRail({ onHide }: { onHide: () => void }) {
  const router = useRouter();

  return (
    <nav
      aria-label="Primary"
      className="flex h-full w-[68px] shrink-0 flex-col items-center justify-between border-r py-3"
      style={{
        backgroundColor: "var(--color-bg-primary)",
        borderColor: "var(--color-border-subtle)",
      }}
    >
      <div className="flex w-full flex-col items-center gap-3">
        <button
          type="button"
          aria-label="Hide navigation"
          title="Hide navigation"
          onClick={onHide}
          className="flex h-11 w-11 items-center justify-center rounded-full text-[var(--color-fg-secondary)] transition hover:bg-[var(--color-bg-tertiary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
        >
          <Menu size={20} />
        </button>
        <ul className="flex flex-col items-center gap-3">
          {railIcons.map(({ key, label, Icon }) => {
            const isActive = key === "chats";
            return (
              <li key={key}>
                <button
                  type="button"
                  aria-label={label}
                  aria-current={isActive ? "page" : undefined}
                  title={label}
                  onClick={() => {
                    if (key === "calls" || key === "stories") {
                      toast.info(`${label} — coming soon`);
                      return;
                    }
                    if (key === "chats") router.push("/");
                  }}
                  className="flex h-11 w-11 items-center justify-center rounded-full transition"
                  style={{
                    backgroundColor: isActive ? "var(--color-bg-tertiary)" : "transparent",
                    color: isActive ? "var(--color-accent)" : "var(--color-fg-secondary)",
                  }}
                >
                  <Icon size={20} />
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <button
        type="button"
        aria-label="Settings"
        title="Settings"
        onClick={() => router.push("/settings")}
        className="flex h-11 w-11 items-center justify-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
        style={{ color: "var(--color-fg-secondary)" }}
      >
        <Settings size={20} />
      </button>
    </nav>
  );
}
