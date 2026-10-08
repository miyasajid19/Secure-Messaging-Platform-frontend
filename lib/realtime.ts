/**
 * Singleton WebSocket client.
 *
 * Lifecycle:
 *   - `connect()` opens `wss://…/ws?token=<jwt>` and starts the
 *     reader loop. Idempotent — calling twice is a no-op while a
 *     connection is healthy.
 *   - On unexpected close, schedules a reconnect with exponential
 *     backoff (1s, 2s, 4s, …, capped at 30s).
 *   - `disconnect()` closes the socket and cancels any pending
 *     reconnect. The next `connect()` starts a fresh backoff cycle.
 *
 * Event routing:
 *   - `presence.snapshot` → seeds the realtime store.
 *   - `presence`          → single-user online/offline.
 *   - `message.new`       → pushes into the TanStack Query cache for
 *                            `['messages', conversation_id]`. Also
 *                            invalidates `['conversations']` so the
 *                            list-row preview updates.
 *   - `message.read.bulk` → for every cached message with id ≤
 *                            up_to_message_id in the affected
 *                            conversation, set status='read'.
 *   - `typing`            → mutates the realtime store's typing map.
 *   - Unknown types are `console.warn`'d; never throw.
 *
 * Why a singleton (vs a hook):
 *   - One connection per browser tab, regardless of how many
 *     components subscribe.
 *   - Easy to test by replacing the module with a fake.
 *
 * Spec: @task.md §1 ("WS client (lib/realtime.ts)").
 */

import { getQueryClient, queryKeys, type Conversation, type Message, mapBackendStatus } from "./api";
import { env } from "./env";
import { useAuthStore } from "@/store/auth";
import { useRealtimeStore } from "@/store/realtime";

// --- incoming wire types --------------------------------------------------

interface IncomingMessage {
  type: string;
  [key: string]: unknown;
}

interface PresenceSnapshot {
  type: "presence.snapshot";
  online_user_ids: number[];
}
interface Presence {
  type: "presence";
  user_id: number;
  online: boolean;
}
interface Typing {
  type: "typing";
  conversation_id: number;
  user_id: number;
  state: "start" | "stop";
}
interface MessageNew {
  type: "message.new";
  message: BackendMessageOut;
}
interface MessageReadBulk {
  type: "message.read.bulk";
  conversation_id: number;
  reader_id: number;
  up_to_message_id: number;
}

/** Backend's MessageOut is structurally identical to our `Message`. We
 *  keep fields lenient — Phase 5 messages will be richer over time. */
interface BackendMessageOut {
  id: number;
  conversation_id: number;
  sender_id?: number;
  sender?: Message["sender"];
  content?: string;
  type?: Message["type"];
  created_at?: string;
  parent_id?: number | null;
  attachments?: Message["attachments"];
  status?: string;
}

// --- singleton state -----------------------------------------------------

interface ClientState {
  socket: WebSocket | null;
  connecting: boolean;
  /** Bumped on every connect() so stale reconnect timers no-op. */
  attemptId: number;
  reconnectHandle: number | null;
  connectedToken: string | null;
  currentDelay: number;
}

const state: ClientState = {
  socket: null,
  connecting: false,
  attemptId: 0,
  reconnectHandle: null,
  connectedToken: null,
  currentDelay: 1_000,
};

// --- backoff helper -------------------------------------------------------

function cancelReconnect() {
  if (state.reconnectHandle != null) {
    window.clearTimeout(state.reconnectHandle);
    state.reconnectHandle = null;
  }
}

function scheduleReconnect(token: string, attemptId: number) {
  cancelReconnect();
  const delay = state.currentDelay;
  state.reconnectHandle = window.setTimeout(() => {
    if (state.attemptId !== attemptId) return;
    // If we're already connected, no need to retry.
    if (state.socket && state.socket.readyState === WebSocket.OPEN) return;
    // If the token changed (logout / reauth), bail.
    if (useAuthStore.getState().token !== token) return;
    connectInternal(token, attemptId);
  }, delay);
  // Double for the *next* attempt (capped at 30s).
  state.currentDelay = Math.min(delay * 2, 30_000);
}

// --- connect / disconnect ------------------------------------------------

/** Open (or reuse) the WS. Idempotent. */
export function connect(tokenArg?: string) {
  const token = tokenArg ?? useAuthStore.getState().token;
  if (!token) return;
  if (state.connectedToken === token && state.socket?.readyState === WebSocket.OPEN) {
    return;
  }
  // Bumping attemptId invalidates any pending reconnect.
  state.attemptId += 1;
  state.currentDelay = 1_000;
  connectInternal(token, state.attemptId);
}

function connectInternal(token: string, attemptId: number) {
  if (state.connecting) return;
  if (state.socket && state.socket.readyState === WebSocket.OPEN) return;
  state.connecting = true;

  const url = `${env.wsUrl}?token=${encodeURIComponent(token)}`;
  let socket: WebSocket;
  try {
    socket = new WebSocket(url);
  } catch {
    state.connecting = false;
    scheduleReconnect(token, attemptId);
    return;
  }
  state.socket = socket;

  socket.addEventListener("open", () => {
    if (state.attemptId !== attemptId) {
      // Token changed under us — close this socket and let the next
      // attempt take over.
      socket.close();
      return;
    }
    state.connecting = false;
    state.connectedToken = token;
    // Successful connect resets the backoff.
    state.currentDelay = 1_000;
  });

  socket.addEventListener("message", (event) => {
    try {
      const raw =
        typeof event.data === "string"
          ? event.data
          : new TextDecoder().decode(event.data as ArrayBuffer);
      route(JSON.parse(raw) as IncomingMessage);
    } catch (err) {
      console.warn("[realtime] failed to parse WS message", err);
    }
  });

  socket.addEventListener("close", () => {
    const wasCurrent = state.attemptId === attemptId;
    state.socket = null;
    state.connecting = false;
    state.connectedToken = null;
    if (wasCurrent) scheduleReconnect(token, attemptId);
  });

  socket.addEventListener("error", () => {
    // The `close` event will follow; let it handle the reconnect.
  });
}

/** Close the WS and cancel any pending reconnect. */
export function disconnect() {
  state.attemptId += 1;
  cancelReconnect();
  state.currentDelay = 1_000;
  if (state.socket) {
    state.socket.close();
    state.socket = null;
  }
  state.connecting = false;
  state.connectedToken = null;
  useRealtimeStore.getState().clear();
}

/** Send a JSON payload over the open socket. Returns false if not
 *  connected — callers should fall back to REST (`POST /messages`). */
export function send(payload: object): boolean {
  const s = state.socket;
  if (!s || s.readyState !== WebSocket.OPEN) return false;
  try {
    s.send(JSON.stringify(payload));
    return true;
  } catch (err) {
    console.warn("[realtime] send failed", err);
    return false;
  }
}

// --- routing --------------------------------------------------------------

function route(msg: IncomingMessage) {
  switch (msg.type) {
    case "presence.snapshot":
      handlePresenceSnapshot(msg as unknown as PresenceSnapshot);
      break;
    case "presence":
      handlePresence(msg as unknown as Presence);
      break;
    case "typing":
      handleTyping(msg as unknown as Typing);
      break;
    case "message.new":
      handleMessageNew(msg as unknown as MessageNew);
      break;
    case "message.read.bulk":
      handleMessageReadBulk(msg as unknown as MessageReadBulk);
      break;
    default:
      console.warn("[realtime] unknown event type:", msg.type);
  }
}

function handlePresenceSnapshot(msg: PresenceSnapshot) {
  useRealtimeStore
    .getState()
    .setPresenceSnapshot(Array.isArray(msg.online_user_ids) ? msg.online_user_ids : []);
}

function handlePresence(msg: Presence) {
  useRealtimeStore.getState().setPresence(msg.user_id, msg.online);
}

function handleTyping(msg: Typing) {
  const store = useRealtimeStore.getState();
  if (msg.state === "start") {
    store.setTypingStart(msg.conversation_id, msg.user_id);
  } else {
    store.setTypingStop(msg.conversation_id, msg.user_id);
  }
}

function handleMessageNew(msg: MessageNew) {
  const qc = getQueryClient();
  const m = normalizeIncoming(msg.message);
  if (!m) return;
  qc.setQueryData<Message[]>(
    queryKeys.messages(m.conversation_id),
    (prev) => (prev ? [...prev, m] : [m]),
  );
  void qc.invalidateQueries({ queryKey: queryKeys.conversations });
}

function handleMessageReadBulk(msg: MessageReadBulk) {
  const qc = getQueryClient();
  qc.setQueryData<Message[]>(
    queryKeys.messages(msg.conversation_id),
    (prev) => {
      if (!prev) return prev;
      const upTo = msg.up_to_message_id;
      return prev.map((m) => {
        if (m.id <= upTo && m.status !== "read" && m.status !== "sending") {
          return { ...m, status: "read" as const };
        }
        return m;
      });
    },
  );
  void qc.invalidateQueries({ queryKey: queryKeys.conversations });
}

function normalizeIncoming(raw: BackendMessageOut): Message | null {
  if (typeof raw.id !== "number") return null;
  const me = useAuthStore.getState().user;
  const senderId = raw.sender_id ?? raw.sender?.id ?? 0;
  const isMine = me != null && senderId === me.id;
  const incoming: Message = {
    id: raw.id,
    conversation_id: raw.conversation_id,
    sender_id: senderId,
    sender:
      raw.sender ?? {
        id: senderId,
        phone: "",
        username: null,
        display_name: null,
        avatar_url: null,
        created_at: new Date().toISOString(),
        last_seen: null,
      },
    content: raw.content ?? "",
    type: raw.type ?? "text",
    created_at: raw.created_at ?? new Date().toISOString(),
    parent_id: raw.parent_id ?? null,
    attachments: raw.attachments ?? [],
    status: isMine
      ? mapBackendStatus(raw.status) ?? "delivered"
      : undefined,
  };
  return incoming;
}

// Convenience for components that just want to peek at presence.
export function isUserOnline(userId: number): boolean {
  return Boolean(useRealtimeStore.getState().presenceByUser[userId]);
}

// Silence the unused-typecheck for Conversation that's only here for
// future cross-imports.
void (null as unknown as Conversation);
