"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Mail, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { firebasePhoneError, getPhoneAuthRecaptchaToken } from "@/lib/firebase-auth";
import { requestOtp, ApiError } from "@/lib/api";
import { isValidPhoneNumber } from "@/lib/phone";
import { useAuthStore } from "@/store/auth";
import { PhoneNumberInput } from "@/components/auth/phone-number-input";

type Channel = "phone" | "email";
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function SignInForm() {
  const router = useRouter();
  const [channel, setChannel] = useState<Channel>("phone");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [emailLinkSent, setEmailLinkSent] = useState("");
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
    const destination = channel === "phone" ? phone.trim() : email.trim().toLowerCase();
    if (channel === "phone" && !isValidPhoneNumber(destination)) {
      toast.error("Enter a valid phone number with country code.");
      return;
    }
    if (channel === "email" && !emailPattern.test(destination)) {
      toast.error("Enter a valid email address.");
      return;
    }

    setSubmitting(true);
    try {
      const response = channel === "phone"
        ? await requestOtp({ phone: destination, recaptcha_token: await getPhoneAuthRecaptchaToken("phone-signin-recaptcha") })
        : await requestOtp({ email: destination });
      if (channel === "email" && response.channel === "email") {
        localStorage.setItem("firebase-email-link-address", destination);
        setEmailLinkSent(destination);
        return;
      }
      if (channel === "phone" && response.session_info) {
        sessionStorage.setItem("phone-otp-session", response.session_info);
        sessionStorage.setItem("phone-otp-number", destination);
        router.push(`/auth/otp?channel=phone&phone=${encodeURIComponent(destination)}`);
      } else {
        throw new Error("The server did not create a verification session. Please try again.");
      }
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
      <section aria-labelledby="signin-title" className="relative w-full max-w-[440px] rounded-[26px] border bg-[var(--color-bg-primary)] px-6 py-7 shadow-xl sm:px-9 sm:py-9" style={{ borderColor: "var(--color-border-subtle)", boxShadow: "var(--color-card-shadow)" }}>
        <header className="mb-7 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-[17px] bg-[var(--color-accent)] text-white shadow-sm"><MessageCircle size={23} strokeWidth={2.2} aria-hidden /></div>
          <p className="text-sm font-semibold text-[var(--color-fg-primary)]">Signal Clone</p>
          <h1 id="signin-title" className="mt-2 text-[1.65rem] font-semibold tracking-tight text-[var(--color-fg-primary)]">Sign in to your chats</h1>
          <p className="mx-auto mt-2 max-w-xs text-sm leading-6 text-[var(--color-fg-secondary)]">Choose phone verification or an email sign-in link.</p>
        </header>
        {emailLinkSent ? <div className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-secondary)] p-5 text-center">
          <Mail className="mx-auto mb-3 text-[var(--color-accent)]" size={24} aria-hidden />
          <h2 className="font-semibold text-[var(--color-fg-primary)]">Check your inbox</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--color-fg-secondary)]">Firebase sent a secure sign-in link to <strong className="break-all">{emailLinkSent}</strong>. Open it to finish signing in.</p>
          <button type="button" className="mt-4 text-sm font-medium text-[var(--color-accent)] hover:underline" onClick={() => setEmailLinkSent("")}>Use a different email</button>
        </div> : <>
        <div role="tablist" aria-label="Verification method" className="mb-5 grid grid-cols-2 rounded-xl bg-[var(--color-bg-secondary)] p-1">
          {(["phone", "email"] as const).map((method) => <button key={method} type="button" role="tab" aria-selected={channel === method} onClick={() => setChannel(method)} disabled={submitting} className={`min-h-10 rounded-lg text-sm font-medium capitalize transition ${channel === method ? "bg-[var(--color-bg-primary)] text-[var(--color-fg-primary)] shadow-sm" : "text-[var(--color-fg-secondary)] hover:text-[var(--color-fg-primary)]"}`}>{method === "phone" ? "Phone" : "Email"}</button>)}
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {channel === "phone" ? <>
            <label htmlFor="phone" className="text-sm font-medium text-[var(--color-fg-primary)]">Phone number</label>
            <PhoneNumberInput id="phone" value={phone} onChange={setPhone} disabled={submitting} autoFocus />
          </> : <label className="flex flex-col gap-2 text-sm font-medium text-[var(--color-fg-primary)]" htmlFor="email">Email address
            <span className="relative"><Mail size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-fg-muted)]" aria-hidden /><input id="email" type="email" autoComplete="email" autoFocus value={email} onChange={(event) => setEmail(event.target.value)} disabled={submitting} required placeholder="you@example.com" className="min-h-12 w-full rounded-xl border bg-[var(--color-bg-primary)] pl-10 pr-3 text-base text-[var(--color-fg-primary)] outline-none focus:border-[var(--color-accent)] focus:ring-4 focus:ring-blue-500/10 disabled:opacity-60" style={{ borderColor: "var(--color-border-default)" }} /></span>
          </label>}
          <button type="submit" disabled={submitting || (channel === "phone" ? !isValidPhoneNumber(phone.trim()) : !emailPattern.test(email.trim()))} className="mt-1 inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[var(--color-accent)] px-4 py-3 text-sm font-semibold text-white transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-55">
            {submitting ? "Sending…" : "Continue"}{!submitting && <ArrowRight size={16} aria-hidden />}
          </button>
        </form>
        {channel === "phone" && <><div id="phone-signin-recaptcha" /><p className="mt-3 text-center text-[11px] leading-5 text-[var(--color-fg-muted)]">Firebase will send a verification code by SMS.</p></>}
        {channel === "email" && <p className="mt-3 text-center text-[11px] leading-5 text-[var(--color-fg-muted)]">Firebase will send a passwordless sign-in link.</p>}
        </>}
      </section>
    </main>
  );
}
