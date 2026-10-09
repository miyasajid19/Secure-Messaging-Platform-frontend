"use client";

/**
 * Phase 4 — "Add contact" modal.
 *
 * Three pieces of state worth understanding:
 *   - `query` (raw input) is controlled and updates the DOM input
 *   - `debounced` is what we actually send to the API (150ms debounce;
 *     backend's `/users/search` doesn't get hammered while the user
 *     types a phone digit-by-digit)
 *   - `error` carries 404 ("No user found …") and 409 ("Already in
 *     your contacts") strings; both render inline below the input
 *
 * On a successful `addContact`, we:
 *   1. close the modal
 *   2. select the returned conversation (`useUiStore.setSelected`)
 *   3. toast "Added {name}"
 *   4. invalidate `['conversations']` and `['contacts']` so the list
 *      pane rerenders with the new row
 */

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, X } from "lucide-react";
import { toast } from "sonner";
import { useAuthStore } from "@/store/auth";
import { Avatar } from "./avatar";
import {
  ApiError,
  addContact,
  listContacts,
  queryKeys,
  searchUsers,
  type UserSearchResult,
} from "@/lib/api";
import { useUiStore } from "@/store/ui";

interface Props {
  open: boolean;
  onClose: () => void;
}

const DEBOUNCE_MS = 150;

export function AddContactModal({ open, onClose }: Props) {
  const queryClient = useQueryClient();
  const setSelected = useUiStore((s) => s.setSelected);

  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [inlineError, setInlineError] = useState<string | null>(null);

  // Debounce the input by 150ms — the backend is fast, but typing a
  // 10-digit phone shouldn't fire 10 requests.
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(query.trim()), DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [query]);

  // Reset state when the modal closes / reopens.
  useEffect(() => {
    if (!open) {
      setQuery("");
      setDebounced("");
      setInlineError(null);
    }
  }, [open]);

  // Focus the search input on open.
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (open) {
      // Defer to next tick so the input is mounted.
      const id = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(id);
    }
  }, [open]);

  // Esc-to-close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const searchQuery = useQuery({
    queryKey: queryKeys.userSearch(debounced),
    queryFn: () => searchUsers(debounced),
    enabled: open && debounced.length > 0,
    staleTime: 30_000,
  });

  const addMutation = useMutation({
    mutationFn: (phone: string) => addContact(phone),
    onSuccess: (conversation) => {
      const addedName = conversation.name ?? "contact";
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
      void queryClient.invalidateQueries({ queryKey: queryKeys.contacts });
      setSelected(conversation.id);
      toast.success(`Added ${addedName}`);
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) {
        setInlineError("Already in your contacts");
      } else if (err instanceof ApiError && err.status === 404) {
        setInlineError("No user found with that phone");
      } else {
        const msg = err instanceof Error ? err.message : "Couldn't add contact";
        toast.error(msg);
      }
    },
  });

  if (!open) return null;

  const results: UserSearchResult[] = searchQuery.data ?? [];
  const searchError =
    searchQuery.error instanceof ApiError ? searchQuery.error.message : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add contact"
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-[var(--color-bg-secondary)] sm:items-center sm:px-4 sm:py-6"
      style={{ backgroundColor: "rgba(0,0,0,0.35)" }}
      onClick={(e) => {
        // Click on the backdrop closes the modal.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="flex w-full max-w-[420px] flex-col overflow-hidden border bg-[var(--color-bg-primary)] shadow-xl sm:rounded-2xl sm:border"
        style={{ borderColor: "var(--color-border-subtle)" }}
      >
        <header
          className="flex items-center justify-between border-b px-4 py-3"
          style={{ borderColor: "var(--color-border-subtle)" }}
        >
          <h2 className="text-base font-semibold text-[var(--color-fg-primary)]">
            Add a contact
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-full text-[var(--color-fg-secondary)] hover:bg-[var(--color-bg-tertiary)] active:bg-[var(--color-bg-tertiary)]"
          >
            <X size={18} />
          </button>
        </header>

        <div className="p-4">
          <label className="relative block">
            <span className="sr-only">Search users</span>
            <Search
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-fg-muted)]"
              size={14}
              aria-hidden
            />
            <input
              ref={inputRef}
              type="search"
              placeholder="Phone, name, or username"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setInlineError(null);
              }}
              className="w-full rounded-full border bg-[var(--color-bg-secondary)] py-2 pl-9 pr-3 text-sm text-[var(--color-fg-primary)] outline-none placeholder:text-[var(--color-fg-muted)] focus:ring-2 focus:ring-[var(--color-accent)]"
              style={{ borderColor: "var(--color-border-subtle)" }}
            />
          </label>

          {inlineError ? (
            <p
              role="alert"
              className="mt-3 text-sm"
              style={{ color: "var(--color-status-error)" }}
            >
              {inlineError}
            </p>
          ) : null}

          <div className="mt-4 max-h-[320px] overflow-y-auto">
            {debounced.length === 0 ? (
              <p className="px-2 py-6 text-center text-sm text-[var(--color-fg-muted)]">
                Start typing to search by phone, name, or username.
              </p>
            ) : searchQuery.isLoading ? (
              <p className="px-2 py-6 text-center text-sm text-[var(--color-fg-muted)]">
                Searching…
              </p>
            ) : searchError ? (
              <p
                role="alert"
                className="px-2 py-6 text-center text-sm"
                style={{ color: "var(--color-status-error)" }}
              >
                {searchError}
              </p>
            ) : results.length === 0 ? (
              <SelfHint
                query={debounced}
                myName={useAuthStore.getState().user?.display_name ?? null}
                myPhone={useAuthStore.getState().user?.phone ?? null}
              />
            ) : (
              <ul className="flex flex-col">
                {results.map((u) => (
                  <ResultRow
                    key={u.id}
                    user={u}
                    disabled={u.already_contact || addMutation.isPending}
                    onAdd={() => addMutation.mutate(u.phone)}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ResultRow({
  user,
  disabled,
  onAdd,
}: {
  user: UserSearchResult;
  disabled: boolean;
  onAdd: () => void;
}) {
  const initials = (user.display_name ?? user.phone).slice(0, 2).toUpperCase();
  return (
    <li className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-[var(--color-bg-tertiary)]">
      <Avatar
        subject={{
          avatar_url: user.avatar_url ?? "",
          display_name: user.display_name ?? user.phone,
        }}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium text-[var(--color-fg-primary)]">
          {user.display_name ?? user.phone}
        </span>
        <span className="truncate text-xs text-[var(--color-fg-muted)]">
          {user.phone}
        </span>
      </div>
      {user.already_contact ? (
        <span
          className="text-xs"
          style={{ color: "var(--color-fg-muted)" }}
          aria-label="Already a contact"
        >
          added
        </span>
      ) : (
        <button
          type="button"
          onClick={onAdd}
          disabled={disabled}
          aria-label={`Add ${user.display_name ?? user.phone}`}
          className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--color-accent-fg)] disabled:cursor-not-allowed disabled:opacity-60"
          style={{ backgroundColor: "var(--color-accent)" }}
        >
          <Plus size={16} />
        </button>
      )}
      {/* initials for the SR-only case when the avatar image is broken */}
      <span className="sr-only">{initials}</span>
    </li>
  );
}

// Used so a future caller can preload the contacts cache (e.g. when the
// modal is opened) without a separate import.
export const _key_contacts = listContacts;

/**
 * Phase 7 §7 — when the user searches for their own phone or
 * display_name, the backend excludes them from results, so
 * `results.length === 0`. Surface a small inline hint instead of the
 * generic "No matches." so the user understands why their own name
 * shows up empty.
 */
function SelfHint({
  query,
  myName,
  myPhone,
}: {
  query: string;
  myName: string | null;
  myPhone: string | null;
}) {
  const q = query.trim().toLowerCase();
  const matchesName =
    myName && myName.toLowerCase().split(/\s+/).some((part) => part.startsWith(q));
  const matchesPhone = myPhone && myPhone.replace(/\D/g, "").includes(q.replace(/\D/g, ""));
  if (matchesName || matchesPhone) {
    return (
      <p className="px-2 py-6 text-center text-sm text-[var(--color-fg-muted)]">
        That's you. Search for someone else to start a conversation.
      </p>
    );
  }
  return (
    <p className="px-2 py-6 text-center text-sm text-[var(--color-fg-muted)]">
      No matches.
    </p>
  );
}
