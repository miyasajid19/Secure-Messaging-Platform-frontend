"use client";

/**
 * Phase 9.5 — public landing page at `/`.
 *
 * The chat shell moved to `/chat` in this phase, so the root URL is now
 * a marketing-style page that describes the project and funnels users
 * into the demo. No auth is required to view this page. The floating
 * login widget (components/floating-login-widget.tsx) is mounted here
 * and stays accessible for unauthenticated visitors.
 *
 * Sections, top-to-bottom:
 *   1. Hero (title + tagline + CTAs + credit)
 *   2. Features grid (8 cards with lucide icons)
 *   3. Tech stack strip (chip badges)
 *   4. How it works (3 numbered steps)
 *   5. Footer (credit + social links)
 *
 * Tokens live in `app/tokens.css`. The page uses CSS variables only;
 * no raw color literals — that lets the existing dark-mode palette
 * (Phase 8.3) flip in for free when `<html data-theme="dark">` is set.
 */

import Link from "next/link";
import {
  CheckCheck,
  Eye,
  Globe,
  Mail,
  MessageCircle,
  Phone,
  Reply,
  Smile,
  Timer,
  UserCircle,
  Users,
} from "lucide-react";
import { FloatingLoginWidget } from "@/components/floating-login-widget";

const GITHUB_URL = "https://github.com/miyasajid19";
const LINKEDIN_URL = "https://linkedin.com/in/sajidmiya";
const EMAIL_URL = "mailto:me@sajidmiya.tech";

const FEATURES = [
  {
    icon: Phone,
    title: "Mocked OTP auth",
    body: "Phone + 123456 → instant login, no real OTP needed.",
  },
  {
    icon: MessageCircle,
    title: "Real-time 1-on-1 chat",
    body: "WebSocket-driven, sub-second delivery.",
  },
  {
    icon: Users,
    title: "Group messaging",
    body: "Create groups, add/remove members, admin controls.",
  },
  {
    icon: CheckCheck,
    title: "Read receipts & typing",
    body: "Single/double checks, real-time typing indicators.",
  },
  {
    icon: Eye,
    title: 'Per-message "seen by"',
    body: "Messenger-style avatars showing who read each message.",
  },
  {
    icon: Smile,
    title: "Message reactions",
    body: "Long-press to react with emoji, real-time updates.",
  },
  {
    icon: Reply,
    title: "Reply / quoted messages",
    body: "Quote any message when replying.",
  },
  {
    icon: Timer,
    title: "Disappearing messages",
    body: "Per-conversation auto-delete (1h / 24h / 1w).",
  },
] as const;

const TECH_STRIP_FRONTEND = [
  "Next.js 16",
  "React 19",
  "TypeScript",
  "Tailwind v4",
  "Zustand",
  "TanStack Query",
];

const TECH_STRIP_BACKEND = [
  "FastAPI",
  "SQLAlchemy",
  "SQLite (WAL)",
  "PyJWT",
  "WebSockets",
];

const TECH_STRIP_DEPLOY = ["Railway (backend)", "Vercel (frontend)"];

const STEPS = [
  {
    title: "Sign in",
    body: "Phone + any 6-digit code (123456 for the demo).",
  },
  {
    title: "Pick a contact",
    body: "Alice (seeded), or add a new one by phone.",
  },
  {
    title: "Chat in real time",
    body: "Open another tab as Bob, send a message, see it instantly.",
  },
] as const;

export default function LandingPage() {
  return (
    <main
      className="min-h-screen w-full"
      style={{ backgroundColor: "var(--color-bg-primary)" }}
    >
      <Hero />
      <Features />
      <TechStrip />
      <HowItWorks />
      <Footer />
      <FloatingLoginWidget />
    </main>
  );
}

function Hero() {
  return (
    <section
      className="relative w-full"
      style={{ background: "var(--color-hero-bg)" }}
    >
      <div className="mx-auto flex max-w-5xl flex-col items-center px-6 pb-20 pt-24 text-center sm:pt-32">
        <span
          className="mb-4 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium"
          style={{
            backgroundColor: "var(--color-chip-bg)",
            color: "var(--color-chip-fg)",
          }}
        >
          <span
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: "var(--color-status-online)" }}
            aria-hidden
          />
          Live demo · Real-time WebSockets
        </span>
        <h1 className="text-5xl font-semibold tracking-tight text-[var(--color-fg-primary)] sm:text-6xl">
          Signal Clone
        </h1>
        <p className="mt-5 max-w-2xl text-balance text-lg leading-relaxed text-[var(--color-fg-secondary)]">
          A full-stack real-time messenger built as an assignment — Next.js,
          FastAPI, WebSockets, SQLite.
        </p>
        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row">
          <Link
            href="/auth/phone"
            className="inline-flex items-center justify-center rounded-lg px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:opacity-95 focus:outline-none focus:ring-2 focus:ring-offset-2"
            style={{
              backgroundColor: "var(--color-accent)",
              boxShadow: "var(--color-card-shadow)",
            }}
          >
            Try the demo
          </Link>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-lg border px-5 py-2.5 text-sm font-semibold transition hover:bg-[var(--color-bg-tertiary)]"
            style={{
              borderColor: "var(--color-border-default)",
              color: "var(--color-fg-primary)",
            }}
          >
            <Globe size={16} aria-hidden />
            View source on GitHub
          </a>
        </div>
        <p className="mt-8 text-xs text-[var(--color-fg-muted)]">
          Built by Sajid Miya
        </p>
      </div>
    </section>
  );
}

function Features() {
  return (
    <section className="w-full">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <header className="mb-10 flex flex-col items-center text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-[var(--color-fg-primary)] sm:text-4xl">
            What's in the demo
          </h2>
          <p className="mt-3 max-w-xl text-[var(--color-fg-secondary)]">
            Eight features wired end-to-end against the FastAPI backend.
          </p>
        </header>
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <li
              key={title}
              className="group flex flex-col gap-2 rounded-2xl border bg-[var(--color-bg-primary)] p-5 transition hover:-translate-y-0.5"
              style={{
                borderColor: "var(--color-card-border)",
                boxShadow: "var(--color-card-shadow)",
              }}
            >
              <span
                className="mb-1 inline-flex h-10 w-10 items-center justify-center rounded-xl"
                style={{
                  backgroundColor: "var(--color-chip-bg)",
                  color: "var(--color-hero-accent)",
                }}
              >
                <Icon size={20} aria-hidden />
              </span>
              <h3 className="text-sm font-semibold text-[var(--color-fg-primary)]">
                {title}
              </h3>
              <p className="text-sm leading-relaxed text-[var(--color-fg-secondary)]">
                {body}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function TechStrip() {
  return (
    <section
      className="w-full"
      style={{ backgroundColor: "var(--color-section-alt)" }}
    >
      <div className="mx-auto max-w-6xl px-6 py-12">
        <h2 className="mb-6 text-center text-sm font-semibold uppercase tracking-wider text-[var(--color-fg-muted)]">
          Tech stack
        </h2>
        <div className="flex flex-col items-center gap-4">
          <ChipRow label="Frontend" items={TECH_STRIP_FRONTEND} />
          <ChipRow label="Backend" items={TECH_STRIP_BACKEND} />
          <ChipRow label="Deploy" items={TECH_STRIP_DEPLOY} />
        </div>
      </div>
    </section>
  );
}

function ChipRow({ label, items }: { label: string; items: readonly string[] }) {
  return (
    <div className="flex flex-col items-center gap-2 sm:flex-row sm:gap-3">
      <span className="text-xs font-medium text-[var(--color-fg-muted)]">
        {label}:
      </span>
      <ul className="flex flex-wrap justify-center gap-2">
        {items.map((item) => (
          <li
            key={item}
            className="rounded-full px-3 py-1 text-xs font-medium"
            style={{
              backgroundColor: "var(--color-chip-bg)",
              color: "var(--color-chip-fg)",
            }}
          >
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function HowItWorks() {
  return (
    <section
      className="w-full"
      style={{ backgroundColor: "var(--color-section-alt)" }}
    >
      <div className="mx-auto max-w-5xl px-6 py-20">
        <header className="mb-10 flex flex-col items-center text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-[var(--color-fg-primary)] sm:text-4xl">
            How it works
          </h2>
        </header>
        <ol className="grid grid-cols-1 gap-5 md:grid-cols-3">
          {STEPS.map((step, idx) => (
            <li
              key={step.title}
              className="flex flex-col gap-3 rounded-2xl border bg-[var(--color-bg-primary)] p-6"
              style={{
                borderColor: "var(--color-card-border)",
                boxShadow: "var(--color-card-shadow)",
              }}
            >
              <span
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold text-white"
                style={{ backgroundColor: "var(--color-hero-accent)" }}
                aria-hidden
              >
                {idx + 1}
              </span>
              <h3 className="text-base font-semibold text-[var(--color-fg-primary)]">
                {step.title}
              </h3>
              <p className="text-sm leading-relaxed text-[var(--color-fg-secondary)]">
                {step.body}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer
      className="w-full border-t"
      style={{
        borderColor: "var(--color-divider-soft)",
        backgroundColor: "var(--color-bg-primary)",
      }}
    >
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-6 py-10 text-center">
        <p className="text-sm font-medium text-[var(--color-fg-primary)]">
          Built by Sajid Miya · Full-stack demo
        </p>
        <ul className="flex items-center gap-4">
          <li>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              aria-label="GitHub"
              className="flex h-10 w-10 items-center justify-center rounded-full transition hover:bg-[var(--color-bg-tertiary)]"
              style={{ color: "var(--color-fg-secondary)" }}
            >
              <Globe size={18} aria-hidden />
            </a>
          </li>
          <li>
            <a
              href={LINKEDIN_URL}
              target="_blank"
              rel="noreferrer"
              aria-label="LinkedIn"
              className="flex h-10 w-10 items-center justify-center rounded-full transition hover:bg-[var(--color-bg-tertiary)]"
              style={{ color: "var(--color-fg-secondary)" }}
            >
              <UserCircle size={18} aria-hidden />
            </a>
          </li>
          <li>
            <a
              href={EMAIL_URL}
              aria-label="Email"
              className="flex h-10 w-10 items-center justify-center rounded-full transition hover:bg-[var(--color-bg-tertiary)]"
              style={{ color: "var(--color-fg-secondary)" }}
            >
              <Mail size={18} aria-hidden />
            </a>
          </li>
        </ul>
        <p className="text-xs text-[var(--color-fg-muted)]">
          Powered by Next.js + FastAPI
        </p>
      </div>
    </footer>
  );
}