"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownLeft, ArrowLeft, ArrowUpRight, Phone, Video } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { ChatBottomNav } from "@/components/chat-bottom-nav";
import { LeftRail } from "@/components/left-rail";
import { useVoiceCall } from "@/components/voice-call-provider";
import { getCallHistory, type CallHistoryEntry } from "@/lib/api";
import { useAuthStore } from "@/store/auth";

export default function CallsPage() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const hydrated = useAuthStore((state) => state.hydrated);
  const { startCall } = useVoiceCall();
  const [entries, setEntries] = useState<CallHistoryEntry[]>([]);
  const [historyError, setHistoryError] = useState(false);

  useEffect(() => {
    if (!hydrated || !user) return;
    let disposed = false;
    const refresh = () => {
      void getCallHistory().then((history) => {
        if (!disposed) { setEntries(history); setHistoryError(false); }
      }).catch(() => {
        if (!disposed) setHistoryError(true);
      });
    };
    refresh();
    const interval = window.setInterval(refresh, 20_000);
    window.addEventListener("focus", refresh);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
    };
  }, [hydrated, user]);

  useEffect(() => {
    if (hydrated && !user) router.replace("/auth/phone");
  }, [hydrated, user, router]);

  return (
    <div className="flex h-screen min-h-0 w-full overflow-hidden" style={{ backgroundColor: "var(--color-bg-primary)" }}>
      <div className="hidden lg:block"><LeftRail onHide={() => router.push("/chat")} /></div>
      <main className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col pb-[calc(56px+env(safe-area-inset-bottom))] lg:pb-0">
        <header className="flex items-center gap-3 border-b px-5 py-5" style={{ borderColor: "var(--color-border-subtle)" }}>
          <button type="button" onClick={() => router.push("/chat")} aria-label="Back to chats" className="rounded-full p-2 text-[var(--color-fg-secondary)] hover:bg-[var(--color-bg-tertiary)] lg:hidden"><ArrowLeft size={20} /></button>
          <div className="min-w-0 flex-1"><h1 className="text-xl font-semibold text-[var(--color-fg-primary)]">Calls</h1><p className="mt-1 text-sm text-[var(--color-fg-secondary)]">Your recent audio and video calls</p></div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          {historyError ? (
            <div className="flex h-full min-h-64 flex-col items-center justify-center text-center">
              <h2 className="text-base font-semibold text-[var(--color-fg-primary)]">Couldn’t load call history</h2>
              <p className="mt-1 max-w-xs text-sm text-[var(--color-fg-secondary)]">Check your connection and try again.</p>
            </div>
          ) : entries.length === 0 ? (
            <div className="flex h-full min-h-64 flex-col items-center justify-center text-center">
              <span className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[var(--color-bg-tertiary)] text-[var(--color-fg-secondary)]"><Phone size={26} /></span>
              <h2 className="text-base font-semibold text-[var(--color-fg-primary)]">No calls yet</h2>
              <p className="mt-1 max-w-xs text-sm text-[var(--color-fg-secondary)]">Calls you make or receive will appear here.</p>
            </div>
          ) : (
            <ul className="divide-y" style={{ borderColor: "var(--color-border-subtle)" }}>
              {entries.map((entry) => <li key={entry.call_id} className="flex items-center gap-3 py-4">
                <Avatar subject={{ avatar_url: entry.peer_avatar_url, display_name: entry.peer_name }} size={48} showOnline={false} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-[var(--color-fg-primary)]">{entry.peer_name}</p>
                  <p className={`mt-1 flex items-center gap-1.5 text-sm ${entry.outcome === "missed" ? "text-red-600" : "text-[var(--color-fg-secondary)]"}`}>
                    {entry.direction === "incoming" ? <ArrowDownLeft size={15} /> : <ArrowUpRight size={15} />}
                    {entry.outcome === "missed" ? "Missed" : entry.outcome === "declined" ? "Declined" : entry.outcome === "cancelled" ? "Cancelled" : entry.direction === "incoming" ? "Incoming" : "Outgoing"}
                    <span aria-hidden>·</span>{entry.media_type === "video" ? <Video size={14} /> : <Phone size={14} />}
                    {entry.duration_seconds > 0 ? <><span aria-hidden>·</span>{formatDuration(entry.duration_seconds)}</> : null}
                  </p>
                </div>
                <time className="hidden shrink-0 text-xs text-[var(--color-fg-muted)] sm:block">{new Date(entry.timestamp).toLocaleString()}</time>
                {!entry.is_group && entry.peer_id != null ? <div className="flex shrink-0 gap-1">
                  <button type="button" onClick={() => void startCall(entry.conversation_id, entry.peer_id!, entry.peer_name, entry.peer_avatar_url, "audio")} aria-label={`Call ${entry.peer_name}`} title="Audio call" className="rounded-full p-2.5 text-[var(--color-accent)] hover:bg-[var(--color-bg-tertiary)]"><Phone size={18} /></button>
                  <button type="button" onClick={() => void startCall(entry.conversation_id, entry.peer_id!, entry.peer_name, entry.peer_avatar_url, "video")} aria-label={`Video call ${entry.peer_name}`} title="Video call" className="rounded-full p-2.5 text-[var(--color-accent)] hover:bg-[var(--color-bg-tertiary)]"><Video size={18} /></button>
                </div> : null}
              </li>)}
            </ul>
          )}
        </div>
      </main>
      <ChatBottomNav />
    </div>
  );
}

function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
