"use client";

/**
 * Phase 10 — mobile bottom navigation for the chat shell.
 *
 * Mirrors the Signal-Android pattern (Chats / Calls / Stories along
 * the bottom). On our app those items are:
 *   - Chats:    the active conversation list (the default route)
 *   - Settings: jump to /settings
 *   - Calls / Stories: placeholders that toast "coming soon", same
 *     as the left-rail items on desktop.
 *
 * Mounted only on compact viewports (<lg). The corresponding left
 * rail is hidden on the same viewports, so the two are mutually
 * exclusive — the user has the rail on desktop, the bottom nav on
 * mobile.
 *
 * Stays out of the way visually: fixed to the bottom, ~56px tall,
 * uses env(safe-area-inset-bottom) so the iOS home indicator doesn't
 * cover the touch targets.
 */

import { useRouter, usePathname } from "next/navigation";
import { BookOpen, MessageCircle, Phone, Settings as SettingsIcon } from "lucide-react";

const ICON_SIZE = 22;

function Item({
  label,
  Icon,
  active,
  onClick,
  disabled,
}: {
  label: string;
  Icon: typeof MessageCircle;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      disabled={disabled}
      className="flex h-full min-h-[44px] w-full flex-col items-center justify-center gap-0.5 transition active:opacity-70 disabled:cursor-not-allowed disabled:opacity-40"
      style={{
        color: active ? "var(--color-accent)" : "var(--color-fg-secondary)",
      }}
    >
      <Icon size={ICON_SIZE} aria-hidden />
      <span className="text-[10px] font-medium leading-none">{label}</span>
    </button>
  );
}

export function ChatBottomNav() {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary mobile"
      className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t lg:hidden"
      style={{
        backgroundColor: "var(--color-bg-primary)",
        borderColor: "var(--color-border-subtle)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      <Item
        label="Chats"
        Icon={MessageCircle}
        active={pathname === "/chat" || pathname === "/"}
        onClick={() => router.push("/chat")}
      />
      <Item
        label="Calls"
        Icon={Phone}
        active={false}
        disabled
        onClick={() => undefined}
      />
      <Item
        label="Stories"
        Icon={BookOpen}
        active={false}
        disabled
        onClick={() => undefined}
      />
      <Item
        label="Settings"
        Icon={SettingsIcon}
        active={pathname.startsWith("/settings")}
        onClick={() => router.push("/settings")}
      />
    </nav>
  );
}