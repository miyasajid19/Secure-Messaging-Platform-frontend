/**
 * Typed access to public environment variables.
 *
 * All `NEXT_PUBLIC_*` vars are inlined into the client bundle at build time,
 * so we read them via direct property access on `process.env` (dynamic lookups
 * are NOT inlined by Next.js).
 *
 * See: https://nextjs.org/docs/app/guides/environment-variables
 *
 * Why fallbacks are kept even in production: a fresh Vercel deploy may be
 * live before its env vars are configured. The Providers tree wraps every
 * page, so a throw here would crash the whole site ("This page couldn't
 * load") for a problem the user can fix in 30 s. We let the values flow
 * through; API calls will fail with toasts the user can see, and the
 * landing page renders fine on its own (it doesn't talk to the backend).
 */

type PublicEnv = {
  apiUrl: string;
  wsUrl: string;
};

function readOrDefault(name: string, fallback: string): string {
  // `process.env[name]` works at build time but is not reliably typed.
  // We use bracket access on a typed record to satisfy TS without losing inlining.
  const value = (process.env as Record<string, string | undefined>)[name];
  if (value && value.length > 0) return value;
  return fallback;
}

export const env: PublicEnv = {
  apiUrl: readOrDefault("NEXT_PUBLIC_API_URL", "http://localhost:8000"),
  wsUrl: readOrDefault("NEXT_PUBLIC_WS_URL", "wss://secure-messaging-platform-backend.onrender.com/ws"),
};
