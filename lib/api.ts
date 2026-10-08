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
 *
 * Phase 4 added the read endpoints (`/conversations`, …/messages,
 * `/contacts`, `/users/search`, `POST /contacts`). Phase 5 will add the
 * write endpoints (send message, presence, etc.).
 */

import { QueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/store/auth";
import { env } from "./env";

// --- types (mirror backend's UserOut + Phase 4 schemas) --------------------

export interface User {
  id: number;
  phone: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  created_at: string;
  last_seen: string | null;
}

export interface Attachment {
  id: number;
  url: string;
  mime: string;
  size_bytes: number;
}

export type MessageType = "text" | "image" | "system";
export type ConversationType = "direct" | "group";

export interface MessagePreview {
  id: number;
  sender_id: number;
  content: string;
  created_at: string;
  type: MessageType;
}

export interface Message {
  id: number;
  conversation_id: number;
  sender_id: number;
  content: string;
  type: MessageType;
  created_at: string;
  /** Nested user card from the backend's `MessageOut.sender`. */
  sender: User;
  parent_id: number | null;
  attachments: Attachment[];
  /**
   * Local-only optimistic status. Live messages arrive with `status =
   * undefined`; bubble component treats that as "delivered" for
   * outgoing messages. Phase 5's WS events populate this client-side
   * as sending → sent → delivered → read. `failed` is set on a non-2xx
   * POST from the composer.
   */
  status?: "sending" | "sent" | "delivered" | "read" | "failed";
}

// --- types (mirror backend's UserOut + Phase 4 schemas) --------------------
export interface ConversationParticipantWithRole extends User {
  /** Phase 6: 'admin' for groups, undefined for direct. */
  role?: "admin" | "member";
}

export interface Conversation {
  id: number;
  type: ConversationType;
  name: string | null;
  created_at: string;
  /** Backend populates with ALL participants (including current user).
   *  Phase 6: each participant may carry a `role` for groups. */
  participants: ConversationParticipantWithRole[];
  last_message: MessagePreview | null;
  last_message_at: string | null;
  unread_count: number;
  /** Backend returns either the other party's avatar (direct) or a
   *  generated initials avatar (group). Optional — older seeded rows
   *  may be missing this field. */
  avatar_url: string | null;
  /** Phase 6: `true` for groups (admin-allowed), `false` for directs. */
  members_can_be_added?: boolean;
  /** Phase 6: the current user's role in this group conversation. */
  role?: "admin" | "member";
}

export interface Contact {
  id: number;
  contact: User;
  nickname: string | null;
  added_at: string;
}

export interface UserSearchResult {
  id: number;
  phone: string;
  display_name: string | null;
  avatar_url: string | null;
  already_contact: boolean;
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
      // FastAPI uses `detail` for most errors and `message` for some
      // custom routes (`POST /contacts` 404 returns `{"message": ...}`).
      if (typeof obj.detail === "string") message = obj.detail;
      else if (typeof obj.message === "string") message = obj.message;
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

/**
 * Best-effort call to the backend's logout endpoint (closes WS +
 * bumps `last_seen`). Errors are swallowed — the local cache clears
 * even if the request fails (offline, server down, endpoint not
 * deployed yet, etc.).
 */
export async function logout(): Promise<void> {
  try {
    await apiFetch<void>("/auth/logout", { method: "POST" });
  } catch {
    // intentional: best-effort. See task.md §2.
  }
}

// --- Phase 4 read + contacts endpoints --------------------------------------

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

/** `GET /conversations`. Sorted by `last_message_at DESC NULLS LAST`. */
export const listConversations = () =>
  apiFetch<Conversation[]>("/conversations", { method: "GET" });

/** `GET /conversations/{id}/messages?limit=&before=`. */
export const listMessages = (
  conversationId: number,
  opts: { limit?: number; before?: number } = {},
) => {
  const params = new URLSearchParams();
  if (opts.limit !== undefined) params.set("limit", String(opts.limit));
  if (opts.before !== undefined) params.set("before", String(opts.before));
  const qs = params.toString();
  return apiFetch<Message[]>(
    `/conversations/${conversationId}/messages${qs ? `?${qs}` : ""}`,
    { method: "GET" },
  );
};

/** `GET /contacts`. */
export const listContacts = () =>
  apiFetch<Contact[]>("/contacts", { method: "GET" });

/**
 * `POST /contacts`. Adds a contact by phone (the only lookup key in
 * Phase 4 — no username support). Returns the (new or existing)
 * `ConversationOut` so the caller can select it.
 */
export const addContact = (phone: string) =>
  apiFetch<Conversation>("/contacts", {
    method: "POST",
    body: { phone },
  });

/** `GET /users/search?q=&conversation_id=`. Empty `q` returns `[]` per
 *  backend contract. Pass `conversationId` to scope the `already_member`
 *  flag (Phase 6 group add-member flow). */
export const searchUsers = (q: string, conversationId?: number) => {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (conversationId != null) params.set("conversation_id", String(conversationId));
  const qs = params.toString();
  return apiFetch<UserSearchResult[]>(
    `/users/search${qs ? `?${qs}` : ""}`,
    { method: "GET" },
  );
};

// --- Phase 6: group CRUD + member management -------------------------------

/** `POST /conversations` — create a group. */
export interface CreateGroupBody {
  type: "group";
  name: string;
  member_ids: number[];
}
export interface CreateGroupResponse {
  conversation: Conversation;
}
export const createGroup = (body: CreateGroupBody) =>
  apiFetch<Conversation>("/conversations", {
    method: "POST",
    body,
  });

/** `POST /conversations/{id}/members` — admin only; adds a user. */
export interface AddMemberResponse {
  added: User;
}
export const addMember = (conversationId: number, userId: number) =>
  apiFetch<AddMemberResponse>(
    `/conversations/${conversationId}/members`,
    { method: "POST", body: { user_id: userId } },
  );

/** `DELETE /conversations/{id}/members/{uid}` — admin only; 204 No Content. */
export const removeMember = (conversationId: number, userId: number) =>
  apiFetch<void>(
    `/conversations/${conversationId}/members/${userId}`,
    { method: "DELETE" },
  );

/** `PATCH /conversations/{id}/members/{uid}` — admin only; change role. */
export const promoteMember = (
  conversationId: number,
  userId: number,
  role: "admin" | "member",
) =>
  apiFetch<void>(
    `/conversations/${conversationId}/members/${userId}`,
    { method: "PATCH", body: { role } },
  );

/** `DELETE /conversations/{id}` — admin only; cascade-deletes the group. */
export const deleteGroup = (conversationId: number) =>
  apiFetch<void>(`/conversations/${conversationId}`, { method: "DELETE" });

/** Body for `POST /conversations/{id}/messages`. */
export interface SendMessageBody {
  content: string;
  type: MessageType;
  /** Phase 8 reply; accepted but ignored server-side in Phase 5. */
  parent_id?: number | null;
}

export const sendMessage = (
  conversationId: number,
  body: SendMessageBody,
) =>
  apiFetch<Message>(`/conversations/${conversationId}/messages`, {
    method: "POST",
    body,
  });

/** `POST /conversations/{id}/read` — marks messages up to `message_id` read
 *  for the current user. */
export interface MarkReadResponse {
  marked_read: number;
}
export const markRead = (conversationId: number, messageId: number) =>
  apiFetch<MarkReadResponse>(`/conversations/${conversationId}/read`, {
    method: "POST",
    body: { message_id: messageId },
  });

/** `GET /conversations/{id}/message-status?message_ids=1,2,3`
 *  Returns `{ [messageId: string]: MessageStatus }`. */
export const getMessageStatus = (
  conversationId: number,
  messageIds: number[],
) =>
  apiFetch<Record<string, Message["status"] | "unknown">>(
    `/conversations/${conversationId}/message-status?message_ids=${messageIds.join(",")}`,
    { method: "GET" },
  );

/** `GET /users/online` — list of currently online user ids. */
export const getOnlineUsers = () =>
  apiFetch<number[]>("/users/online", { method: "GET" });

/** Map backend's status string (`sending|sent|delivered|read|failed`) to
 *  the value our bubble component uses. The backend's spec only emits
 *  `delivered` and `read`; `sending` and `sent`/`failed` are
 *  client-side states for optimistic UI. */
export type BackendMessageStatus = "sending" | "sent" | "delivered" | "read" | "failed";
export function mapBackendStatus(
  value: string | undefined | null,
): Message["status"] | "failed" {
  if (!value) return "read";
  if (value === "sending" || value === "sent" || value === "delivered" || value === "read") {
    return value;
  }
  return "read"; // unknown backend value — treat as fully delivered
}

// --- query client + keys ---------------------------------------------------

let client: QueryClient | null = null;

/**
 * Bind the singleton QueryClient. `Providers` calls this once on mount
 * with the React-context client — so `getQueryClient()` and `useQuery`
 * agree on which store to read from. Without this binding the WS
 * handler's `setQueryData` writes to a *different* client than the
 * one React subscribes to via `<QueryClientProvider>`, which is why
 * incoming `message.new` events don't update the UI without a refresh.
 */
export function setQueryClient(c: QueryClient): void {
  client = c;
}

export function getQueryClient(): QueryClient {
  if (client) return client;
  // Lazy fallback for callers (e.g. error toasts) that fire before
  // `Providers` has mounted. The returned client is not the same as
  // the React-context one — those callers should not be doing cache
  // mutations; this branch exists mainly so module load doesn't throw.
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
  conversations: ["conversations"] as const,
  messages: (conversationId: number | null) =>
    ["messages", conversationId] as const,
  contacts: ["contacts"] as const,
  userSearch: (q: string) => ["users", "search", q] as const,
};
