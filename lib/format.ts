/**
 * Date helpers for list rows + bubble timestamps.
 *
 * `formatConversationTimestamp` returns the short label Signal uses:
 *   - "now" if the message is <1 minute old
 *   - "5m" / "2h" / "3d" for under a week
 *   - weekday name for under 7 days (e.g. "Mon")
 *   - "10/04" for older
 *
 * `formatBubbleTime` is the per-message clock used below each bubble.
 *
 * All locales are pinned to enUS so SSR/CSR render identically — locale
 * drift caused an SSR/CSR hydration mismatch during dev testing.
 */

import { format, isThisYear } from "date-fns";

const MAX = "now";
const SAFE = (s: string) => s; // for future i18n overrides

export function formatConversationTimestamp(iso: string): string {
  const date = new Date(iso);
  const now = Date.now();
  const diffSec = Math.max(0, (now - date.getTime()) / 1000);

  if (diffSec < 60) return MAX;
  if (diffSec < 60 * 60) return `${Math.floor(diffSec / 60)}m`;
  if (diffSec < 24 * 60 * 60) return `${Math.floor(diffSec / 3600)}h`;
  if (diffSec < 7 * 24 * 60 * 60) return format(date, "EEE"); // "Mon"
  if (isThisYear(date)) return format(date, "MM/dd");
  return format(date, "MM/dd/yy");
}

export function formatBubbleTime(iso: string): string {
  return format(new Date(iso), "p"); // enUS — "8:42 PM"
}

export const formatted = SAFE;
