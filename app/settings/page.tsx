"use client";

/**
 * Phase 7 — /settings page.
 *
 * Settings panels persist account preferences to PostgreSQL and connect
 * account controls to the authenticated backend.
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
  Lock,
  MessageCircle,
  Phone,
  Settings2,
  Sun,
  User as UserIcon,
} from "lucide-react";
import { toast } from "sonner";
import { ApiError, changePhone, getMe, requestOtp, updateProfile, uploadImage, type User } from "@/lib/api";
import { firebasePhoneError, getPhoneAuthRecaptchaToken } from "@/lib/firebase-auth";
import { isValidPhoneNumber } from "@/lib/phone";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/store/auth";
import { queryKeys } from "@/lib/api";
import { useNotificationSound } from "@/lib/notification-sound";
import { deactivateAccount, getAppSettings, getBackup, getBlockedUsers, getDataUsage, patchAppSettings, scheduleAccountDeletion, unblockUser, type AppSettings, type AppSettingsPatch } from "@/lib/api";
import { useDraftStore } from "@/store/drafts";
import { Avatar } from "@/components/avatar";
import { PhoneNumberInput } from "@/components/auth/phone-number-input";

type Section =
  | "account"
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
    key: "general",
    label: "General",
    icon: <Settings2 size={14} aria-hidden />,
  },
  { key: "appearance", label: "Appearance", icon: <Sun size={14} aria-hidden /> },
  {
    key: "chats",
    label: "Chats",
    icon: <MessageCircle size={14} aria-hidden />,
  },
  {
    key: "calls",
    label: "Calls",
    icon: <Phone size={14} aria-hidden />,
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
  },
  {
    key: "backups",
    label: "Backups",
    icon: <HardDrive size={14} aria-hidden />,
  },
];

function isSection(v: string | null): v is Section {
  return (
    v === "account" ||
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
          {section === "general" ? <GeneralPanel /> : null}
          {section === "chats" ? <ChatsPanel /> : null}
          {section === "calls" ? <CallsPanel /> : null}
          {section === "data-usage" ? <DataUsagePanel /> : null}
          {section === "backups" ? <BackupsPanel /> : null}
        </section>
      </div>
    </main>
  );
}

function AccountPanel() {
  const router = useRouter();
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
  const [phoneOtpSession, setPhoneOtpSession] = useState("");
  const [phoneBusy, setPhoneBusy] = useState(false);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);

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
    if (!isValidPhoneNumber(phone)) {
      toast.error("Enter a valid phone number with country code");
      return;
    }
    setPhoneBusy(true);
    try {
      const recaptchaToken = await getPhoneAuthRecaptchaToken("settings-phone-recaptcha");
      const { session_info } = await requestOtp({ phone, recaptcha_token: recaptchaToken });
      if (!session_info) throw new Error("The server did not create a phone verification session");
      setPhoneOtpSession(session_info);
      setPhoneOtpRequested(true);
      toast.success(`Verification code sent to ${phone}`);
    } catch (error) {
      toast.error(firebasePhoneError(error));
    } finally { setPhoneBusy(false); }
  }

  async function verifyPhoneChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPhoneBusy(true);
    try {
      const phone = phoneDraft.trim();
      const response = await changePhone(phone, phoneOtpSession, phoneOtp.trim());
      useAuthStore.getState().setAuth(response.token, response.user);
      void queryClient.setQueryData(queryKeys.me, response.user);
      setPhoneOtpRequested(false);
      setPhoneOtpSession("");
      setPhoneOtp("");
      toast.success("Phone number updated");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : firebasePhoneError(error));
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

  async function deactivate() {
    if (!window.confirm("Deactivate this account? You will be signed out. People can still send you messages, which will be waiting when you sign in again.")) return;
    setLifecycleBusy(true);
    try {
      await deactivateAccount();
      useAuthStore.getState().clear();
      queryClient.clear();
      toast.success("Account deactivated. Sign in again whenever you want to reactivate it.");
      router.replace("/auth/phone");
    } catch (error) { toast.error(error instanceof ApiError ? error.message : "Couldn't deactivate account"); }
    finally { setLifecycleBusy(false); }
  }

  async function scheduleDeletion() {
    if (!window.confirm("Schedule account deletion? Your profile will be hidden and people cannot message you. Your username stays reserved. Sign in within 30 days to undo deletion; after that the account and username are permanently removed.")) return;
    setLifecycleBusy(true);
    try {
      const result = await scheduleAccountDeletion();
      useAuthStore.getState().clear();
      queryClient.clear();
      const deadline = result.delete_after ? new Date(result.delete_after).toLocaleDateString() : "in 30 days";
      toast.success(`Deletion scheduled for ${deadline}. Sign in within 30 days to undo it.`);
      router.replace("/auth/phone");
    } catch (error) { toast.error(error instanceof ApiError ? error.message : "Couldn't schedule account deletion"); }
    finally { setLifecycleBusy(false); }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6" aria-label="Account">
      <form id="settings-profile-form" onSubmit={onSubmit} className="flex flex-col gap-4" aria-label="Profile details">
        <h2 className="text-base font-semibold text-[var(--color-fg-primary)]">
          Account
        </h2>
        <div className="flex items-center gap-4 rounded-xl border p-3 sm:p-4" style={{ borderColor: "var(--color-border-subtle)" }}>
          <Avatar subject={{ avatar_url: photoPreview || me.avatar_url || "", display_name: me.display_name ?? me.username ?? me.phone ?? me.email ?? "Signal user" }} size={64} showOnline={false} />
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
        <PhoneNumberInput
          id="settings-phone"
          value={phoneDraft}
          onChange={(value) => { setPhoneDraft(value); setPhoneOtpRequested(false); }}
          disabled={phoneBusy}
        />
        {phoneDraft.trim() !== currentUser.phone ? (
          phoneOtpRequested ? (
            <form onSubmit={verifyPhoneChange} className="mt-2 flex gap-2">
              <input inputMode="numeric" value={phoneOtp} onChange={(event) => setPhoneOtp(event.target.value)} placeholder="Verification code" className="min-w-0 flex-1 rounded-lg border bg-[var(--color-bg-secondary)] px-3 py-2 text-sm text-[var(--color-fg-primary)] outline-none" style={{ borderColor: "var(--color-border-subtle)" }} aria-label="Verification code" />
              <button type="submit" disabled={phoneBusy || !phoneOtp.trim()} className="min-h-11 rounded-lg px-3 text-sm font-semibold disabled:opacity-50" style={{ backgroundColor: "var(--color-accent)", color: "var(--color-accent-fg)" }}>{phoneBusy ? "Verifying…" : "Verify"}</button>
            </form>
          ) : <button type="button" onClick={() => void requestPhoneCode()} disabled={phoneBusy} className="mt-2 min-h-11 rounded-lg border px-3 text-sm text-[var(--color-fg-primary)] disabled:opacity-50" style={{ borderColor: "var(--color-border-subtle)" }}>{phoneBusy ? "Requesting…" : "Verify new number"}</button>
        ) : null}
        <div id="settings-phone-recaptcha" />
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
      <section className="flex max-w-2xl flex-col gap-3 border-t pt-5" style={{ borderColor: "var(--color-border-subtle)" }} aria-label="Account lifecycle">
        <div>
          <h3 className="text-sm font-semibold text-[var(--color-fg-primary)]">Account access</h3>
          <p className="mt-1 text-xs text-[var(--color-fg-muted)]">Deactivation signs you out while leaving your account available to receive messages. Sign in again to reactivate.</p>
        </div>
        <button type="button" disabled={lifecycleBusy} onClick={() => void deactivate()} className="min-h-11 self-start rounded-lg border px-4 text-sm font-medium disabled:opacity-50" style={{ borderColor: "var(--color-border-subtle)", color: "var(--color-fg-primary)" }}>{lifecycleBusy ? "Please wait…" : "Deactivate account"}</button>
        <div className="mt-2 border-t pt-4" style={{ borderColor: "var(--color-border-subtle)" }}>
          <h3 className="text-sm font-semibold text-red-600">Delete account</h3>
          <p className="mt-1 text-xs text-[var(--color-fg-muted)]">Your account becomes hidden and stops accepting messages immediately. Permanent removal happens after 30 days. Your username remains reserved until permanent deletion. Sign in during the grace period to cancel.</p>
          <button type="button" disabled={lifecycleBusy} onClick={() => void scheduleDeletion()} className="mt-3 min-h-11 rounded-lg bg-red-600 px-4 text-sm font-semibold text-white disabled:opacity-50">Schedule account deletion</button>
        </div>
      </section>
    </div>
  );
}

function useSettings() {
  const client = useQueryClient();
  const token = useAuthStore((s) => s.token);
  const query = useQuery({ queryKey: queryKeys.appSettings, queryFn: getAppSettings, enabled: Boolean(token) });
  async function save(patch: AppSettingsPatch) {
    try { const result = await patchAppSettings(patch); client.setQueryData(queryKeys.appSettings, result); return result; }
    catch (error) { toast.error(error instanceof ApiError ? error.message : "Couldn't save setting"); throw error; }
  }
  return { settings: query.data, save };
}

function ToggleRow({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="flex cursor-pointer items-center justify-between gap-4 border-b px-4 py-3 last:border-0" style={{ borderColor: "var(--color-border-subtle)" }}><span><span className="block text-sm font-medium text-[var(--color-fg-primary)]">{label}</span><span className="block text-xs text-[var(--color-fg-muted)]">{description}</span></span><input aria-label={label} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-[var(--color-accent)]" /></label>;
}

function SettingsCard({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="max-w-2xl" aria-label={title}><h2 className="mb-3 text-base font-semibold text-[var(--color-fg-primary)]">{title}</h2><div className="overflow-hidden rounded-xl border" style={{ borderColor: "var(--color-border-subtle)" }}>{children}</div></section>;
}

function GeneralPanel() {
  const { settings, save } = useSettings();
  const values = settings?.general;
  return <SettingsCard title="General"><ToggleRow label="Enter to send" description="Press Enter to send; use Shift+Enter for a new line." checked={values?.enter_to_send ?? true} onChange={(v) => void save({ general: { enter_to_send: v } })} /><ToggleRow label="Spell check" description="Use your browser's spelling suggestions in the message composer." checked={values?.spell_check ?? true} onChange={(v) => void save({ general: { spell_check: v } })} /><ToggleRow label="Reduce motion" description="Reduce interface animations and transitions." checked={values?.reduce_motion ?? false} onChange={(v) => { document.documentElement.dataset.reduceMotion = String(v); void save({ general: { reduce_motion: v } }); }} /></SettingsCard>;
}

function ChatsPanel() {
  const { settings, save } = useSettings();
  return <SettingsCard title="Chats"><ToggleRow label="Confirm before deleting" description="Ask before removing a conversation from your chat list." checked={settings?.chats.confirm_before_delete ?? true} onChange={(v) => void save({ chats: { confirm_before_delete: v } })} /><label className="flex items-center justify-between gap-4 px-4 py-3"><span><span className="block text-sm font-medium text-[var(--color-fg-primary)]">Default disappearing messages</span><span className="text-xs text-[var(--color-fg-muted)]">Applied when you create a new conversation.</span></span><select aria-label="Default disappearing messages" value={settings?.chats.default_disappearing_seconds ?? "off"} onChange={(e) => void save({ chats: { default_disappearing_seconds: e.target.value === "off" ? null : Number(e.target.value) } })} className="rounded-lg border bg-[var(--color-bg-primary)] px-2 py-2 text-sm" style={{ borderColor: "var(--color-border-subtle)", color: "var(--color-fg-primary)" }}><option value="off">Off</option><option value="3600">1 hour</option><option value="86400">24 hours</option><option value="604800">7 days</option></select></label></SettingsCard>;
}

function CallsPanel() {
  const { settings, save } = useSettings();
  return <SettingsCard title="Calls"><ToggleRow label="Incoming call ringtone" description="Play a ringtone in this browser when a call is ringing." checked={settings?.calls.ringtone_enabled ?? true} onChange={(v) => void save({ calls: { ringtone_enabled: v } })} /></SettingsCard>;
}

function PrivacyPanel() {
  const { settings, save } = useSettings();
  const client = useQueryClient();
  const token = useAuthStore((s) => s.token);
  const blocked = useQuery({ queryKey: queryKeys.blockedUsers, queryFn: getBlockedUsers, enabled: Boolean(token) });
  async function unblock(id: number) { try { await unblockUser(id); await client.invalidateQueries({ queryKey: queryKeys.blockedUsers }); toast.success("User unblocked"); } catch (error) { toast.error(error instanceof ApiError ? error.message : "Couldn't unblock user"); } }
  return <div className="flex max-w-2xl flex-col gap-5" aria-label="Privacy"><SettingsCard title="Privacy"><ToggleRow label="Read receipts" description="Let others know when you've read their messages." checked={settings?.privacy.read_receipts ?? true} onChange={(v) => void save({ privacy: { read_receipts: v } })} /><ToggleRow label="Typing indicators" description="Show others when you're typing in a conversation." checked={settings?.privacy.typing_indicators ?? true} onChange={(v) => void save({ privacy: { typing_indicators: v } })} /></SettingsCard><SettingsCard title="Blocked users">{blocked.isLoading ? <p className="px-4 py-3 text-sm text-[var(--color-fg-muted)]">Loading…</p> : blocked.data?.length ? blocked.data.map((user) => <div key={user.id} className="flex items-center justify-between gap-3 border-b px-4 py-3 last:border-0" style={{ borderColor: "var(--color-border-subtle)" }}><span className="text-sm text-[var(--color-fg-primary)]">{user.display_name || user.username || user.phone || user.email || `User ${user.id}`}</span><button type="button" onClick={() => void unblock(user.id)} className="rounded-lg border px-3 py-1.5 text-sm" style={{ borderColor: "var(--color-border-subtle)" }}>Unblock</button></div>) : <p className="px-4 py-3 text-sm text-[var(--color-fg-muted)]">No blocked users.</p>}</SettingsCard></div>;
}

function NotificationsPanel() {
  const sound = useNotificationSound();
  const { settings, save } = useSettings();
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");
  useEffect(() => { setPermission("Notification" in window ? Notification.permission : "unsupported"); }, []);
  useEffect(() => {
    if (settings && sound.enabled !== null && sound.enabled !== settings.notifications.sound_enabled) sound.setEnabled(settings.notifications.sound_enabled);
  }, [settings?.notifications.sound_enabled, sound.enabled]);
  async function enableDesktop() {
    if (!("Notification" in window)) { toast.error("Desktop notifications are not supported by this browser"); return; }
    const result = await Notification.requestPermission(); setPermission(result);
    if (result === "granted") void save({ notifications: { desktop_enabled: true } });
    else { void save({ notifications: { desktop_enabled: false } }); toast.info("Allow notifications in your browser settings to enable them"); }
  }
  return <div className="flex max-w-2xl flex-col gap-4" aria-label="Notifications"><SettingsCard title="Notifications"><ToggleRow label="Notifications" description="Enable or mute app notifications." checked={settings?.notifications.enabled ?? true} onChange={(v) => void save({ notifications: { enabled: v } })} /><ToggleRow label="Sound on new messages" description="Play a short chime for new messages outside the open chat." checked={sound.enabled === true} onChange={(v) => { sound.setEnabled(v); void save({ notifications: { sound_enabled: v } }); }} /><div className="flex items-center justify-between gap-3 border-t px-4 py-3" style={{ borderColor: "var(--color-border-subtle)" }}><span><span className="block text-sm font-medium text-[var(--color-fg-primary)]">Desktop notifications</span><span className="text-xs text-[var(--color-fg-muted)]">Browser permission: {permission}.</span></span><button type="button" onClick={() => void enableDesktop()} disabled={permission === "unsupported" || permission === "granted"} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50" style={{ borderColor: "var(--color-border-subtle)" }}>{permission === "granted" ? "Enabled" : "Enable"}</button></div></SettingsCard></div>;
}

function AppearancePanel() {
  const { theme, setTheme } = useTheme();
  const { save } = useSettings();
  return <SettingsCard title="Appearance"><div className="flex items-center justify-between gap-4 px-4 py-3"><span><span className="block text-sm font-medium text-[var(--color-fg-primary)]">Theme</span><span className="text-xs text-[var(--color-fg-muted)]">Choose light or dark appearance.</span></span><div className="flex gap-2">{(["light", "dark"] as const).map((value) => <button key={value} type="button" onClick={() => { setTheme(value); void save({ appearance: { theme: value } }); }} aria-pressed={theme === value} className="rounded-lg px-3 py-2 text-sm font-semibold" style={{ backgroundColor: theme === value ? "var(--color-accent)" : "var(--color-bg-tertiary)", color: theme === value ? "var(--color-accent-fg)" : "var(--color-fg-primary)" }}>{value === "light" ? "Light" : "Dark"}</button>)}</div></div></SettingsCard>;
}

function DataUsagePanel() {
  const client = useQueryClient();
  const token = useAuthStore((s) => s.token);
  const usage = useQuery({ queryKey: queryKeys.dataUsage, queryFn: getDataUsage, enabled: Boolean(token) });
  function formatBytes(bytes: number) { if (bytes < 1024) return `${bytes} B`; if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`; return `${(bytes / 1024 ** 2).toFixed(1)} MB`; }
  return <div className="flex max-w-2xl flex-col gap-3"><div className="flex items-center justify-between"><h2 className="text-base font-semibold text-[var(--color-fg-primary)]">Data usage</h2><button type="button" onClick={() => void client.invalidateQueries({ queryKey: queryKeys.dataUsage })} className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--color-border-subtle)" }}>Refresh</button></div><SettingsCard title="Account storage">{usage.isLoading ? <p className="px-4 py-3 text-sm">Loading…</p> : usage.isError ? <p className="px-4 py-3 text-sm text-red-500">Couldn't load usage data.</p> : <div className="grid grid-cols-2 gap-3 p-4">{([["Conversations", usage.data?.conversations], ["Messages", usage.data?.messages], ["Attachments", usage.data?.attachments], ["Attachment size", formatBytes(usage.data?.attachment_bytes ?? 0)], ["Stories", usage.data?.stories]] as const).map(([label, value]) => <div key={label} className="rounded-lg bg-[var(--color-bg-secondary)] p-3"><p className="text-xs text-[var(--color-fg-muted)]">{label}</p><p className="mt-1 text-lg font-semibold text-[var(--color-fg-primary)]">{value}</p></div>)}</div>}</SettingsCard><SettingsCard title="Local drafts"><div className="flex items-center justify-between gap-4 px-4 py-3"><span className="text-sm text-[var(--color-fg-secondary)]">Clear unsent message drafts stored in this browser. Server messages stay untouched.</span><button type="button" onClick={() => { useDraftStore.setState({ drafts: {} }); toast.success("Local drafts cleared"); }} className="shrink-0 rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--color-border-subtle)" }}>Clear drafts</button></div></SettingsCard></div>;
}

function BackupsPanel() {
  const [busy, setBusy] = useState(false);
  async function download() { setBusy(true); try { const data = await getBackup(); const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `signal-clone-backup-${new Date().toISOString().slice(0, 10)}.json`; anchor.click(); URL.revokeObjectURL(url); toast.success("Backup downloaded"); } catch (error) { toast.error(error instanceof ApiError ? error.message : "Couldn't create backup"); } finally { setBusy(false); } }
  return <SettingsCard title="Backups"><div className="p-4"><p className="text-sm text-[var(--color-fg-secondary)]">Download your account profile, conversations, and messages as a JSON file. Attachment URLs are included; media files are not embedded.</p><button type="button" onClick={() => void download()} disabled={busy} className="mt-4 min-h-10 rounded-lg px-4 text-sm font-semibold disabled:opacity-50" style={{ backgroundColor: "var(--color-accent)", color: "var(--color-accent-fg)" }}>{busy ? "Preparing…" : "Download backup"}</button></div></SettingsCard>;
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

