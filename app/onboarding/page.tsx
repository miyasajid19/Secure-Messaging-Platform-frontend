"use client";

/**
 * Phase 2 — onboarding / profile setup.
 *
 * Lives at `/onboarding` rather than `/auth/profile` to keep the URL
 * semantically aligned with the redirect target from `/auth/otp`. The
 * card shares the same chrome as the other auth pages.
 *
 * Fields: display name + username (required), and profile photo (optional).
 */

import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ImagePlus, UserCircle2, X } from "lucide-react";
import { AuthCard, AuthButton, AuthTextInput } from "@/components/auth/auth-card";
import {
  ApiError,
  type User,
  updateProfile,
  uploadImage,
} from "@/lib/api";
import { useAuthStore } from "@/store/auth";

export default function OnboardingPage() {
  const router = useRouter();
  const token = useAuthStore((s) => s.token);
  const storedUser = useAuthStore((s) => s.user);
  const setAuth = useAuthStore((s) => s.setAuth);

  // Wait until the store has hydrated before deciding where to send
  // unauthenticated users — avoids a flash redirect to /auth/phone on
  // a slow localStorage read.
  const hydrated = useAuthStore((s) => s.hydrated);

  const [displayName, setDisplayName] = useState(
    storedUser?.display_name ?? "",
  );
  const [username, setUsername] = useState(storedUser?.username ?? "");
  const [avatarUrl, setAvatarUrl] = useState(storedUser?.avatar_url ?? "");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!avatarFile) {
      setAvatarPreview("");
      return;
    }
    const previewUrl = URL.createObjectURL(avatarFile);
    setAvatarPreview(previewUrl);
    return () => URL.revokeObjectURL(previewUrl);
  }, [avatarFile]);

  useEffect(() => {
    if (hydrated && !token) {
      router.replace("/auth/phone");
    }
  }, [hydrated, token, router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = displayName.trim();
    const trimmedUsername = username.trim();
    if (!trimmedName) {
      toast.error("Display name is required");
      return;
    }
    if (!trimmedUsername) {
      toast.error("Username is required");
      return;
    }
    setSubmitting(true);
    try {
      const uploadedAvatar = avatarFile
        ? await uploadImage(avatarFile)
        : null;
      const updated: User = await updateProfile({
        display_name: trimmedName,
        username: trimmedUsername,
        avatar_url: uploadedAvatar?.url ?? (avatarUrl.trim() || undefined),
      });
      // Preserve existing token; just refresh the user object.
      const currentToken = useAuthStore.getState().token;
      if (currentToken) setAuth(currentToken, updated);
      router.push("/");
    } catch (error) {
      const message =
        error instanceof ApiError ? error.message : "Failed to save profile";
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  function handleAvatarChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = "";
    if (!file.type.startsWith("image/") || file.type === "image/svg+xml") {
      toast.error("Choose a supported image file");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Profile photos must be 5 MB or smaller");
      return;
    }
    setAvatarFile(file);
    setAvatarUrl("");
  }

  // Don't render the form until hydration resolves — otherwise we'd
  // flash a form for users who actually need to log in.
  if (!hydrated) {
    return (
      <main className="flex min-h-full items-center justify-center">
        <p className="text-sm text-[var(--color-fg-muted)]">Loading…</p>
      </main>
    );
  }

  return (
    <AuthCard
      title="Set up your profile"
      subtitle="Pick a name your contacts will see."
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-[var(--color-fg-secondary)]">
            Display name
          </span>
          <div className="relative">
            <UserCircle2
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-fg-muted)]"
              size={16}
              aria-hidden
            />
            <AuthTextInput
              type="text"
              autoFocus
              autoComplete="name"
              placeholder="Test User"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              disabled={submitting}
              required
              maxLength={128}
              className="pl-9"
              aria-label="Display name"
            />
          </div>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-[var(--color-fg-secondary)]">
            Username
          </span>
          <AuthTextInput
            type="text"
            autoComplete="username"
            placeholder="yourname"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            disabled={submitting}
            required
            maxLength={64}
            aria-label="Username"
          />
          <span className="text-xs text-[var(--color-fg-muted)]">
            People can find you by this username.
          </span>
        </label>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-[var(--color-fg-secondary)]">
            Profile photo <span className="text-[var(--color-fg-muted)]">(optional)</span>
          </span>
          <div className="flex items-center gap-3">
            <div
              className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border bg-[var(--color-bg-secondary)]"
              style={{ borderColor: "var(--color-border-subtle)" }}
            >
              {avatarPreview || avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={avatarPreview || avatarUrl}
                  alt="Profile photo preview"
                  className="h-full w-full object-cover"
                />
              ) : (
                <UserCircle2
                  size={28}
                  className="text-[var(--color-fg-muted)]"
                  aria-hidden
                />
              )}
            </div>
            <div className="flex min-w-0 flex-col gap-1.5">
              <label
                htmlFor="profile-photo"
                className="inline-flex w-fit cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium text-[var(--color-fg-primary)] transition hover:bg-[var(--color-bg-tertiary)]"
                style={{ borderColor: "var(--color-border-subtle)" }}
              >
                <ImagePlus size={15} aria-hidden />
                Upload photo
              </label>
              <input
                id="profile-photo"
                type="file"
                accept="image/*"
                onChange={handleAvatarChange}
                disabled={submitting}
                className="sr-only"
                aria-label="Upload profile photo"
              />
              {avatarFile ? (
                <div className="flex min-w-0 items-center gap-1 text-xs text-[var(--color-fg-muted)]">
                  <span className="truncate">{avatarFile.name}</span>
                  <button
                    type="button"
                    onClick={() => setAvatarFile(null)}
                    disabled={submitting}
                    aria-label="Remove selected photo"
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full hover:bg-[var(--color-bg-tertiary)]"
                  >
                    <X size={13} aria-hidden />
                  </button>
                </div>
              ) : (
                <span className="text-xs text-[var(--color-fg-muted)]">
                  JPG, PNG, or another image up to 5 MB
                </span>
              )}
            </div>
          </div>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-[var(--color-fg-secondary)]">
            Or use an image URL <span className="text-[var(--color-fg-muted)]">(optional)</span>
          </span>
          <AuthTextInput
            type="url"
            inputMode="url"
            placeholder="https://example.com/avatar.png"
            value={avatarUrl}
            onChange={(e) => {
              setAvatarUrl(e.target.value);
              if (e.target.value) setAvatarFile(null);
            }}
            disabled={submitting}
            maxLength={512}
            aria-label="Avatar URL"
          />
        </label>
        <AuthButton type="submit" disabled={submitting}>
          {submitting ? "Saving…" : "Continue"}
        </AuthButton>
      </form>
    </AuthCard>
  );
}
