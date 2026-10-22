"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { firebasePhoneError, getPhoneAuthRecaptchaToken } from "@/lib/firebase-auth";
import { requestOtp, ApiError } from "@/lib/api";
import { isValidPhoneNumber } from "@/lib/phone";
import { useAuthStore } from "@/store/auth";
import { PhoneNumberInput } from "@/components/auth/phone-number-input";

export default function SignInPage() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const token = useAuthStore((state) => state.token);
  const user = useAuthStore((state) => state.user);
  const hydrated = useAuthStore((state) => state.hydrated);

  useEffect(() => {
    if (!hydrated || !token) return;
    router.replace(user?.display_name && user.username ? "/chat" : "/onboarding");
  }, [hydrated, token, user, router]);

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
    <main className="relative isolate flex min-h-screen items-center justify-center overflow-hidden bg-[var(--color-bg-secondary)] px-4 py-10 sm:px-6">
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -right-40 -top-44 h-[30rem] w-[30rem] rounded-full border border-[var(--color-border-subtle)] opacity-70" />
        <div className="absolute -right-24 -top-28 h-[22rem] w-[22rem] rounded-full border border-[var(--color-border-default)] opacity-50" />
        <div className="absolute -bottom-64 -left-40 h-[34rem] w-[34rem] rounded-full border border-[var(--color-border-subtle)] opacity-70" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,var(--color-bg-primary)_0%,transparent_68%)] opacity-55" />
      </div>

      <section
        aria-labelledby="signin-title"
        className="relative w-full max-w-[440px] rounded-[26px] border bg-[var(--color-bg-primary)] px-6 py-7 shadow-xl sm:px-9 sm:py-9"
        style={{
          borderColor: "var(--color-border-subtle)",
          boxShadow: "var(--color-card-shadow)",
        }}
      >
        <header className="mb-7 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-[17px] bg-[var(--color-accent)] text-white shadow-sm">
            <MessageCircle size={23} strokeWidth={2.2} aria-hidden />
          </div>
          <p className="text-sm font-semibold text-[var(--color-fg-primary)]">Signal Clone</p>
          <h1 id="signin-title" className="mt-2 text-[1.65rem] font-semibold tracking-tight text-[var(--color-fg-primary)]">
            Sign in to your chats
          </h1>
          <p className="mx-auto mt-2 max-w-xs text-sm leading-6 text-[var(--color-fg-secondary)]">
            Enter your phone number to continue.
          </p>
        </header>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <label className="text-sm font-medium text-[var(--color-fg-primary)]">
            Phone number
          </label>
          <PhoneNumberInput
            id="phone"
            value={phone}
            onChange={setPhone}
            disabled={submitting}
            autoFocus
          />
          <button
            type="submit"
          disabled={submitting || !isValidPhoneNumber(phone.trim())}
            className="mt-1 inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[var(--color-accent)] px-4 py-3 text-sm font-semibold text-white transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-55"
          >
            {submitting ? "Continuing…" : "Continue"}
            {!submitting ? <ArrowRight size={16} aria-hidden /> : null}
          </button>
        </form>
        <div id="phone-signin-recaptcha" />
        <p className="mt-3 text-center text-[11px] leading-5 text-[var(--color-fg-muted)]">
          Firebase will send a verification code by SMS.
        </p>
      </section>
    </main>
  );
}
