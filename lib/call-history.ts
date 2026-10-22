export type CallOutcome = "completed" | "missed" | "declined" | "cancelled";

export interface CallHistoryEntry {
  callId: string;
  conversationId: number;
  peerId: number;
  peerName: string;
  peerAvatarUrl: string | null;
  mediaType: "audio" | "video";
  direction: "incoming" | "outgoing";
  outcome: CallOutcome;
  timestamp: string;
  durationSeconds: number;
}

function storageKey(userId: number) {
  return `signal-clone:call-history:${userId}`;
}

export function getCallHistory(userId: number): CallHistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(storageKey(userId)) ?? "[]");
    return Array.isArray(parsed) ? parsed as CallHistoryEntry[] : [];
  } catch {
    return [];
  }
}

export function saveCallHistoryEntry(userId: number, entry: CallHistoryEntry) {
  if (typeof window === "undefined") return;
  const entries = getCallHistory(userId).filter((item) => item.callId !== entry.callId);
  entries.unshift(entry);
  window.localStorage.setItem(storageKey(userId), JSON.stringify(entries.slice(0, 100)));
  window.dispatchEvent(new CustomEvent(`signal-clone:call-history:${userId}`));
}

export function subscribeToCallHistory(userId: number, listener: () => void) {
  if (typeof window === "undefined") return () => {};
  const eventName = `signal-clone:call-history:${userId}`;
  window.addEventListener(eventName, listener);
  return () => window.removeEventListener(eventName, listener);
}
