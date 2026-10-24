"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Forward, Loader2, Search, Users, X } from "lucide-react";
import { toast } from "sonner";
import {
  forwardMessage,
  getQueryClient,
  listConversations,
  queryKeys,
  type Conversation,
  type Message,
} from "@/lib/api";
import { conversationTitle } from "@/lib/conversation-title";
import { useAuthStore } from "@/store/auth";
import { Avatar } from "./avatar";

interface Props {
  message: Message;
  onClose: () => void;
}

export function ForwardMessageDialog({ message, onClose }: Props) {
  const currentUserId = useAuthStore((state) => state.user?.id ?? null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [search, setSearch] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const conversationsQuery = useQuery({
    queryKey: queryKeys.conversations,
    queryFn: listConversations,
    staleTime: 30_000,
    retry: false,
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, submitting]);

  const conversations = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase();
    return (conversationsQuery.data ?? [])
      .filter((conversation) =>
        !normalized || conversationTitle(conversation, currentUserId).toLocaleLowerCase().includes(normalized),
      );
  }, [conversationsQuery.data, currentUserId, message.conversation_id, search]);

  function toggleConversation(id: number) {
    setSelectedIds((ids) => {
      if (ids.includes(id)) return ids.filter((item) => item !== id);
      if (ids.length >= 10) {
        toast.error("You can forward to up to 10 chats at a time.");
        return ids;
      }
      return [...ids, id];
    });
  }

  async function submit() {
    if (!selectedIds.length || submitting) return;
    setSubmitting(true);
    try {
      const forwarded = await forwardMessage(message.id, selectedIds);
      const queryClient = getQueryClient();
      for (const item of forwarded) {
        queryClient.setQueryData<Message[]>(queryKeys.messages(item.conversation_id), (previous) => {
          if (!previous || previous.some((existing) => existing.id === item.id)) return previous;
          return [...previous, item];
        });
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
      toast.success(`Forwarded to ${forwarded.length} ${forwarded.length === 1 ? "chat" : "chats"}.`);
      onClose();
    } catch {
      toast.error("Couldn't forward this message. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !submitting) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="forward-message-title"
        className="flex max-h-[min(80vh,38rem)] w-full max-w-md flex-col overflow-hidden rounded-2xl border bg-[var(--color-bg-primary)] shadow-2xl"
        style={{ borderColor: "var(--color-border-subtle)" }}
      >
        <header className="flex items-start justify-between gap-4 border-b px-5 py-4" style={{ borderColor: "var(--color-border-subtle)" }}>
          <div>
            <h2 id="forward-message-title" className="flex items-center gap-2 text-base font-semibold text-[var(--color-fg-primary)]"><Forward size={17} />Forward message</h2>
            <p className="mt-1 text-sm text-[var(--color-fg-muted)]">Choose one or more direct or group chats.</p>
          </div>
          <button type="button" onClick={onClose} disabled={submitting} aria-label="Close" className="rounded-full p-2 text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-tertiary)] disabled:opacity-50"><X size={17} /></button>
        </header>

        <div className="border-b px-5 py-3" style={{ borderColor: "var(--color-border-subtle)" }}>
          <label className="flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm" style={{ borderColor: "var(--color-border-subtle)" }}>
            <Search size={16} className="text-[var(--color-fg-muted)]" aria-hidden />
            <input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search chats" aria-label="Search chats to forward to" className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-[var(--color-fg-muted)]" />
          </label>
        </div>

        <div className="min-h-36 flex-1 overflow-y-auto px-3 py-2">
          {conversationsQuery.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-[var(--color-fg-muted)]"><Loader2 size={16} className="animate-spin" />Loading chats…</div>
          ) : conversationsQuery.isError ? (
            <p role="alert" className="px-3 py-10 text-center text-sm text-[var(--color-fg-muted)]">Couldn't load your chats.</p>
          ) : conversations.length ? conversations.map((conversation) => (
            <ConversationOption
              key={conversation.id}
              conversation={conversation}
              currentUserId={currentUserId}
              selected={selectedIds.includes(conversation.id)}
              disabled={!selectedIds.includes(conversation.id) && selectedIds.length >= 10}
              onClick={() => toggleConversation(conversation.id)}
            />
          )) : (
            <p className="px-3 py-10 text-center text-sm text-[var(--color-fg-muted)]">No other chats found.</p>
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t px-5 py-4" style={{ borderColor: "var(--color-border-subtle)" }}>
          <span className="text-xs text-[var(--color-fg-muted)]">{selectedIds.length} selected</span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} disabled={submitting} className="rounded-lg px-3 py-2 text-sm font-medium text-[var(--color-fg-secondary)] hover:bg-[var(--color-bg-tertiary)] disabled:opacity-50">Cancel</button>
            <button type="button" onClick={() => void submit()} disabled={!selectedIds.length || submitting || conversationsQuery.isError} className="inline-flex items-center gap-2 rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {submitting ? <Loader2 size={15} className="animate-spin" /> : <Forward size={15} />}
              Forward
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function ConversationOption({
  conversation,
  currentUserId,
  selected,
  disabled,
  onClick,
}: {
  conversation: Conversation;
  currentUserId: number | null;
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const title = conversationTitle(conversation, currentUserId);
  const other = conversation.participants.find((participant) => participant.id !== currentUserId);
  const avatarUrl = conversation.avatar_url ?? other?.avatar_url ?? null;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-[var(--color-bg-tertiary)] focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] disabled:opacity-40"
    >
      <Avatar subject={{ avatar_url: avatarUrl, display_name: title }} size={40} showOnline={false} />
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--color-fg-primary)]">{title}</span>
      {conversation.type === "group" ? <Users size={15} className="text-[var(--color-fg-muted)]" aria-label="Group chat" /> : null}
      <span className={`flex h-5 w-5 items-center justify-center rounded-full border ${selected ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-white" : "border-[var(--color-border-subtle)]"}`} aria-hidden>
        {selected ? <Check size={13} /> : null}
      </span>
    </button>
  );
}
