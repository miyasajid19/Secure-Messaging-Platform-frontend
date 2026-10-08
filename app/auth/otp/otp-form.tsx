"use client";

/**
 * Phase 2 — OTP entry (client logic).
 *
 * Reads `phone` from the query string (set by `/auth/phone`), validates
 * against `/auth/verify-otp`, persists the returned JWT+user to the
 * auth store, then routes to `/onboarding` if the user still needs to
 * pick a display name, or `/` otherwise.
 *
 * The "Use 123456" hint button autofills the mock OTP — it's a dev aid
 * gated behind a NODE_ENV check so production builds don't show it.
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
      router.push(user.display_name ? "/" : "/onboarding");
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Invalid code";
      toast.error(message);
      setOtp("");
    } finally {
      setSubmitting(false);
    }
  }

  const showMockHint =
    typeof process !== "undefined" && process.env.NODE_ENV !== "production";

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
        {showMockHint ? (
          <button
            type="button"
            onClick={() => setOtp(MOCK_OTP)}
            className="text-xs text-[var(--color-fg-muted)] hover:text-[var(--color-fg-secondary)]"
            disabled={submitting}
          >
            Use {MOCK_OTP} (dev)
          </button>
        ) : null}
      </form>
    </AuthCard>
  );
}
