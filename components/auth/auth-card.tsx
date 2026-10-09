/**
 * Reusable card chrome for the onboarding pages (`/auth/*`).
 *
 * Keeps the three pages visually consistent without pulling in a heavy
 * UI lib — Phase 3 will rebuild the shell, this is intentionally small.
 *
 * Spec: @task.md §7 ("Visual style for auth pages").
 */

import type { ReactNode } from "react";

interface AuthCardProps {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}

export function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: AuthCardProps) {
  return (
    <main className="flex min-h-full items-center justify-center px-4 py-10">
      <div
        className="w-full max-w-[360px] rounded-2xl border bg-[var(--color-bg-primary)] p-6 shadow-sm"
        style={{
          borderColor: "var(--color-border-subtle)",
        }}
      >
        <header className="mb-6 flex flex-col items-center gap-2 text-center">
          <h1 className="text-xl font-semibold tracking-tight text-[var(--color-fg-primary)]">
            {title}
          </h1>
          {subtitle ? (
            <p className="text-sm text-[var(--color-fg-secondary)]">
              {subtitle}
            </p>
          ) : null}
        </header>
        {children}
        {footer ? (
          <div className="mt-6 border-t pt-4 text-center text-sm text-[var(--color-fg-secondary)]">
            {footer}
          </div>
        ) : null}
      </div>
    </main>
  );
}

/** Text input styled to match the auth cards. */
export function AuthTextInput(
  props: React.InputHTMLAttributes<HTMLInputElement>,
) {
  return (
    <input
      {...props}
      className={`w-full min-h-[44px] rounded-lg border bg-[var(--color-bg-primary)] px-3 py-2 text-base text-[var(--color-fg-primary)] outline-none transition focus:ring-2 ${
        props.className ?? ""
      }`}
      style={{
        borderColor: "var(--color-border-default)",
      }}
    />
  );
}

/** Primary button — accent bg, white text, rounded-lg, full width. */
export function AuthButton(
  props: React.ButtonHTMLAttributes<HTMLButtonElement>,
) {
  return (
    <button
      {...props}
      className={`inline-flex w-full min-h-[44px] items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition active:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 ${
        props.className ?? ""
      }`}
      style={{
        backgroundColor: "var(--color-accent)",
        color: "var(--color-accent-fg)",
      }}
    />
  );
}
