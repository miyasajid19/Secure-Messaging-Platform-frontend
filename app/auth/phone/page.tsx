"use client";

/**
 * Phone entry. Firebase sends the SMS, then the user enters its code on
 * `/auth/otp?phone=…`.
 *
 * Server-side state: none. The phone is passed via query string so the
 * user can refresh on the OTP page without re-typing.
 */

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AuthCard, AuthButton } from "@/components/auth/auth-card";
import { getPhoneAuthRecaptchaToken, firebasePhoneError } from "@/lib/firebase-auth";
import { requestOtp, ApiError } from "@/lib/api";
import { isValidPhoneNumber } from "@/lib/phone";
import { PhoneNumberInput } from "@/components/auth/phone-number-input";

export default function PhonePage() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = phone.trim();
    if (!isValidPhoneNumber(trimmed)) {
      toast.error("Enter a valid phone number with country code, such as +919876543210.");
      return;
    }
    setSubmitting(true);
    try {
      const recaptchaToken = await getPhoneAuthRecaptchaToken("phone-signin-recaptcha");
      const { session_info } = await requestOtp(trimmed, recaptchaToken);
      sessionStorage.setItem("phone-otp-session", session_info);
      sessionStorage.setItem("phone-otp-number", trimmed);
      router.push(`/auth/otp?phone=${encodeURIComponent(trimmed)}`);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : firebasePhoneError(error));
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
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-[var(--color-fg-secondary)]">
            Phone number
          </span>
          <PhoneNumberInput
            id="phone"
            value={phone}
            onChange={setPhone}
            disabled={submitting}
            autoFocus
          />
        </div>
        <AuthButton type="submit" disabled={submitting || !isValidPhoneNumber(phone.trim())}>
          {submitting ? "Sending…" : "Continue"}
        </AuthButton>
      </form>
      <div id="phone-signin-recaptcha" />
    </AuthCard>
  );
}
