/**
 * Typed access to public environment variables.
 *
 * All `NEXT_PUBLIC_*` vars are inlined into the client bundle at build time,
 * so we read them via direct property access on `process.env` (dynamic lookups
 * are NOT inlined by Next.js).
 *
 * See: https://nextjs.org/docs/app/guides/environment-variables
 */

type PublicEnv = {
  apiUrl: string;
  wsUrl: string;
};

const isProd = process.env.NODE_ENV === "production";

function required(name: string, fallback?: string): string {
  // `process.env[name]` works at build time but is not reliably typed.
  // We use bracket access on a typed record to satisfy TS without losing inlining.
  const value = (process.env as Record<string, string | undefined>)[name];
  if (value && value.length > 0) return value;
  if (fallback !== undefined) {
    if (isProd) {
      throw new Error(
        `[env] Missing required public env var ${name} in production. ` +
          `Set it in your deployment environment.`,
      );
    }
    return fallback;
  }
  // Dev: fail fast so misconfiguration is obvious during `npm run dev`.
  throw new Error(
    `[env] Missing required public env var ${name}. ` +
      `Copy .env.example to .env.local and fill it in.`,
  );
}

export const env: PublicEnv = {
  apiUrl: required("NEXT_PUBLIC_API_URL", "http://localhost:8000"),
  wsUrl: required("NEXT_PUBLIC_WS_URL", "ws://localhost:8000/ws"),
};
