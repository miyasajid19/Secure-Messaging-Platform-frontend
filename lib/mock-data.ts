/**
 * Phase 3 — hardcoded mock data for the Signal UI shell.
 *
 * Shapes mirror the backend's planned response shapes so Phase 4's swap
 * to live API is mechanical: replace `MOCK_*` with the result of the
 * real query, no callsite changes.
 *
 * Status vocab matches what the bubble component expects (§4 of the
 * task): "sending" → spinner, "sent" → single check, "delivered" →
 * muted double, "read" → accent-tinted double.
 */

export type MessageStatus = "sending" | "sent" | "delivered" | "read";
export type ConversationType = "direct" | "group";

export interface User {
  id: number;
  phone: string;
  display_name: string;
  avatar_url: string;
  /** ISO timestamp; null = never seen online. */
  last_seen: string | null;
}

export interface Conversation {
  id: number;
  type: ConversationType;
  name: string;
  /** For direct conversations this is the other party's avatar; for
   * groups it's a synthetic icon URL. */
  avatar_url: string;
  /** ISO timestamp of the most recent message; drives list ordering. */
  last_message_at: string;
  unread_count: number;
  /** When true, the list row shows "typing…" instead of the last preview. */
  is_typing?: boolean;
}

export interface Message {
  id: number;
  conversation_id: number;
  sender_id: number;
  content: string;
  created_at: string;
  status: MessageStatus;
}

// --- helpers --------------------------------------------------------------

/** ISO timestamp `n` minutes ago. Centralised so timestamps stay stable
 *  when the file is re-imported (avoids `Date.now()` drift mid-render). */
function minutesAgo(min: number): string {
  return new Date(Date.now() - min * 60 * 1000).toISOString();
}

function daysAgo(days: number, hours = 0): string {
  return new Date(
    Date.now() - days * 24 * 60 * 60 * 1000 - hours * 60 * 60 * 1000,
  ).toISOString();
}

// --- users ----------------------------------------------------------------

const avatar = (seed: string) =>
  `https://i.pravatar.cc/150?u=${encodeURIComponent(seed)}`;

export const CURRENT_USER_ID = 1;

export const MOCK_USERS: User[] = [
  {
    id: CURRENT_USER_ID,
    phone: "+15550000099",
    display_name: "You",
    avatar_url: avatar("you-signal-clone"),
    last_seen: minutesAgo(2),
  },
  {
    id: 2,
    phone: "+15550000002",
    display_name: "Bob Marlin",
    avatar_url: avatar("bob-marlin"),
    last_seen: minutesAgo(4),
  },
  {
    id: 3,
    phone: "+15550000003",
    display_name: "Carla Diaz",
    avatar_url: avatar("carla-diaz"),
    last_seen: minutesAgo(35),
  },
  {
    id: 4,
    phone: "+15550000004",
    display_name: "Devon Park",
    avatar_url: avatar("devon-park"),
    last_seen: minutesAgo(120),
  },
  {
    id: 5,
    phone: "+15550000005",
    display_name: "Evelyn Roth",
    avatar_url: avatar("evelyn-roth"),
    last_seen: daysAgo(1, 2),
  },
  {
    id: 6,
    phone: "+15550000006",
    display_name: "Felipe Ortiz",
    avatar_url: avatar("felipe-ortiz"),
    last_seen: daysAgo(3),
  },
];

export function getCurrentUser(): User {
  // Current user is id=1; assert presence to keep TS strict.
  const user = MOCK_USERS.find((u) => u.id === CURRENT_USER_ID);
  if (!user) throw new Error("[mock-data] CURRENT_USER missing");
  return user;
}

export function getUserById(id: number): User | undefined {
  return MOCK_USERS.find((u) => u.id === id);
}

// --- conversations -------------------------------------------------------

export const MOCK_CONVERSATIONS: Conversation[] = [
  {
    id: 101,
    type: "direct",
    name: "Bob Marlin",
    avatar_url: avatar("bob-marlin"),
    last_message_at: minutesAgo(8),
    unread_count: 3,
  },
  {
    id: 102,
    type: "group",
    name: "Project Phoenix",
    avatar_url: avatar("phoenix-group"),
    last_message_at: minutesAgo(2),
    unread_count: 0,
    is_typing: true,
  },
  {
    id: 103,
    type: "direct",
    name: "Carla Diaz",
    avatar_url: avatar("carla-diaz"),
    last_message_at: minutesAgo(45),
    unread_count: 1,
  },
  {
    id: 104,
    type: "direct",
    name: "Devon Park",
    avatar_url: avatar("devon-park"),
    last_message_at: hoursAgo(3),
    unread_count: 0,
  },
  {
    id: 105,
    type: "group",
    name: "Hike Crew",
    avatar_url: avatar("hike-crew"),
    last_message_at: daysAgo(1, 4),
    unread_count: 0,
  },
];

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

// --- messages ------------------------------------------------------------

export const MOCK_MESSAGES: Message[] = [
  // 101 — Bob Marlin (direct, currently unread)
  { id: 1001, conversation_id: 101, sender_id: 2, content: "Morning! Did you push the design review fix yet?", created_at: minutesAgo(28), status: "delivered" },
  { id: 1002, conversation_id: 101, sender_id: CURRENT_USER_ID, content: "Yeah, ran `pnpm test` and opened the PR — link in the channel.", created_at: minutesAgo(25), status: "read" },
  { id: 1003, conversation_id: 101, sender_id: 2, content: "Perfect. Reviewing now.", created_at: minutesAgo(22), status: "delivered" },
  { id: 1004, conversation_id: 101, sender_id: 2, content: "Two questions on the auth flow refactor", created_at: minutesAgo(20), status: "delivered" },
  { id: 1005, conversation_id: 101, sender_id: 2, content: "Why did we land on `useEffect` hydration over the persist middleware?", created_at: minutesAgo(11), status: "delivered" },
  { id: 1006, conversation_id: 101, sender_id: 2, content: "And is the `/auth/me` call cheap enough to run on every nav, or should we cache?", created_at: minutesAgo(9), status: "delivered" },
  { id: 1007, conversation_id: 101, sender_id: 2, content: "No rush — heading into a meeting, see you tomorrow.", created_at: minutesAgo(8), status: "delivered" },

  // 102 — Project Phoenix (group, typing)
  { id: 2001, conversation_id: 102, sender_id: 3, content: "Standup in 5 — anyone want to push it?", created_at: minutesAgo(60), status: "read" },
  { id: 2002, conversation_id: 102, sender_id: CURRENT_USER_ID, content: "I can, give me a sec.", created_at: minutesAgo(58), status: "read" },
  { id: 2003, conversation_id: 102, sender_id: 5, content: "👍", created_at: minutesAgo(57), status: "read" },
  { id: 2004, conversation_id: 102, sender_id: 3, content: "Status from yesterday: auth wired up locally, mock OTP returning 123456.", created_at: minutesAgo(40), status: "read" },
  { id: 2005, conversation_id: 102, sender_id: CURRENT_USER_ID, content: "Sweet. I'll wire the providers today.", created_at: minutesAgo(38), status: "read" },
  { id: 2006, conversation_id: 102, sender_id: 4, content: "FYI tokens.css needs the light palette before phase 3.", created_at: minutesAgo(35), status: "read" },
  { id: 2007, conversation_id: 102, sender_id: 6, content: "Already drafted, will push after lunch.", created_at: minutesAgo(30), status: "read" },
  { id: 2008, conversation_id: 102, sender_id: 3, content: "Quick question: do we want light + dark both in v1, or just light?", created_at: minutesAgo(2), status: "read" },

  // 103 — Carla Diaz (direct, 1 unread)
  { id: 3001, conversation_id: 103, sender_id: 3, content: "Coffee Thursday?", created_at: hoursAgo(2), status: "read" },
  { id: 3002, conversation_id: 103, sender_id: CURRENT_USER_ID, content: "Yes please. Same place as last time?", created_at: hoursAgo(2), status: "read" },
  { id: 3003, conversation_id: 103, sender_id: 3, content: "The new place on 4th, 10:30 works?", created_at: minutesAgo(45), status: "delivered" },

  // 104 — Devon Park (direct, all read)
  { id: 4001, conversation_id: 104, sender_id: 4, content: "PR up — took your suggestion on the conditional render.", created_at: hoursAgo(4), status: "read" },
  { id: 4002, conversation_id: 104, sender_id: CURRENT_USER_ID, content: "Looks clean, left two tiny nits.", created_at: hoursAgo(3.5), status: "read" },
  { id: 4003, conversation_id: 104, sender_id: 4, content: "Addressed, re-review?", created_at: hoursAgo(3), status: "read" },

  // 105 — Hike Crew (group, older)
  { id: 5001, conversation_id: 105, sender_id: 5, content: "Sun morning loop confirmed?", created_at: daysAgo(2), status: "read" },
  { id: 5002, conversation_id: 105, sender_id: CURRENT_USER_ID, content: "I'm in. Trail 9?", created_at: daysAgo(2), status: "read" },
  { id: 5003, conversation_id: 105, sender_id: 6, content: "Trail 9 is great, see you 7am at the trailhead.", created_at: daysAgo(2), status: "read" },
  { id: 5004, conversation_id: 105, sender_id: 5, content: "Bring water this time 🙏", created_at: daysAgo(1, 4), status: "read" },
  { id: 5005, conversation_id: 105, sender_id: CURRENT_USER_ID, content: "lol noted", created_at: daysAgo(1, 4), status: "read" },
];

// --- accessors ------------------------------------------------------------

export function getConversationMessages(id: number): Message[] {
  return MOCK_MESSAGES.filter((m) => m.conversation_id === id);
}

export function getConversationById(id: number): Conversation | undefined {
  return MOCK_CONVERSATIONS.find((c) => c.id === id);
}

export function getSortedConversations(): Conversation[] {
  // Sorted by last_message_at desc — matches §6 of the task.
  return [...MOCK_CONVERSATIONS].sort(
    (a, b) =>
      new Date(b.last_message_at).getTime() -
      new Date(a.last_message_at).getTime(),
  );
}

export function getPreview(conversationId: number): string {
  const msgs = getConversationMessages(conversationId);
  const last = msgs[msgs.length - 1];
  if (!last) return "";
  const isMine = last.sender_id === CURRENT_USER_ID;
  const sender = getUserById(last.sender_id);
  const prefix =
    isMine || !sender ? "" : `${sender.display_name.split(" ")[0]}: `;
  return `${prefix}${last.content}`;
}
