/**
 * Typed API client + TanStack Query setup.
 *
 * `apiFetch` is the only place that talks to the backend over HTTP. It:
 *   - prepends `env.apiUrl` (from `lib/env.ts`)
 *   - attaches the JWT from the auth store as `Authorization: Bearer …`
 *   - parses JSON
 *   - throws a typed `ApiError` (with `status`) on non-2xx
 *
 * Read the auth token with `useAuthStore.getState().token` — that's a
 * synchronous, non-subscribing read, perfect for one-shot fetches.
 *
 * `getQueryClient()` returns a singleton `QueryClient` configured with
 * `staleTime: 30s` and `retry: false` (we surface 4xx errors to the user
 * instead of auto-retrying). Singleton + lazy init so the client survives
 * Next.js HMR without leaking observers.
 */

import { QueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/store/auth";
import { env } from "./env";

// --- types (mirror backend's `UserOut`) -------------------------------------

export interface User {
  id: number;
  phone: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  created_at: string;
  last_seen: string | null;
}

export interface RequestOtpResponse {
  sent: boolean;
  debug_otp: string;
}

export interface VerifyOtpResponse {
  token: string;
  user: User;
}

export interface ProfilePatch {
  display_name?: string;
  username?: string;
  avatar_url?: string;
}

// --- error -----------------------------------------------------------------

export class ApiError extends Error {
  status: number;
  /** Server-provided machine-readable code if FastAPI sent one. */
  code: string | null;
  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

// --- fetch wrapper ----------------------------------------------------------

interface ApiFetchInit extends Omit<RequestInit, "body"> {
  body?: unknown; // we JSON-serialize for callers
}

async function apiFetch<T>(
  path: string,
  init: ApiFetchInit = {},
): Promise<T> {
  const { body, headers, ...rest } = init;

  const finalHeaders = new Headers(headers);
  if (body !== undefined) {
    finalHeaders.set("content-type", "application/json");
  }
  finalHeaders.set("accept", "application/json");

  const token = useAuthStore.getState().token;
  if (token) {
    finalHeaders.set("authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${env.apiUrl}${path}`, {
    ...rest,
    headers: finalHeaders,
    body: body === undefined ? null : JSON.stringify(body),
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  const data: unknown = text ? JSON.parse(text) : null;

  if (!response.ok) {
    let message = response.statusText || "Request failed";
    let code: string | null = null;
    if (data && typeof data === "object" && data !== null) {
      const obj = data as Record<string, unknown>;
      if (typeof obj.detail === "string") message = obj.detail;
      if (typeof obj.code === "string") code = obj.code;
    }
    throw new ApiError(message, response.status, code);
  }

  return data as T;
}

// --- auth endpoints ---------------------------------------------------------

export const requestOtp = (phone: string) =>
  apiFetch<RequestOtpResponse>("/auth/request-otp", {
    method: "POST",
    body: { phone },
  });

export const verifyOtp = (phone: string, otp: string) =>
  apiFetch<VerifyOtpResponse>("/auth/verify-otp", {
    method: "POST",
    body: { phone, otp },
  });

export const getMe = () =>
  apiFetch<User>("/auth/me", { method: "GET" });

export const updateProfile = (patch: ProfilePatch) =>
  apiFetch<User>("/auth/profile", {
    method: "PATCH",
    body: patch,
  });

// --- query client -----------------------------------------------------------

let client: QueryClient | null = null;

export function getQueryClient(): QueryClient {
  if (client) return client;
  client = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        // Don't retry 4xx — surface to the user immediately.
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  });
  return client;
}

export const queryKeys = {
  me: ["auth", "me"] as const,
};
