"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Mail } from "lucide-react";
import { toast } from "sonner";
import { AuthButton, AuthCard, AuthTextInput } from "@/components/auth/auth-card";
import { completeFirebaseEmailLink } from "@/lib/firebase-auth";
import { ApiError, verifyOtp } from "@/lib/api";
import { useAuthStore } from "@/store/auth";

const EMAIL_KEY = "firebase-email-link-address";

export function EmailLinkForm() {
  const router = useRouter();
  const setAuth = useAuthStore((state) => state.setAuth);
  const [email, setEmail] = useState("");
  const [ready, setReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const attempted = useRef(false);

  async function finishSignIn(address: string) {
    if (submitting) return;
    setSubmitting(true);
    try {
      const firebaseIdToken = await completeFirebaseEmailLink(address, window.location.href);
      const { token, user, account_reactivated } = await verifyOtp({ email: address, firebase_id_token: firebaseIdToken });
      localStorage.removeItem(EMAIL_KEY);
      setAuth(token, user);
      if (account_reactivated) toast.success("Your account is active again. The pending change has been canceled.");
      router.replace(user.display_name && user.username ? "/chat" : "/onboarding");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : error instanceof Error ? error.message : "Could not complete email sign-in");
      setSubmitting(false);
    }
  }

  useEffect(() => {
    const savedEmail = localStorage.getItem(EMAIL_KEY) ?? "";
    setEmail(savedEmail);
    setReady(true);
    // On the device where sign-in started, finish automatically. A link opened
    // elsewhere requires re-entering the same address as a safety check.
    if (savedEmail && !attempted.current) {
      attempted.current = true;
      void finishSignIn(savedEmail);
    }
  // This callback only runs on mount, after the URL and browser storage exist.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const address = email.trim().toLowerCase();
    if (!address) return;
    await finishSignIn(address);
  }

  return <AuthCard title="Finish signing in" subtitle="Verify the email address that received this Firebase link.">
    {!ready || submitting ? <p className="text-center text-sm text-[var(--color-fg-secondary)]">{submitting ? "Verifying your sign-in link…" : "Loading…"}</p> : <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <label htmlFor="email-link-address" className="flex flex-col gap-2 text-sm font-medium text-[var(--color-fg-primary)]">Email address
        <span className="relative"><Mail size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-fg-muted)]" aria-hidden /><AuthTextInput id="email-link-address" type="email" autoComplete="email" autoFocus={!email} required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" className="pl-10" /></span>
      </label>
      <AuthButton type="submit">Verify email link</AuthButton>
      <p className="text-center text-xs leading-5 text-[var(--color-fg-muted)]">Use the same email address where the link was delivered.</p>
    </form>}
  </AuthCard>;
}
