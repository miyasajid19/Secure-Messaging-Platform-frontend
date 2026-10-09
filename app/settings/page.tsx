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

import { Suspense, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useTheme } from "@/lib/theme";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Bell,
  Camera,
  ChartNoAxesCombined,
  HardDrive,
  Heart,
  Lock,
  MessageCircle,
  Phone,
  Settings2,
  Sun,
  User as UserIcon,
} from "lucide-react";
import { toast } from "sonner";
import { ApiError, changePhone, getMe, requestPhoneChangeOtp, updateProfile, uploadImage, type User } from "@/lib/api";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/store/auth";
import { queryKeys } from "@/lib/api";
import { useNotificationSound } from "@/lib/notification-sound";
import { Avatar } from "@/components/avatar";

type Section =
  | "account"
  | "donate"
  | "general"
  | "appearance"
  | "chats"
  | "calls"
  | "notifications"
  | "privacy"
  | "data-usage"
  | "backups";

const SECTIONS: Array<{
  key: Section;
  label: string;
  icon: React.ReactNode;
  description?: string;
}> = [
  { key: "account", label: "Account", icon: <UserIcon size={14} aria-hidden /> },
  {
    key: "donate",
    label: "Donate to Signal",
    icon: <Heart size={14} aria-hidden />,
    description: "Donation options will be available in a future update.",
  },
  {
    key: "general",
    label: "General",
    icon: <Settings2 size={14} aria-hidden />,
    description: "General app preferences are coming soon.",
  },
  { key: "appearance", label: "Appearance", icon: <Sun size={14} aria-hidden /> },
  {
    key: "chats",
    label: "Chats",
    icon: <MessageCircle size={14} aria-hidden />,
    description: "Chat preferences and message options are coming soon.",
  },
  {
    key: "calls",
    label: "Calls",
    icon: <Phone size={14} aria-hidden />,
    description: "Voice and video call settings are coming soon.",
  },
  {
    key: "notifications",
    label: "Notifications",
    icon: <Bell size={14} aria-hidden />,
  },
  { key: "privacy", label: "Privacy", icon: <Lock size={14} aria-hidden /> },
  {
    key: "data-usage",
    label: "Data usage",
    icon: <ChartNoAxesCombined size={14} aria-hidden />,
    description: "Data and storage controls are coming soon.",
  },
  {
    key: "backups",
    label: "Backups",
    icon: <HardDrive size={14} aria-hidden />,
    description: "Message backup options are coming soon.",
  },
];

function isSection(v: string | null): v is Section {
  return (
    v === "account" ||
    v === "donate" ||
    v === "general" ||
    v === "chats" ||
    v === "calls" ||
    v === "data-usage" ||
    v === "backups" ||
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
  const profile = useAuthStore((s) => s.user);
  const initial = searchParams.get("section");
  const mobileSectionsRef = useRef<HTMLDivElement | null>(null);
  const [section, setSection] = useState<Section>(
    isSection(initial) ? initial : "account",
  );
  const [sectionScrollEdges, setSectionScrollEdges] = useState({
    left: false,
    right: false,
  });

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

  useEffect(() => {
    const tabs = mobileSectionsRef.current;
    const activeTab = tabs?.querySelector<HTMLButtonElement>(
      '[role="tab"][aria-selected="true"]',
    );
    if (!tabs || !activeTab) return;

    const activeLeft = activeTab.offsetLeft - tabs.scrollLeft;
    const activeRight = activeLeft + activeTab.offsetWidth;
    if (activeLeft < 0) {
      tabs.scrollTo({ left: activeTab.offsetLeft, behavior: "smooth" });
    } else if (activeRight > tabs.clientWidth) {
      tabs.scrollTo({
        left: activeTab.offsetLeft + activeTab.offsetWidth - tabs.clientWidth,
        behavior: "smooth",
      });
    }
  }, [section]);

  useEffect(() => {
    const tabs = mobileSectionsRef.current;
    if (!tabs) return;

    const updateScrollEdges = () => {
      const left = tabs.scrollLeft > 1;
      const right = tabs.scrollLeft + tabs.clientWidth < tabs.scrollWidth - 1;
      setSectionScrollEdges((current) => {
        if (current.left === left && current.right === right) return current;
        return {
          left,
          right,
        };
      });
    };

    const initialFrame = window.requestAnimationFrame(updateScrollEdges);
    tabs.addEventListener("scroll", updateScrollEdges, { passive: true });
    const observer = new ResizeObserver(updateScrollEdges);
    observer.observe(tabs);
    window.addEventListener("resize", updateScrollEdges);
    return () => {
      window.cancelAnimationFrame(initialFrame);
      tabs.removeEventListener("scroll", updateScrollEdges);
      window.removeEventListener("resize", updateScrollEdges);
      observer.disconnect();
    };
  }, []);

  return (
    <main
      className="mx-auto flex min-h-screen w-full max-w-[960px] flex-col md:h-screen md:min-h-0"
      style={{ backgroundColor: "var(--color-bg-primary)" }}
      aria-label="Settings"
    >
      <header
        className="flex min-h-14 items-center gap-3 border-b px-3 py-2.5 sm:px-6"
        style={{ borderColor: "var(--color-border-subtle)" }}
      >
        <button
          type="button"
          aria-label="Back"
          onClick={() => router.back()}
          className="flex h-11 w-11 items-center justify-center rounded-full text-[var(--color-fg-secondary)] hover:bg-[var(--color-bg-tertiary)] active:bg-[var(--color-bg-tertiary)]"
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-lg font-semibold text-[var(--color-fg-primary)]">
          Settings
        </h1>
      </header>

      <div className="flex flex-1 flex-col md:min-h-0 md:flex-row md:overflow-hidden">
        <nav
          className="w-full shrink-0 p-2 md:w-56 md:overflow-y-auto md:border-r"
          style={{ borderColor: "var(--color-border-subtle)" }}
          aria-label="Settings sections"
        >
          {/* Profile card — visible on all viewports. Tapping it
              opens the Account section. Matches the Signal-Android
              settings pattern where the profile sits above the
              section list. */}
          <button
            type="button"
            onClick={() => setSection("account")}
            aria-current={section === "account" ? "page" : undefined}
            className="mb-2 flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-left transition hover:bg-[var(--color-bg-tertiary)] active:bg-[var(--color-bg-tertiary)] md:mb-3 md:py-3"
          >
            <Avatar
              subject={{
                avatar_url: profile?.avatar_url ?? "",
                display_name: profile?.display_name || "Your profile",
                last_seen: profile?.last_seen,
              }}
              size={48}
              showOnline={false}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-base font-semibold text-[var(--color-fg-primary)]">
                {profile?.display_name || "Your profile"}
              </span>
              <span className="block truncate text-sm text-[var(--color-fg-muted)]">
                {profile?.phone ?? "Manage your account"}
              </span>
            </span>
          </button>
          <div
            className="mb-2 border-t md:mb-2"
            style={{ borderColor: "var(--color-border-subtle)" }}
          />
          <div className="mb-2 flex min-w-0 items-center gap-1 md:hidden">
            {sectionScrollEdges.left ? (
              <button
                type="button"
                aria-label="Scroll to previous settings sections"
                title="Previous sections"
                onClick={() =>
                  mobileSectionsRef.current?.scrollBy({
                    left: -(mobileSectionsRef.current.clientWidth * 0.75),
                    behavior: "smooth",
                  })
                }
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[var(--color-fg-secondary)] hover:bg-[var(--color-bg-tertiary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
              >
                <ChevronLeft size={18} aria-hidden />
              </button>
            ) : null}
            <div
              ref={mobileSectionsRef}
              role="tablist"
              aria-label="Settings sections"
              className="flex min-w-0 flex-1 snap-x snap-proximity gap-1.5 overflow-x-auto py-1 [scrollbar-width:none]"
            >
              {SECTIONS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  role="tab"
                  aria-selected={section === item.key}
                  onClick={() => setSection(item.key)}
                  className="min-h-10 shrink-0 snap-start rounded-full border px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
                  style={{
                    borderColor:
                      section === item.key
                        ? "var(--color-accent)"
                        : "var(--color-border-subtle)",
                    backgroundColor:
                      section === item.key
                        ? "var(--color-bg-tertiary)"
                        : "transparent",
                    color: "var(--color-fg-primary)",
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
            {sectionScrollEdges.right ? (
              <button
                type="button"
                aria-label="Scroll to more settings sections"
                title="More sections"
                onClick={() =>
                  mobileSectionsRef.current?.scrollBy({
                    left: mobileSectionsRef.current.clientWidth * 0.75,
                    behavior: "smooth",
                  })
                }
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[var(--color-fg-secondary)] hover:bg-[var(--color-bg-tertiary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
              >
                <ChevronRight size={18} aria-hidden />
              </button>
            ) : null}
          </div>
          <ul className="hidden flex-col gap-0.5 md:flex">
            {SECTIONS.map((s) => (
              <li key={s.key}>
                <button
                  type="button"
                  aria-current={section === s.key ? "page" : undefined}
                  onClick={() => setSection(s.key)}
                  className="flex min-h-[44px] w-full items-center gap-3 rounded-lg px-3 text-left text-sm transition hover:bg-[var(--color-bg-tertiary)] active:bg-[var(--color-bg-tertiary)]"
                  style={{
                    backgroundColor:
                      section === s.key
                        ? "var(--color-bg-tertiary)"
                        : "transparent",
                    color: "var(--color-fg-primary)",
                  }}
                >
                  <span className="text-[var(--color-fg-secondary)]">
                    {s.icon}
                  </span>
                  <span>{s.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <section
          className="flex-none p-4 md:min-h-0 md:flex-1 md:overflow-y-auto md:p-6"
          aria-label={`${SECTIONS.find((s) => s.key === section)?.label} settings`}
        >
          {section === "account" ? <AccountPanel /> : null}
          {section === "privacy" ? <PrivacyPanel /> : null}
          {section === "notifications" ? <NotificationsPanel /> : null}
          {section === "appearance" ? <AppearancePanel /> : null}
          {!["account", "privacy", "notifications", "appearance"].includes(
            section,
          ) ? (
            <ComingSoonPanel
              title={SECTIONS.find((item) => item.key === section)?.label ?? "Settings"}
              description={SECTIONS.find((item) => item.key === section)?.description}
            />
          ) : null}
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
  const [usernameDraft, setUsernameDraft] = useState("");
  const [profilePhoto, setProfilePhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState("");
  const [saving, setSaving] = useState(false);
  const [phoneDraft, setPhoneDraft] = useState("");
  const [phoneOtp, setPhoneOtp] = useState("");
  const [phoneOtpRequested, setPhoneOtpRequested] = useState(false);
  const [phoneBusy, setPhoneBusy] = useState(false);

  useEffect(() => {
    setDraft(me?.display_name ?? "");
    setUsernameDraft(me?.username ?? "");
    setPhoneDraft(me?.phone ?? "");
  }, [me?.display_name, me?.username, me?.phone]);

  useEffect(() => {
    if (!profilePhoto) { setPhotoPreview(""); return; }
    const url = URL.createObjectURL(profilePhoto);
    setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [profilePhoto]);

  if (!me) {
    return (
      <p className="text-sm text-[var(--color-fg-muted)]">Loading…</p>
    );
  }
  const currentUser = me;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = draft.trim();
    const normalizedUsername = usernameDraft.trim().replace(/^@/, "");
    const patch: { display_name?: string; username?: string | null; avatar_url?: string } = {};
    if (trimmed !== (currentUser.display_name ?? "")) patch.display_name = trimmed;
    if (normalizedUsername !== (currentUser.username ?? "")) patch.username = normalizedUsername || null;
    if (!profilePhoto && Object.keys(patch).length === 0) {
      toast.info("No changes to save");
      return;
    }
    setSaving(true);
    try {
      if (profilePhoto) {
        // Upload first, then save the returned URL through the profile API.
        patch.avatar_url = (await uploadImage(profilePhoto)).url;
      }
      const updated: User = await updateProfile(patch);
      // Refresh both the auth store and the cached me query.
      useAuthStore.getState().setAuth(
        useAuthStore.getState().token ?? "",
        updated,
      );
      void queryClient.setQueryData(queryKeys.me, updated);
      setProfilePhoto(null);
      toast.success("Profile updated");
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : "Couldn't update profile";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  async function requestPhoneCode() {
    const phone = phoneDraft.trim();
    if (!/^\+[1-9]\d{1,14}$/.test(phone)) {
      toast.error("Enter a valid phone number with country code");
      return;
    }
    setPhoneBusy(true);
    try {
      const response = await requestPhoneChangeOtp(phone);
      setPhoneOtpRequested(true);
      toast.success(response.sent ? `Verification code: ${response.debug_otp}` : "Couldn't request a code");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Couldn't request verification code");
    } finally { setPhoneBusy(false); }
  }

  async function verifyPhoneChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPhoneBusy(true);
    try {
      const response = await changePhone(phoneDraft.trim(), phoneOtp.trim());
      useAuthStore.getState().setAuth(response.token, response.user);
      void queryClient.setQueryData(queryKeys.me, response.user);
      setPhoneOtpRequested(false);
      setPhoneOtp("");
      toast.success("Phone number updated");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Couldn't update phone number");
    } finally { setPhoneBusy(false); }
  }

  function onPhotoSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/") || file.type === "image/svg+xml" || file.size > 5 * 1024 * 1024) {
      toast.error("Choose an image up to 5 MB");
      return;
    }
    setProfilePhoto(file);
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6" aria-label="Account">
      <form id="settings-profile-form" onSubmit={onSubmit} className="flex flex-col gap-4" aria-label="Profile details">
        <h2 className="text-base font-semibold text-[var(--color-fg-primary)]">
          Account
        </h2>
        <div className="flex items-center gap-4 rounded-xl border p-3 sm:p-4" style={{ borderColor: "var(--color-border-subtle)" }}>
          <Avatar subject={{ avatar_url: photoPreview || me.avatar_url || "", display_name: me.display_name ?? me.username ?? me.phone }} size={64} showOnline={false} />
          <div className="min-w-0">
            <p className="text-sm font-medium text-[var(--color-fg-primary)]">Profile photo</p>
            <p className="mt-0.5 text-xs text-[var(--color-fg-muted)]">Choose an image up to 5 MB.</p>
            <label htmlFor="settings-profile-photo" className="mt-2 inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm text-[var(--color-fg-primary)] hover:bg-[var(--color-bg-tertiary)]" style={{ borderColor: "var(--color-border-subtle)" }}>
              <Camera size={16} />{profilePhoto ? "Change photo" : "Update photo"}
            </label>
            <input id="settings-profile-photo" type="file" accept="image/*" className="sr-only" onChange={onPhotoSelected} />
          </div>
        </div>
        <Field label="Display name">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={128}
            disabled={saving}
            className="min-h-11 w-full rounded-lg border bg-[var(--color-bg-secondary)] px-3 text-sm text-[var(--color-fg-primary)] outline-none focus:ring-2 focus:ring-[var(--color-accent)] disabled:opacity-60"
            style={{ borderColor: "var(--color-border-subtle)" }}
            aria-label="Display name"
          />
        </Field>
        <Field label="Username">
          <input type="text" value={usernameDraft} onChange={(event) => setUsernameDraft(event.target.value)} maxLength={64} placeholder="Choose a username" disabled={saving} className="min-h-11 w-full rounded-lg border bg-[var(--color-bg-secondary)] px-3 text-sm text-[var(--color-fg-primary)] outline-none focus:ring-2 focus:ring-[var(--color-accent)] disabled:opacity-60" style={{ borderColor: "var(--color-border-subtle)" }} aria-label="Username" />
          <p className="mt-1 text-xs text-[var(--color-fg-muted)]">People can find you by username.</p>
        </Field>
      </form>

      <section className="flex flex-col gap-4 border-t pt-5" style={{ borderColor: "var(--color-border-subtle)" }} aria-labelledby="account-phone-heading">
        <div>
          <h3 id="account-phone-heading" className="text-sm font-semibold text-[var(--color-fg-primary)]">Phone number</h3>
          <p className="mt-1 text-xs text-[var(--color-fg-muted)]">Changing your number requires a verification code.</p>
        </div>
        <Field label="Phone">
        <input
          type="tel"
          value={phoneDraft}
          onChange={(event) => { setPhoneDraft(event.target.value); setPhoneOtpRequested(false); }}
          disabled={phoneBusy}
          className="min-h-11 w-full rounded-lg border bg-[var(--color-bg-secondary)] px-3 text-sm text-[var(--color-fg-primary)] outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
          style={{ borderColor: "var(--color-border-subtle)" }}
          aria-label="Phone number"
        />
        {phoneDraft.trim() !== currentUser.phone ? (
          phoneOtpRequested ? (
            <form onSubmit={verifyPhoneChange} className="mt-2 flex gap-2">
              <input inputMode="numeric" value={phoneOtp} onChange={(event) => setPhoneOtp(event.target.value)} placeholder="Verification code" className="min-w-0 flex-1 rounded-lg border bg-[var(--color-bg-secondary)] px-3 py-2 text-sm text-[var(--color-fg-primary)] outline-none" style={{ borderColor: "var(--color-border-subtle)" }} aria-label="Verification code" />
              <button type="submit" disabled={phoneBusy || !phoneOtp.trim()} className="min-h-11 rounded-lg px-3 text-sm font-semibold disabled:opacity-50" style={{ backgroundColor: "var(--color-accent)", color: "var(--color-accent-fg)" }}>{phoneBusy ? "Verifying…" : "Verify"}</button>
            </form>
          ) : <button type="button" onClick={() => void requestPhoneCode()} disabled={phoneBusy} className="mt-2 min-h-11 rounded-lg border px-3 text-sm text-[var(--color-fg-primary)] disabled:opacity-50" style={{ borderColor: "var(--color-border-subtle)" }}>{phoneBusy ? "Requesting…" : "Verify new number"}</button>
        ) : null}
        </Field>
      </section>
      <div>
        <button
          type="submit"
          form="settings-profile-form"
          disabled={saving || draft.trim().length === 0}
          className="min-h-11 rounded-lg px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
          style={{
            backgroundColor: "var(--color-accent)",
            color: "var(--color-accent-fg)",
          }}
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}

function ComingSoonPanel({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="flex max-w-[480px] flex-col gap-3" aria-label={title}>
      <h2 className="text-base font-semibold text-[var(--color-fg-primary)]">
        {title}
      </h2>
      <div
        className="rounded-lg border px-4 py-4"
        style={{ borderColor: "var(--color-border-subtle)" }}
      >
        <p className="text-sm text-[var(--color-fg-secondary)]">
          {description ?? `${title} settings are coming soon.`}
        </p>
        <span className="mt-3 inline-flex rounded-full bg-[var(--color-bg-tertiary)] px-2.5 py-1 text-xs text-[var(--color-fg-muted)]">
          Coming soon
        </span>
      </div>
    </div>
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
          { label: "Linked devices", desc: "View and manage devices signed in to your account." },
          { label: "End-to-end encryption", desc: "Keep conversations private between participants." },
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
              disabled
              aria-label={`${item.label} — coming soon`}
              className="shrink-0 cursor-not-allowed rounded-full border px-3 py-1 text-xs text-[var(--color-fg-muted)]"
              style={{ borderColor: "var(--color-border-subtle)" }}
            >
              Coming soon
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
  // Phase 8.3 — two-button theme switch. `useTheme` reads/writes
  // localStorage and applies the data-theme attribute. The buttons
  // live-update `document.documentElement.dataset.theme` via setTheme,
  // so the entire UI flips instantly with no page reload.
  const { theme, setTheme } = useTheme();
  const isDark = theme === "dark";
  return (
    <div className="flex max-w-[480px] flex-col gap-3" aria-label="Appearance">
      <h2 className="text-base font-semibold text-[var(--color-fg-primary)]">
        Appearance
      </h2>
      <div
        className="rounded-lg border px-4 py-3"
        style={{ borderColor: "var(--color-border-subtle)" }}
      >
        <p className="mb-2 text-sm font-medium text-[var(--color-fg-primary)]">
          Theme
        </p>
        <div role="group" aria-label="Theme" className="flex gap-2">
          {(["light", "dark"] as const).map((value) => {
            const active = theme === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setTheme(value)}
                aria-pressed={active}
                className="flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition disabled:cursor-not-allowed"
                style={{
                  backgroundColor: active
                    ? "var(--color-accent)"
                    : "var(--color-bg-tertiary)",
                  color: active
                    ? "var(--color-accent-fg)"
                    : "var(--color-fg-primary)",
                }}
              >
                {value === "light" ? "Light" : "Dark"}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-[var(--color-fg-muted)]">
          {isDark
            ? "Dark mode is on. Tokens in app/tokens.css flip automatically."
            : "Light mode is on. Switch to Dark in one click."}
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
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-[var(--color-fg-secondary)]">
        {label}
      </span>
      {children}
    </div>
  );
}
