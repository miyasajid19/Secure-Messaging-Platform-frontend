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

function configuredUrls(value: string | undefined, fallback: string): string[] {
  return (value || fallback)
    .split(",")
    .map((url) => url.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

function selectEndpoint(candidates: string[], fallback: string): string {
  const localPage =
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1");

  const matchingEndpoint = candidates.find((candidate) => {
    try {
      const hostname = new URL(candidate).hostname;
      const endpointIsLocal = hostname === "localhost" || hostname === "127.0.0.1";
      return endpointIsLocal === localPage;
    } catch {
      return false;
    }
  });

  return matchingEndpoint || candidates.find(isValidUrl) || fallback;
}

function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

const apiCandidates = configuredUrls(
  process.env.NEXT_PUBLIC_API_URL,
  "http://localhost:8000",
);
const wsCandidates = configuredUrls(
  process.env.NEXT_PUBLIC_WS_URL,
  "ws://localhost:8000/ws",
);
const apiUrl = selectEndpoint(apiCandidates, "http://localhost:8000");

function selectWebSocketEndpoint(): string {
  const configured = selectEndpoint(wsCandidates, "ws://localhost:8000/ws");

  try {
    const api = new URL(apiUrl);
    const websocket = new URL(configured);
    if (api.hostname === websocket.hostname) return configured;

    // API and WebSocket routes use the same backend host. If only one of
    // the comma-separated API/WS entries matches the current environment,
    // derive the WS origin from the selected API endpoint.
    return `${api.protocol === "https:" ? "wss:" : "ws:"}//${api.host}/ws`;
  } catch {
    return configured;
  }
}

// Keep these as static property references. Next.js replaces them with
// the values loaded from the frontend .env when the dev server/build starts.
export const env: PublicEnv = {
  apiUrl,
  wsUrl: selectWebSocketEndpoint(),
};
