"use client";

import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { KeyRound } from "lucide-react";
import { AuthCard, AuthButton, AuthTextInput } from "@/components/auth/auth-card";
import { verifyOtp, ApiError } from "@/lib/api";
import { useAuthStore } from "@/store/auth";

export function OtpForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const destination = searchParams.get("phone") ?? "";
  const setAuth = useAuthStore((s) => s.setAuth);
  const [otp, setOtp] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!destination) {
      toast.error("Phone number missing — go back and request a new code.");
      router.replace("/auth/phone");
      return;
    }
    const sessionInfo = sessionStorage.getItem("phone-otp-session");
    const requestedPhone = sessionStorage.getItem("phone-otp-number");
    if (!sessionInfo || requestedPhone !== destination) {
      toast.error("This verification session expired. Request a new code.");
      router.replace("/auth/phone");
      return;
    }
    setSubmitting(true);
    try {
      const { token, user, account_reactivated } = await verifyOtp({ phone: destination, session_info: sessionInfo, code: otp.trim() });
      sessionStorage.removeItem("phone-otp-session");
      sessionStorage.removeItem("phone-otp-number");
      setAuth(token, user);
      if (account_reactivated) toast.success("Your account is active again. The pending change has been canceled.");
      router.push(user.display_name && user.username ? "/chat" : "/onboarding");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : error instanceof Error ? error.message : "Couldn't verify the code");
      setOtp("");
    } finally {
      setSubmitting(false);
    }
  }

  return <AuthCard title="Enter your code" subtitle={<>Sent by SMS to <span className="font-medium text-[var(--color-fg-primary)]">{destination || "your phone"}</span></>} footer={<button type="button" className="text-[var(--color-accent)] hover:underline" onClick={() => router.push("/auth/phone")}>Use a different phone or email</button>}>
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-[var(--color-fg-secondary)]">6-digit code</span>
        <div className="relative">
          <KeyRound className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-fg-muted)]" size={16} aria-hidden />
          <AuthTextInput type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus placeholder="Enter SMS code" value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} disabled={submitting} required className="pl-9 tracking-[0.4em] text-center" aria-label="One-time code" />
        </div>
      </label>
      <AuthButton type="submit" disabled={submitting || otp.length !== 6}>{submitting ? "Verifying…" : "Verify"}</AuthButton>
    </form>
  </AuthCard>;
}
