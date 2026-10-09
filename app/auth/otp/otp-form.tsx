"use client";

/**
 * Phase 2 — OTP entry (client logic).
 *
 * Reads `phone` from the query string (set by `/auth/phone`), validates
 * against `/auth/verify-otp`, persists the returned JWT+user to the
 * auth store, then routes to `/onboarding` if the user still needs to
 * pick a display name, or `/` otherwise.
 *
 * The demo OTP hint is visible in production so visitors can complete
 * the seeded-account sign-in without a real SMS provider.
 *
 * This component is rendered inside a `<Suspense>` boundary by the
 * parent `page.tsx` because it calls `useSearchParams`, which would
 * otherwise force the whole route out of prerender.
 */

import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { KeyRound } from "lucide-react";
import { AuthCard, AuthButton, AuthTextInput } from "@/components/auth/auth-card";
import { verifyOtp, ApiError } from "@/lib/api";
import { useAuthStore } from "@/store/auth";

const MOCK_OTP = "123456";

export function OtpForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const phone = searchParams.get("phone") ?? "";
  const setAuth = useAuthStore((s) => s.setAuth);

  const [otp, setOtp] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!phone) {
      toast.error("Missing phone number — go back and re-enter it.");
      router.replace("/auth/phone");
      return;
    }
    const trimmed = otp.trim();
    if (!trimmed) {
      toast.error("Enter the 6-digit code");
      return;
    }
    setSubmitting(true);
    try {
      const { token, user } = await verifyOtp(phone, trimmed);
      setAuth(token, user);
      // Phase 9.5 — chat shell moved to /chat. Push new users to
      // onboarding, existing users directly into the chat.
      router.push(user.display_name && user.username ? "/chat" : "/onboarding");
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Invalid code";
      toast.error(message);
      setOtp("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthCard
      title="Enter your code"
      subtitle={
        phone ? (
          <>
            Sent to{" "}
            <span className="font-medium text-[var(--color-fg-primary)]">
              {phone}
            </span>
          </>
        ) : (
          "Sent to your phone."
        )
      }
      footer={
        <button
          type="button"
          className="text-[var(--color-accent)] hover:underline"
          onClick={() => router.push("/auth/phone")}
        >
          Use a different number
        </button>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-[var(--color-fg-secondary)]">
            6-digit code
          </span>
          <div className="relative">
            <KeyRound
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-fg-muted)]"
              size={16}
              aria-hidden
            />
            <AuthTextInput
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              autoFocus
              placeholder="123456"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              disabled={submitting}
              required
              className="pl-9 tracking-[0.4em] text-center"
              aria-label="One-time code"
            />
          </div>
        </label>
        <AuthButton type="submit" disabled={submitting || otp.length === 0}>
          {submitting ? "Verifying…" : "Verify"}
        </AuthButton>
        <button
          type="button"
          onClick={() => setOtp(MOCK_OTP)}
          className="text-xs text-[var(--color-fg-muted)] hover:text-[var(--color-fg-secondary)]"
          disabled={submitting}
        >
          Use demo code {MOCK_OTP}
        </button>
      </form>
    </AuthCard>
  );
}
