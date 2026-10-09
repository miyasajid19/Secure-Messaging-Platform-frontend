/**
 * Typed access to public environment variables.
 *
 * All `NEXT_PUBLIC_*` vars are inlined into the client bundle at build time.
 * They must be referenced directly as `process.env.NEXT_PUBLIC_*`; dynamic
 * lookups are not replaced in browser bundles and silently select defaults.
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

// Keep these as static property references. Next.js replaces them with
// the values loaded from the frontend .env when the dev server/build starts.
export const env: PublicEnv = {
  apiUrl: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000",
  wsUrl: process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8000/ws",
};
