"use client";

/**
 * Phase 7 — /settings page.
 *
 * Sections (left nav): Account / Privacy / Notifications / Appearance.
 * Account is real (PATCH /auth/profile); the rest are placeholders that
 * toast "Coming soon" — except Notifications, which has a working
 * sound toggle (mute by default, persisted in localStorage).
 *
 * Deep-linking: /settings?section=privacy etc. Selects the panel on
 * mount and syncs the URL on tab change so back/forward works.
 */

import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Bell, Lock, Sun, User as UserIcon } from "lucide-react";
import { toast } from "sonner";
import { ApiError, getMe, updateProfile, type User } from "@/lib/api";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/store/auth";
import { queryKeys } from "@/lib/api";
import { useNotificationSound } from "@/lib/notification-sound";

type Section = "account" | "privacy" | "notifications" | "appearance";

const SECTIONS: Array<{
  key: Section;
  label: string;
  icon: React.ReactNode;
}> = [
  { key: "account", label: "Account", icon: <UserIcon size={14} aria-hidden /> },
  { key: "privacy", label: "Privacy", icon: <Lock size={14} aria-hidden /> },
  {
    key: "notifications",
    label: "Notifications",
    icon: <Bell size={14} aria-hidden />,
  },
  { key: "appearance", label: "Appearance", icon: <Sun size={14} aria-hidden /> },
];

function isSection(v: string | null): v is Section {
  return (
    v === "account" ||
    v === "privacy" ||
    v === "notifications" ||
    v === "appearance"
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<SettingsSkeleton />}>
      <SettingsPageInner />
    </Suspense>
  );
}

function SettingsSkeleton() {
  return (
    <main className="flex h-screen w-screen items-center justify-center">
      <p className="text-sm text-[var(--color-fg-muted)]">Loading…</p>
    </main>
  );
}

function SettingsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initial = searchParams.get("section");
  const [section, setSection] = useState<Section>(
    isSection(initial) ? initial : "account",
  );

  // Sync URL ?section= on tab change so the browser back button moves
  // through tabs in a sensible order.
  useEffect(() => {
    const current = searchParams.get("section");
    if (current !== section) {
      const next = new URLSearchParams(searchParams.toString());
      if (section === "account") next.delete("section");
      else next.set("section", section);
      router.replace(`/settings?${next.toString()}`, { scroll: false });
    }
  }, [section, router, searchParams]);

  return (
    <main
      className="mx-auto flex h-screen w-full max-w-[960px] flex-col"
      style={{ backgroundColor: "var(--color-bg-primary)" }}
      aria-label="Settings"
    >
      <header
        className="flex items-center gap-3 border-b px-6 py-3"
        style={{ borderColor: "var(--color-border-subtle)" }}
      >
        <button
          type="button"
          aria-label="Back"
          onClick={() => router.back()}
          className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--color-fg-secondary)] hover:bg-[var(--color-bg-tertiary)]"
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-lg font-semibold text-[var(--color-fg-primary)]">
          Settings
        </h1>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <nav
          className="w-56 shrink-0 border-r p-2"
          style={{ borderColor: "var(--color-border-subtle)" }}
          aria-label="Settings sections"
        >
          <ul className="flex flex-col gap-1">
            {SECTIONS.map((s) => (
              <li key={s.key}>
                <button
                  type="button"
                  aria-current={section === s.key ? "page" : undefined}
                  onClick={() => setSection(s.key)}
                  className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm transition hover:bg-[var(--color-bg-tertiary)]"
                  style={{
                    backgroundColor:
                      section === s.key
                        ? "var(--color-bg-tertiary)"
                        : "transparent",
                    color: "var(--color-fg-primary)",
                  }}
                >
                  {s.icon}
                  <span>{s.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <section
          className="flex-1 overflow-y-auto p-6"
          aria-label={`${SECTIONS.find((s) => s.key === section)?.label} settings`}
        >
          {section === "account" ? <AccountPanel /> : null}
          {section === "privacy" ? <PrivacyPanel /> : null}
          {section === "notifications" ? <NotificationsPanel /> : null}
          {section === "appearance" ? <AppearancePanel /> : null}
        </section>
      </div>
    </main>
  );
}

function AccountPanel() {
  const storedUser = useAuthStore((s) => s.user);
  // Re-fetch to ensure the form has the freshest display_name.
  const meQuery = useQuery({
    queryKey: queryKeys.me,
    queryFn: getMe,
    staleTime: 30_000,
  });
  const me = meQuery.data ?? storedUser;

  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(me?.display_name ?? "");
  }, [me?.display_name]);

  if (!me) {
    return (
      <p className="text-sm text-[var(--color-fg-muted)]">Loading…</p>
    );
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = draft.trim();
    if (trimmed === (me?.display_name ?? "")) {
      toast.info("No changes to save");
      return;
    }
    setSaving(true);
    try {
      const updated: User = await updateProfile({ display_name: trimmed });
      // Refresh both the auth store and the cached me query.
      useAuthStore.getState().setAuth(
        useAuthStore.getState().token ?? "",
        updated,
      );
      void queryClient.setQueryData(queryKeys.me, updated);
      toast.success("Profile updated");
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : "Couldn't update profile";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex max-w-[480px] flex-col gap-4"
      aria-label="Account"
    >
      <h2 className="text-base font-semibold text-[var(--color-fg-primary)]">
        Account
      </h2>
      <Field label="Display name">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={128}
          disabled={saving}
          className="w-full rounded-lg border bg-[var(--color-bg-secondary)] px-3 py-2 text-sm text-[var(--color-fg-primary)] outline-none focus:ring-2 focus:ring-[var(--color-accent)] disabled:opacity-60"
          style={{ borderColor: "var(--color-border-subtle)" }}
          aria-label="Display name"
        />
      </Field>
      <Field label="Phone">
        <input
          type="tel"
          value={me.phone}
          readOnly
          className="w-full cursor-not-allowed rounded-lg border bg-[var(--color-bg-secondary)] px-3 py-2 text-sm text-[var(--color-fg-muted)] outline-none"
          style={{ borderColor: "var(--color-border-subtle)" }}
          aria-label="Phone (read-only)"
        />
      </Field>
      <Field label="Avatar URL">
        <input
          type="url"
          value={me.avatar_url ?? ""}
          readOnly
          placeholder="(set via /auth/profile)"
          className="w-full cursor-not-allowed rounded-lg border bg-[var(--color-bg-secondary)] px-3 py-2 text-sm text-[var(--color-fg-muted)] outline-none placeholder:text-[var(--color-fg-muted)]"
          style={{ borderColor: "var(--color-border-subtle)" }}
          aria-label="Avatar URL (read-only)"
        />
        <p className="mt-1 text-xs text-[var(--color-fg-muted)]">
          Phone + avatar URL are managed by the backend for v1.
        </p>
      </Field>
      <div>
        <button
          type="submit"
          disabled={saving || draft.trim().length === 0}
          className="rounded-lg px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
          style={{
            backgroundColor: "var(--color-accent)",
            color: "var(--color-accent-fg)",
          }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

function PrivacyPanel() {
  return (
    <div className="flex max-w-[480px] flex-col gap-2" aria-label="Privacy">
      <h2 className="text-base font-semibold text-[var(--color-fg-primary)]">
        Privacy
      </h2>
      <ul className="flex flex-col divide-y rounded-lg border"
          style={{ borderColor: "var(--color-border-subtle)" }}>
        {[
          { label: "Read receipts", desc: "Let others know when you've read their messages." },
          { label: "Typing indicators", desc: "Show others when you're typing." },
          { label: "Blocked users", desc: "Manage users you've blocked." },
        ].map((item) => (
          <li
            key={item.label}
            className="flex items-center justify-between gap-3 px-4 py-3"
          >
            <div>
              <p className="text-sm font-medium text-[var(--color-fg-primary)]">
                {item.label}
              </p>
              <p className="text-xs text-[var(--color-fg-muted)]">{item.desc}</p>
            </div>
            <button
              type="button"
              onClick={() => toast.info(`${item.label} — coming soon`)}
              className="rounded px-3 py-1 text-xs text-[var(--color-accent)] hover:bg-[var(--color-bg-tertiary)]"
            >
              Open
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function NotificationsPanel() {
  const sound = useNotificationSound();
  return (
    <div className="flex max-w-[480px] flex-col gap-4" aria-label="Notifications">
      <h2 className="text-base font-semibold text-[var(--color-fg-primary)]">
        Notifications
      </h2>
      <ul className="flex flex-col gap-2">
        <li
          className="flex items-center justify-between gap-3 rounded-lg border px-4 py-3"
          style={{ borderColor: "var(--color-border-subtle)" }}
        >
          <div>
            <p className="text-sm font-medium text-[var(--color-fg-primary)]">
              Sound on new messages
            </p>
            <p className="text-xs text-[var(--color-fg-muted)]">
              {sound.supported
                ? "Plays a short chime when a new message arrives in a conversation that's not currently open."
                : "Sound asset not configured. Toggle is disabled."}
            </p>
          </div>
          <label
            className="relative inline-flex h-6 w-11 cursor-pointer items-center"
            aria-label="Toggle sound on new messages"
          >
            <input
              type="checkbox"
              checked={sound.enabled === true}
              disabled={!sound.supported || sound.enabled === null}
              onChange={(e) => sound.setEnabled(e.target.checked)}
              className="peer sr-only"
            />
            <span
              className="h-6 w-11 rounded-full transition peer-disabled:opacity-50"
              style={{
                backgroundColor: sound.enabled
                  ? "var(--color-accent)"
                  : "var(--color-bg-tertiary)",
              }}
            />
            <span
              className="absolute left-0.5 h-5 w-5 rounded-full bg-white transition-transform"
              style={{
                transform: sound.enabled ? "translateX(20px)" : "translateX(0)",
              }}
            />
          </label>
        </li>
        <li
          className="flex items-center justify-between gap-3 rounded-lg border px-4 py-3"
          style={{ borderColor: "var(--color-border-subtle)" }}
        >
          <div>
            <p className="text-sm font-medium text-[var(--color-fg-primary)]">
              Mute notifications
            </p>
            <p className="text-xs text-[var(--color-fg-muted)]">
              Suppresses toast banners and (when supported) the chime.
            </p>
          </div>
          <button
            type="button"
            onClick={() => toast.info("Mute — coming soon")}
            className="rounded px-3 py-1 text-xs text-[var(--color-accent)] hover:bg-[var(--color-bg-tertiary)]"
          >
            Open
          </button>
        </li>
      </ul>
    </div>
  );
}

function AppearancePanel() {
  return (
    <div className="flex max-w-[480px] flex-col gap-3" aria-label="Appearance">
      <h2 className="text-base font-semibold text-[var(--color-fg-primary)]">
        Appearance
      </h2>
      <div
        className="rounded-lg border px-4 py-3"
        style={{ borderColor: "var(--color-border-subtle)" }}
      >
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-[var(--color-fg-primary)]">
            Theme
          </p>
          <span
            className="rounded-full px-2 py-0.5 text-xs font-semibold"
            style={{
              backgroundColor: "var(--color-accent)",
              color: "var(--color-accent-fg)",
            }}
          >
            Light (active)
          </span>
        </div>
        <p className="mt-1 text-xs text-[var(--color-fg-muted)]">
          Dark mode coming soon.
        </p>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-[var(--color-fg-secondary)]">
        {label}
      </span>
      {children}
    </label>
  );
}
