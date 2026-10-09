"use client";

/**
 * Phase 2 — Phone entry. Posts to `/auth/request-otp`, then routes to
 * `/auth/otp?phone=…` where the user enters (or pastes) the OTP.
 *
 * Server-side state: none. The phone is passed via query string so the
 * user can refresh on the OTP page without re-typing.
 */

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Phone } from "lucide-react";
import { AuthCard, AuthButton, AuthTextInput } from "@/components/auth/auth-card";
import { requestOtp, ApiError } from "@/lib/api";

export default function PhonePage() {
  const router = useRouter();
  const [phone, setPhone] = useState("+1");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = phone.trim();
    if (!trimmed) {
      toast.error("Phone number is required");
      return;
    }
    setSubmitting(true);
    try {
      await requestOtp(trimmed);
      router.push(`/auth/otp?phone=${encodeURIComponent(trimmed)}`);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Failed to send OTP";
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthCard
      title="Sign in to Signal Clone"
      subtitle="We'll text you a verification code."
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-[var(--color-fg-secondary)]">
            Phone number
          </span>
          <div className="relative">
            <Phone
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-fg-muted)]"
              size={16}
              aria-hidden
            />
            <AuthTextInput
              type="tel"
              inputMode="tel"
              autoFocus
              autoComplete="tel"
              placeholder="+919000000001"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={submitting}
              required
              className="pl-9"
              aria-label="Phone number"
            />
          </div>
        </label>
        <AuthButton type="submit" disabled={submitting}>
          {submitting ? "Sending…" : "Continue"}
        </AuthButton>
      </form>
    </AuthCard>
  );
}
