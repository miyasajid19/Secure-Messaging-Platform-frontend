/**
 * Resolve the display title for a conversation.
 *
 * For groups: returns the explicit `conv.name`.
 * For direct chats: returns the *other* participant's display name
 *   (phone as a fallback). Without `currentUserId` the helper falls
 *   back to "Unknown" so it never accidentally exposes the
 *   caller's own name as the conversation title.
 *
 * Used by both `components/conversation-list-row.tsx` and
 * `components/chat-pane.tsx` so the two views can't drift in
 * behaviour.
 *
 * Spec: @task.md §1 ("Centralize the title derivation").
 */

import type { Conversation } from "./api";

export function conversationTitle(
  conv: Conversation,
  currentUserId: number | null | undefined,
): string {
  if (conv.name) return conv.name;
  const others = (conv.participants ?? []).filter(
    (p) => p.id !== currentUserId,
  );
  if (others.length === 1) {
    return others[0].display_name ?? others[0].phone ?? "Unknown";
  }
  if (others.length > 1) {
    return others
      .slice(0, 3)
      .map((p) => p.display_name ?? p.phone ?? "?")
      .join(", ");
  }
  return "Unknown";
}
