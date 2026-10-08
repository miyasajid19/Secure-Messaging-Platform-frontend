/**
 * Server-component shell for `/auth/otp`.
 *
 * Wraps the client form in `<Suspense>` because `useSearchParams` would
 * otherwise bail the entire route out of prerender. The fallback keeps
 * the layout stable during the brief window where search params resolve.
 */

import { Suspense } from "react";
import { OtpForm } from "./otp-form";

export default function OtpPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-full items-center justify-center">
          <p className="text-sm text-[var(--color-fg-muted)]">Loading…</p>
        </main>
      }
    >
      <OtpForm />
    </Suspense>
  );
}
