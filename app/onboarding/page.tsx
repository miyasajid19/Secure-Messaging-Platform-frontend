"use client";

/**
 * Phase 2 — onboarding / profile setup.
 *
 * Lives at `/onboarding` rather than `/auth/profile` to keep the URL
 * semantically aligned with the redirect target from `/auth/otp`. The
 * card shares the same chrome as the other auth pages.
 *
 * Fields: display name (required) + avatar URL (optional). Username is
 * skipped for v1 to keep the flow short; can be added in Phase 7.
 */

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { UserCircle2 } from "lucide-react";
import { AuthCard, AuthButton, AuthTextInput } from "@/components/auth/auth-card";
import {
  ApiError,
  type User,
  updateProfile,
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
  const [avatarUrl, setAvatarUrl] = useState(storedUser?.avatar_url ?? "");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (hydrated && !token) {
      router.replace("/auth/phone");
    }
  }, [hydrated, token, router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = displayName.trim();
    if (!trimmedName) {
      toast.error("Display name is required");
      return;
    }
    setSubmitting(true);
    try {
      const updated: User = await updateProfile({
        display_name: trimmedName,
        avatar_url: avatarUrl.trim() || undefined,
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
            Avatar URL <span className="text-[var(--color-fg-muted)]">(optional)</span>
          </span>
          <AuthTextInput
            type="url"
            inputMode="url"
            placeholder="https://example.com/avatar.png"
            value={avatarUrl}
            onChange={(e) => setAvatarUrl(e.target.value)}
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
