"use client";

/**
 * Middle pane (~320px): header (display name + compose icon + settings
 * placeholder), a search input that filters the list client-side, and a
 * scrollable list of conversations.
 *
 * Phase 4 data flow:
 *   - `useQuery(['conversations'], listConversations)` with 10s stale time
 *   - skeletons during load, toast on error
 *   - filter by `name` (and `last_message.content`) against the search
 *     input, debounced ~150ms
 *   - empty state when the query returns `[]`
 *
 * The "compose" icon opens the AddContactModal; selecting the new
 * conversation is handled inside the modal.
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Pencil, Search, Settings2 } from "lucide-react";
import { toast } from "sonner";
import {
  ConversationListRow,
} from "./conversation-list-row";
import { EmptyState } from "./empty-state";
import { AddContactModal } from "./add-contact-modal";
import {
  ApiError,
  listConversations,
  queryKeys,
  type Conversation,
} from "@/lib/api";
import { useUiStore } from "@/store/ui";
import { MessageSquarePlus } from "lucide-react";

const DEBOUNCE_MS = 150;

export function ConversationListPane() {
  const setSelected = useUiStore((s) => s.setSelected);
  const selectedId = useUiStore((s) => s.selectedConversationId);

  const conversationsQuery = useQuery({
    queryKey: queryKeys.conversations,
    queryFn: listConversations,
    staleTime: 10_000,
  });

  // Toast any error so the supervisor notices (acceptance #5).
  useEffect(() => {
    if (conversationsQuery.error) {
      const msg =
        conversationsQuery.error instanceof ApiError
          ? conversationsQuery.error.message
          : "Couldn't load conversations";
      toast.error(msg);
    }
  }, [conversationsQuery.error]);

  // Debounce the search input.
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const id = window.setTimeout(
      () => setDebouncedSearch(searchInput.trim().toLowerCase()),
      DEBOUNCE_MS,
    );
    return () => window.clearTimeout(id);
  }, [searchInput]);

  const conversations = conversationsQuery.data ?? [];

  const filtered = useMemo(() => {
    if (!debouncedSearch) return conversations;
    return conversations.filter((c) => matches(c, debouncedSearch));
  }, [conversations, debouncedSearch]);

  const [modalOpen, setModalOpen] = useState(false);

  return (
    <aside
      className="flex h-full w-[320px] shrink-0 flex-col border-r"
      style={{
        backgroundColor: "var(--color-bg-primary)",
        borderColor: "var(--color-border-subtle)",
      }}
      aria-label="Conversations"
    >
      <header
        className="flex items-center justify-between gap-2 px-4 pb-3 pt-5"
        style={{ borderBottom: "1px solid var(--color-border-subtle)" }}
      >
        <h1 className="truncate text-lg font-semibold text-[var(--color-fg-primary)]">
          Chats
        </h1>
        <div className="flex items-center gap-1">
          <IconButton
            aria-label="New chat"
            onClick={() => setModalOpen(true)}
          >
            <Pencil size={18} />
          </IconButton>
          <IconButton aria-label="Settings">
            <Settings2 size={18} />
          </IconButton>
        </div>
      </header>

      <div className="px-3 py-2">
        <label className="relative block">
          <span className="sr-only">Search conversations</span>
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-fg-muted)]"
            size={14}
            aria-hidden
          />
          <input
            type="search"
            placeholder="Search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-full rounded-full border bg-[var(--color-bg-secondary)] py-1.5 pl-8 pr-3 text-sm text-[var(--color-fg-primary)] outline-none placeholder:text-[var(--color-fg-muted)] focus:bg-[var(--color-bg-primary)] focus:ring-2 focus:ring-[var(--color-accent)]"
            style={{ borderColor: "var(--color-border-subtle)" }}
          />
        </label>
      </div>

      <ul
        className="flex-1 overflow-y-auto"
        style={{ scrollbarWidth: "thin" }}
        role="list"
      >
        {conversationsQuery.isLoading ? (
          <SkeletonRows />
        ) : conversationsQuery.error ? (
          <li className="px-4 py-6 text-center text-sm" style={{ color: "var(--color-status-error)" }}>
            Couldn't load conversations.
          </li>
        ) : filtered.length === 0 ? (
          <li>
            {debouncedSearch && conversations.length > 0 ? (
              <SearchEmpty onClear={() => setSearchInput("")} />
            ) : (
              <ListEmpty onCompose={() => setModalOpen(true)} />
            )}
          </li>
        ) : (
          filtered.map((conv) => (
            <li key={conv.id}>
              <ConversationListRow
                conversation={conv}
                selected={conv.id === selectedId}
                onSelect={(id) => setSelected(id)}
              />
            </li>
          ))
        )}
      </ul>

      <AddContactModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
      />
    </aside>
  );
}

function matches(conv: Conversation, q: string): boolean {
  if (conv.name && conv.name.toLowerCase().includes(q)) return true;
  // For direct conversations the name is sometimes null — match the
  // other participant's display name from `participants`.
  if (conv.participants) {
    for (const p of conv.participants) {
      if (p.display_name && p.display_name.toLowerCase().includes(q)) return true;
      if (p.phone && p.phone.toLowerCase().includes(q)) return true;
    }
  }
  // Also surface in preview text so users can search message contents.
  if (conv.last_message?.content.toLowerCase().includes(q)) return true;
  return false;
}

function IconButton({
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--color-fg-secondary)] transition hover:bg-[var(--color-bg-tertiary)]"
    >
      {children}
    </button>
  );
}

function SkeletonRows() {
  return (
    <>
      {[1, 2, 3, 4, 5].map((i) => (
        <li
          key={i}
          className="flex items-center gap-3 px-3 py-2"
          aria-hidden
        >
          <div
            className="h-10 w-10 animate-pulse rounded-full"
            style={{ backgroundColor: "var(--color-bg-tertiary)" }}
          />
          <div className="flex flex-1 flex-col gap-1">
            <div
              className="h-3 w-2/3 animate-pulse rounded"
              style={{ backgroundColor: "var(--color-bg-tertiary)" }}
            />
            <div
              className="h-3 w-1/2 animate-pulse rounded"
              style={{ backgroundColor: "var(--color-bg-tertiary)" }}
            />
          </div>
        </li>
      ))}
    </>
  );
}

function ListEmpty({ onCompose }: { onCompose: () => void }) {
  return (
    <div className="px-4 py-10">
      <EmptyState
        icon={MessageSquarePlus}
        title="No conversations yet"
        description="Click + to start a new one."
        action={
          <button
            type="button"
            onClick={onCompose}
            className="mt-2 inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold transition hover:opacity-90"
            style={{
              backgroundColor: "var(--color-accent)",
              color: "var(--color-accent-fg)",
            }}
          >
            Add contact
          </button>
        }
      />
    </div>
  );
}

function SearchEmpty({ onClear }: { onClear: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
      <p className="text-sm text-[var(--color-fg-secondary)]">
        No conversations match your search.
      </p>
      <button
        type="button"
        onClick={onClear}
        className="text-sm text-[var(--color-accent)] hover:underline"
      >
        Clear search
      </button>
    </div>
  );
}
