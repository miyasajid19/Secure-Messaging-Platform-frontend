"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, MessageCircle, Phone, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { ApiError, requestOtp } from "@/lib/api";
import { useAuthStore } from "@/store/auth";

const DEMO_ACCOUNTS = [
  { name: "Alice Chen", phone: "+15550000001" },
  { name: "Bob Martinez", phone: "+15550000002" },
  { name: "Carol Singh", phone: "+15550000003" },
  { name: "Dan O'Brien", phone: "+15550000004" },
  { name: "Eve Tanaka", phone: "+15550000005" },
  { name: "Maya Brooks", phone: "+15550000006" },
  { name: "Noah Williams", phone: "+15550000007" },
] as const;

export default function SignInPage() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
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
    if (!trimmed) {
      toast.error("Enter a phone number to continue");
      return;
    }

    setSubmitting(true);
    try {
      await requestOtp(trimmed);
      router.push(`/auth/otp?phone=${encodeURIComponent(trimmed)}`);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Couldn't start sign-in");
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
            Choose a seeded account or enter a phone number to continue.
          </p>
        </header>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <label htmlFor="phone" className="text-sm font-medium text-[var(--color-fg-primary)]">
            Phone number
          </label>
          <div className="relative -mt-2">
            <Phone
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-fg-muted)]"
              size={17}
              aria-hidden
            />
            <input
              id="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              autoFocus
              required
              value={phone}
              onChange={(event) => {
                setPhone(event.target.value);
                setSelectedPhone(null);
              }}
              placeholder="+1 555 000 0001"
              disabled={submitting}
              className="min-h-12 w-full rounded-xl border bg-[var(--color-bg-primary)] py-2 pl-10 pr-3 text-base text-[var(--color-fg-primary)] outline-none transition focus:border-[var(--color-accent)] focus:ring-4 focus:ring-blue-500/10 disabled:opacity-60"
              style={{ borderColor: "var(--color-border-default)" }}
            />
          </div>
          <button
            type="submit"
            disabled={submitting || !phone.trim()}
            className="mt-1 inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[var(--color-accent)] px-4 py-3 text-sm font-semibold text-white transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-55"
          >
            {submitting ? "Continuing…" : "Continue"}
            {!submitting ? <ArrowRight size={16} aria-hidden /> : null}
          </button>
        </form>

        <div className="my-6 flex items-center gap-3" aria-hidden>
          <span className="h-px flex-1 bg-[var(--color-border-subtle)]" />
          <span className="text-[11px] font-medium text-[var(--color-fg-muted)]">DEMO ACCOUNTS</span>
          <span className="h-px flex-1 bg-[var(--color-border-subtle)]" />
        </div>

        <ul className="grid grid-cols-2 gap-2" aria-label="Seeded demo accounts">
          {DEMO_ACCOUNTS.map((account) => {
            const selected = selectedPhone === account.phone;
            return (
              <li key={account.phone}>
                <button
                  type="button"
                  onClick={() => {
                    setPhone(account.phone);
                    setSelectedPhone(account.phone);
                  }}
                  disabled={submitting}
                  aria-pressed={selected}
                  className={`flex min-h-[58px] w-full flex-col items-start justify-center rounded-xl border px-3 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] ${
                    selected
                      ? "border-[var(--color-accent)]"
                      : "border-[var(--color-border-subtle)] hover:bg-[var(--color-bg-secondary)]"
                  }`}
                  style={
                    selected
                      ? {
                          backgroundColor:
                            "color-mix(in srgb, var(--color-accent) 9%, var(--color-bg-primary))",
                        }
                      : undefined
                  }
                >
                  <span className="text-xs font-semibold text-[var(--color-fg-primary)]">{account.name}</span>
                  <span className="mt-0.5 text-[11px] text-[var(--color-fg-muted)]">{account.phone}</span>
                </button>
              </li>
            );
          })}
        </ul>

        <div className="mt-4 flex items-center justify-center gap-2 rounded-xl bg-[var(--color-bg-secondary)] px-3 py-2.5 text-xs text-[var(--color-fg-secondary)]">
          <ShieldCheck size={15} className="shrink-0 text-[var(--color-accent)]" aria-hidden />
          <span>Demo verification code</span>
          <code className="rounded-md bg-[var(--color-bg-primary)] px-1.5 py-0.5 font-semibold tracking-[0.16em] text-[var(--color-fg-primary)]">123456</code>
        </div>

        <p className="mt-5 text-center text-[11px] leading-5 text-[var(--color-fg-muted)]">
          No SMS is sent. This demo uses seeded conversations and a fixed code.
        </p>
      </section>
    </main>
  );
}
