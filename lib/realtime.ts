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
 *   - `message.delivered` → refreshes sender-side delivery state.
 *   - `message.read`/`.bulk` → refreshes sender-side read state and
 *                              seen-by data.
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

import { getMessageStatus, getQueryClient, queryKeys, type Conversation, type Message, mapBackendStatus } from "./api";
import { env } from "./env";
import { useAuthStore } from "@/store/auth";
import { useRealtimeStore } from "@/store/realtime";
import { useUiStore } from "@/store/ui";

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
interface MessageDelivered {
  type: "message.delivered";
  conversation_id: number;
  message_id: number;
  delivered_to: number;
}
interface MessageRead {
  type: "message.read";
  message_id: number;
  read_by: number;
}
interface ConversationUpdated {
  type: "conversation.updated";
  conversation: Conversation;
}
interface ConversationDeleted {
  type: "conversation.deleted";
  conversation_id: number;
}
interface ReactionsUpdate {
  type: "reactions.update";
  conversation_id: number;
  message_id: number;
  reactions: Message["reactions"];
}
interface MessageDelete {
  type: "message.delete";
  conversation_id: number;
  message_id: number;
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
  disappear_after_seconds?: number | null;
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
    markWsOffline();
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

/** Internal: reset wsReady to false (used on close + reconnect). */
function markWsOffline() {
  if (useRealtimeStore.getState().wsReady) {
    useRealtimeStore.getState().setWsReady(false);
  }
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
    case "message.delivered":
      handleMessageDelivered(msg as unknown as MessageDelivered);
      break;
    case "message.read":
      handleMessageRead(msg as unknown as MessageRead);
      break;
    case "message.read.bulk":
      handleMessageReadBulk(msg as unknown as MessageReadBulk);
      break;
    case "conversation.updated":
      handleConversationUpdated(msg as unknown as ConversationUpdated);
      break;
    case "conversation.deleted":
      handleConversationDeleted(msg as unknown as ConversationDeleted);
      break;
    case "reactions.update":
      handleReactionsUpdate(msg as unknown as ReactionsUpdate);
      break;
    case "message.delete":
      handleMessageDelete(msg as unknown as MessageDelete);
      break;
    default:
      console.warn("[realtime] unknown event type:", msg.type);
  }
}

function handlePresenceSnapshot(msg: PresenceSnapshot) {
  useRealtimeStore
    .getState()
    .setPresenceSnapshot(Array.isArray(msg.online_user_ids) ? msg.online_user_ids : []);
  // The server emits `presence.snapshot` immediately after registering
  // the socket, so receiving it is our signal that the WS is fully
  // ready. Mark wsReady so the composer can stop disabling the send
  // button (Phase 6 spec §1 — UI-send race fix).
  useRealtimeStore.getState().setWsReady(true);
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
    (prev) => {
      if (!prev) return [m];
      // Idempotent append: if the cache already has a row with this
      // server id (either from a prior WS broadcast or from the
      // composer's POST-success replace), don't add a duplicate.
      // The composer also dedups on its end, but redundant dedup
      // here means a missed composer replace can never bubble up to
      // a UI double-render.
      if (prev.some((row) => row.id === m.id)) return prev;
      return [...prev, m];
    },
  );
  void qc.invalidateQueries({ queryKey: queryKeys.conversations });
}

function handleMessageReadBulk(msg: MessageReadBulk) {
  const qc = getQueryClient();
  // The backend's read.bulk event payload only carries `reader_id`,
  // not the reader's User record, so we can't authoritatively
  // extend `seen_by` client-side. Instead, invalidate the messages
  // query so the next render pulls a fresh list with the server-
  // computed `seen_by`. (Phase 8: previously we tried to merge
  // locally, but the only way to know the reader's display_name +
  // avatar is to refetch.)
  //
  void syncMessageStatuses(msg.conversation_id);
  void qc.invalidateQueries({ queryKey: queryKeys.messages(msg.conversation_id) });
  void qc.invalidateQueries({ queryKey: queryKeys.conversations });
}

function handleMessageDelivered(msg: MessageDelivered) {
  void syncMessageStatuses(msg.conversation_id);
}

function handleMessageRead(msg: MessageRead) {
  const qc = getQueryClient();
  const messageCaches = qc.getQueryCache().findAll({ queryKey: ["messages"] });
  for (const query of messageCaches) {
    const conversationId = Number(query.queryKey[1]);
    const messages = query.state.data as Message[] | undefined;
    if (!messages?.some((message) => message.id === msg.message_id)) continue;
    void syncMessageStatuses(conversationId);
    void qc.invalidateQueries({ queryKey: queryKeys.messages(conversationId) });
  }
}

async function syncMessageStatuses(conversationId: number) {
  const qc = getQueryClient();
  const messages = qc.getQueryData<Message[]>(queryKeys.messages(conversationId));
  if (!messages?.length) return;
  const ids = messages
    .map((message) => message.id)
    .filter((id) => Number.isSafeInteger(id) && id > 0);
  if (!ids.length) return;
  try {
    const statuses = await getMessageStatus(conversationId, ids);
    qc.setQueryData<Message[]>(queryKeys.messages(conversationId), (prev) => {
      if (!prev) return prev;
      let changed = false;
      const rank = { sending: 0, sent: 1, delivered: 2, read: 3, failed: 4 } as const;
      const next = prev.map((message) => {
        const status = statuses[String(message.id)];
        if (!status || status === "unknown") return message;
        const currentRank = message.status ? rank[message.status] : -1;
        if (currentRank >= rank[status]) return message;
        changed = true;
        return { ...message, status };
      });
      return changed ? next : prev;
    });
  } catch {
    // Realtime events are best-effort; the chat-pane hydrates on open.
  }
}

function handleConversationUpdated(msg: ConversationUpdated) {
  const qc = getQueryClient();
  const updated = msg.conversation;
  // Patch the conversation list cache in place.
  qc.setQueryData<Conversation[] | undefined>(
    queryKeys.conversations,
    (prev) => {
      if (!prev) return prev;
      const exists = prev.find((c) => c.id === updated.id);
      if (!exists) {
        // A group was just created on another tab — append it.
        return [updated, ...prev];
      }
      return prev.map((c) => (c.id === updated.id ? updated : c));
    },
  );
}

function handleConversationDeleted(msg: ConversationDeleted) {
  const qc = getQueryClient();
  qc.setQueryData<Conversation[] | undefined>(
    queryKeys.conversations,
    (prev) => (prev ? prev.filter((c) => c.id !== msg.conversation_id) : prev),
  );
  // Phase 6 spec §10: navigate away from a deleted conversation.
  if (useUiStore.getState().selectedConversationId === msg.conversation_id) {
    useUiStore.getState().setSelected(null);
  }
  // Drop its message cache so re-selection doesn't show stale rows.
  qc.removeQueries({ queryKey: queryKeys.messages(msg.conversation_id) });
}

/**
 * Phase 8.2 — replace the `reactions` array on a single message in
 * its conversation's messages cache. The backend's `reactions.update`
 * is the authoritative state; the optimistic toggle in
 * `MessageBubble` is reconciled by this event when it lands.
 */
/**
 * Phase 8.4 — the backend's 30s sweep broadcasts `message.delete`
 * after it purges expired messages. We drop the row from the
 * conversation's messages cache; the conversation list cache is
 * invalidated so unread counts refresh.
 */
function handleMessageDelete(msg: MessageDelete) {
  const qc = getQueryClient();
  qc.setQueryData<Message[]>(
    queryKeys.messages(msg.conversation_id),
    (prev) => (prev ? prev.filter((m) => m.id !== msg.message_id) : prev),
  );
  void qc.invalidateQueries({ queryKey: queryKeys.conversations });
}

function handleReactionsUpdate(msg: ReactionsUpdate) {
  const qc = getQueryClient();
  qc.setQueryData<Message[]>(
    queryKeys.messages(msg.conversation_id),
    (prev) => {
      if (!prev) return prev;
      return prev.map((m) =>
        m.id === msg.message_id
          ? { ...m, reactions: msg.reactions ?? [] }
          : m,
      );
    },
  );
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
    disappear_after_seconds: raw.disappear_after_seconds ?? null,
    parent_id: raw.parent_id ?? null,
    attachments: raw.attachments ?? [],
    status: isMine
      ? mapBackendStatus(raw.status) ?? "sent"
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
