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

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AtSign,
  ArrowLeft,
  Hash,
  LogOut,
  Lock,
  ListFilter,
  Menu,
  MessageSquarePlus,
  MoreHorizontal,
  Plus,
  Search,
  Sun,
  User,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  ConversationListRow,
} from "./conversation-list-row";
import { EmptyState } from "./empty-state";
import { Avatar } from "./avatar";
import { NewGroupModal } from "./new-group-modal";
import {
  ApiError,
  addContact,
  listConversations,
  listContacts,
  queryKeys,
  searchUsers,
  type Conversation,
  type Contact,
  type UserSearchResult,
} from "@/lib/api";
import { useUiStore } from "@/store/ui";
import { useAuthStore } from "@/store/auth";
import { performLogout } from "@/lib/auth-actions";
import { SHORTCUT_SEARCH_EVENT } from "@/app/providers";

const DEBOUNCE_MS = 150;
type ConversationFilter = "all" | "unread" | "groups" | "direct";

export function ConversationListPane({
  navigationHidden = false,
  onShowNavigation,
}: {
  navigationHidden?: boolean;
  onShowNavigation?: () => void;
}) {
  const setSelected = useUiStore((s) => s.setSelected);
  const selectedId = useUiStore((s) => s.selectedConversationId);
  const queryClient = useQueryClient();

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
  const [conversationFilter, setConversationFilter] =
    useState<ConversationFilter>("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const [showNewChat, setShowNewChat] = useState(false);
  const [newChatInput, setNewChatInput] = useState("");
  const [newChatSearch, setNewChatSearch] = useState("");
  const [searchMode, setSearchMode] = useState<"all" | "username" | "phone">("all");
  const searchRef = useRef<HTMLInputElement | null>(null);
  const newChatSearchRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const id = window.setTimeout(
      () => setDebouncedSearch(searchInput.trim().toLowerCase()),
      DEBOUNCE_MS,
    );
    return () => window.clearTimeout(id);
  }, [searchInput]);

  useEffect(() => {
    const id = window.setTimeout(() => setNewChatSearch(newChatInput.trim()), DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [newChatInput]);

  const contactsQuery = useQuery({
    queryKey: queryKeys.contacts,
    queryFn: listContacts,
    enabled: showNewChat,
    staleTime: 30_000,
  });
  const newChatQuery = useQuery({
    queryKey: queryKeys.userSearch(newChatSearch),
    queryFn: () => searchUsers(newChatSearch),
    enabled: showNewChat && newChatSearch.length > 0,
    staleTime: 30_000,
  });
  const addContactMutation = useMutation({
    mutationFn: (phone: string) => addContact(phone),
    onSuccess: (conversation) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
      void queryClient.invalidateQueries({ queryKey: queryKeys.contacts });
      setSelected(conversation.id);
      setShowNewChat(false);
      setNewChatInput("");
      toast.success(`Added ${conversation.name ?? "contact"}`);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Couldn't add contact"),
  });

  // ⌘K / `/` shortcut listener. The actual keydown handler is in
  // `app/providers.tsx`; we just listen for the dispatch event.
  useEffect(() => {
    function focusSearch() {
      const el = searchRef.current;
      if (!el) return;
      el.focus();
      el.select();
    }
    window.addEventListener(SHORTCUT_SEARCH_EVENT, focusSearch);
    return () => window.removeEventListener(SHORTCUT_SEARCH_EVENT, focusSearch);
  }, []);

  const conversations = conversationsQuery.data ?? [];

  const filtered = useMemo(() => {
    return conversations.filter((conversation) => {
      const matchesSearch =
        !debouncedSearch || matches(conversation, debouncedSearch);
      const matchesFilter =
        conversationFilter === "all" ||
        (conversationFilter === "unread" && conversation.unread_count > 0) ||
        (conversationFilter === "groups" && conversation.type === "group") ||
        (conversationFilter === "direct" && conversation.type === "direct");
      return matchesSearch && matchesFilter;
    });
  }, [conversations, conversationFilter, debouncedSearch]);

  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const myUserId = useAuthStore((s) => s.user?.id ?? null);
  const router = useRouter();

  async function handleLogout() {
    setConfirmLogout(false);
    setSettingsOpen(false);
    await performLogout(router);
  }

  return (
    <aside
      className="relative flex h-full w-[320px] shrink-0 flex-col border-r"
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
        {showNewChat ? (
          <>
            <IconButton aria-label="Back to chats" title="Back" onClick={() => setShowNewChat(false)}>
              <ArrowLeft size={19} />
            </IconButton>
            <h1 className="flex-1 truncate text-center text-lg font-semibold text-[var(--color-fg-primary)]">New chat</h1>
            <span className="h-9 w-9" aria-hidden />
          </>
        ) : (
          <div className="flex min-w-0 items-center gap-1">
            {navigationHidden ? (
              <IconButton aria-label="Show navigation" title="Show navigation" onClick={onShowNavigation}>
                <Menu size={20} />
              </IconButton>
            ) : null}
            <h1 className="truncate text-lg font-semibold text-[var(--color-fg-primary)]">Chats</h1>
          </div>
        )}
        {!showNewChat ? (
        <div className="flex items-center gap-1">
          <IconButton
            aria-label="New chat"
            title="Compose"
            onClick={() => { setShowNewChat(true); setSettingsOpen(false); }}
          >
            <MessageSquarePlus size={18} />
          </IconButton>
          <IconButton
            aria-label="More options"
            title="More options"
            aria-expanded={settingsOpen}
            aria-haspopup="menu"
            onClick={() => setSettingsOpen((v) => !v)}
          >
            <MoreHorizontal size={20} />
          </IconButton>
        </div>
        ) : null}
      </header>

      {showNewChat ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="px-3 py-2">
            <label className="relative block">
              <span className="sr-only">Search by name, username, or number</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-fg-muted)]" size={16} aria-hidden />
              <input
                ref={newChatSearchRef}
                type="search"
                placeholder={searchMode === "username" ? "Search by username" : searchMode === "phone" ? "Search by phone number" : "Name, username, or number"}
                value={newChatInput}
                onChange={(e) => setNewChatInput(e.target.value)}
                className="w-full rounded-lg border bg-[var(--color-bg-secondary)] py-2.5 pl-10 pr-3 text-sm text-[var(--color-fg-primary)] outline-none placeholder:text-[var(--color-fg-muted)] focus:ring-2 focus:ring-[var(--color-accent)]"
                style={{ borderColor: "var(--color-border-subtle)" }}
              />
            </label>
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-3" style={{ scrollbarWidth: "thin" }}>
            {newChatSearch ? (
              newChatQuery.isLoading ? <li className="px-3 py-6 text-center text-sm text-[var(--color-fg-muted)]">Searching…</li> :
              newChatQuery.error ? <li className="px-3 py-6 text-center text-sm" style={{ color: "var(--color-status-error)" }}>Couldn't search users.</li> :
              (newChatQuery.data ?? []).length ? (newChatQuery.data ?? []).map((user) => (
                <li key={user.id}><NewChatUserRow user={user} disabled={addContactMutation.isPending} onClick={() => {
                  const existing = conversations.find((conv) => conv.type === "direct" && conv.participants.some((person) => person.id === user.id));
                  if (existing) { setSelected(existing.id); setShowNewChat(false); }
                  else if (!user.already_contact) addContactMutation.mutate(user.phone);
                  else toast.error("This contact has no conversation yet.");
                }} /></li>
              )) : <li className="px-3 py-6 text-center text-sm text-[var(--color-fg-muted)]">No matches.</li>
            ) : (
              <>
                <li><NewChatAction icon={<UsersGlyph />} title="New group" onClick={() => { setShowNewChat(false); setGroupModalOpen(true); }} /></li>
                <li><NewChatAction icon={<AtSign size={21} />} title="Find by username" onClick={() => { setSearchMode("username"); newChatSearchRef.current?.focus(); }} /></li>
                <li><NewChatAction icon={<Hash size={21} />} title="Find by phone number" onClick={() => { setSearchMode("phone"); newChatSearchRef.current?.focus(); }} /></li>
                <li className="px-3 pb-1 pt-5 text-sm font-semibold text-[var(--color-fg-secondary)]">Contacts</li>
                {contactsQuery.isLoading ? <li className="px-3 py-4 text-sm text-[var(--color-fg-muted)]">Loading contacts…</li> :
                  (contactsQuery.data ?? []).map((contact) => <li key={contact.id}><ContactRow contact={contact} onClick={() => {
                    const existing = conversations.find((conv) => conv.type === "direct" && conv.participants.some((person) => person.id === contact.contact.id));
                    if (existing) { setSelected(existing.id); setShowNewChat(false); }
                    else toast.error("This contact has no conversation yet.");
                  }} /></li>)}
              </>
            )}
          </ul>
        </div>
      ) : <>
      <div className="flex items-center gap-2 px-3 py-2">
        <label className="relative block min-w-0 flex-1">
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
            ref={searchRef}
            className="w-full rounded-full border bg-[var(--color-bg-secondary)] py-1.5 pl-8 pr-3 text-sm text-[var(--color-fg-primary)] outline-none placeholder:text-[var(--color-fg-muted)] focus:bg-[var(--color-bg-primary)] focus:ring-2 focus:ring-[var(--color-accent)]"
            style={{ borderColor: "var(--color-border-subtle)" }}
          />
        </label>
        <div className="relative">
          <IconButton
            aria-label="Filter chats"
            title="Filter chats"
            aria-expanded={filterOpen}
            aria-haspopup="menu"
            onClick={() => setFilterOpen((open) => !open)}
          >
            <ListFilter size={17} />
          </IconButton>
          {filterOpen ? (
            <div
              role="menu"
              aria-label="Filter conversations"
              className="absolute right-0 top-full z-30 mt-1 w-40 rounded-lg border bg-[var(--color-bg-elevated)] p-1 shadow-lg"
              style={{ borderColor: "var(--color-border-subtle)" }}
            >
              {(
                [
                  ["all", "All chats"],
                  ["unread", "Unread"],
                  ["groups", "Groups"],
                  ["direct", "Direct chats"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={conversationFilter === value}
                  onClick={() => {
                    setConversationFilter(value);
                    setFilterOpen(false);
                  }}
                  className="flex w-full items-center rounded-md px-2.5 py-2 text-left text-sm text-[var(--color-fg-primary)] hover:bg-[var(--color-bg-tertiary)]"
                  style={{
                    backgroundColor:
                      conversationFilter === value
                        ? "var(--color-bg-tertiary)"
                        : undefined,
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
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
            {(debouncedSearch || conversationFilter !== "all") &&
            conversations.length > 0 ? (
              <SearchEmpty
                onClear={() => {
                  setSearchInput("");
                  setConversationFilter("all");
                }}
              />
            ) : (
              <ListEmpty onCompose={() => setShowNewChat(true)} />
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
      </>}

      <NewGroupModal
        open={groupModalOpen}
        onClose={() => setGroupModalOpen(false)}
        currentUserId={myUserId}
      />
      <SettingsMenu
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onRequestLogout={() => setConfirmLogout(true)}
      />
      <ConfirmLogoutModal
        open={confirmLogout}
        onCancel={() => setConfirmLogout(false)}
        onConfirm={handleLogout}
      />
    </aside>
  );
}

function NewChatAction({ icon, title, onClick }: { icon: React.ReactNode; title: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm font-medium text-[var(--color-fg-primary)] transition hover:bg-[var(--color-bg-tertiary)]">
    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--color-bg-tertiary)] text-[var(--color-fg-secondary)]">{icon}</span>{title}
  </button>;
}

function UsersGlyph() { return <Users size={21} />; }

function NewChatUserRow({ user, disabled, onClick }: { user: UserSearchResult; disabled: boolean; onClick: () => void }) {
  return <button type="button" disabled={disabled} onClick={onClick} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition hover:bg-[var(--color-bg-tertiary)] disabled:opacity-60">
    <Avatar subject={{ avatar_url: user.avatar_url, display_name: user.display_name ?? user.phone }} />
    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-[var(--color-fg-primary)]">{user.display_name ?? user.phone}</span><span className="block truncate text-xs text-[var(--color-fg-muted)]">{user.phone}</span></span>
    {user.already_contact ? <span className="text-xs text-[var(--color-fg-muted)]">Added</span> : <span className="text-[var(--color-fg-secondary)]"><Plus size={18} /></span>}
  </button>;
}

function ContactRow({ contact, onClick }: { contact: Contact; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition hover:bg-[var(--color-bg-tertiary)]">
    <Avatar subject={{ avatar_url: contact.contact.avatar_url, display_name: contact.nickname ?? contact.contact.display_name ?? contact.contact.phone }} />
    <span className="truncate text-sm font-medium text-[var(--color-fg-primary)]">{contact.nickname ?? contact.contact.display_name ?? contact.contact.phone}</span>
  </button>;
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

/**
 * Settings popover. Anchored to the top-right of the pane (the
 * overflow menu button). Each menu item navigates to the
 * corresponding `/settings?section=X` panel — see `app/settings/page.tsx`.
 * Logout opens the confirmation modal.
 *
 * Closes on:
 *   - Clicking an action
 *   - Clicking anywhere outside
 *   - Pressing `Esc`
 */
function SettingsMenu({
  open,
  onClose,
  onRequestLogout,
}: {
  open: boolean;
  onClose: () => void;
  onRequestLogout: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  // Hooks must be called before any conditional return below.
  const router = useRouter();

  // Click-outside dismissal. Bound at mount, depends on `open` so
  // it skips work while the menu is closed.
  useEffect(() => {
    if (!open) return;
    function onPointer(e: MouseEvent) {
      if (!ref.current) return;
      if (ref.current.contains(e.target as Node)) return;
      onClose();
    }
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [open, onClose]);

  // Esc-to-close (Phase 7 §3). Use capture so the modal-level
  // handlers don't swallow the key first.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  const items: Array<{
    key: string;
    label: string;
    icon: React.ReactNode;
    onClick: () => void;
    danger?: boolean;
    dividerAfter?: boolean;
  }> = [
    {
      key: "profile",
      label: "Profile",
      icon: <User size={14} aria-hidden />,
      onClick: () => {
        onClose();
        router.push("/settings?section=account");
      },
    },
    {
      key: "appearance",
      label: "Appearance",
      icon: <Sun size={14} aria-hidden />,
      onClick: () => {
        onClose();
        router.push("/settings?section=appearance");
      },
    },
    {
      key: "privacy",
      label: "Privacy",
      icon: <Lock size={14} aria-hidden />,
      onClick: () => {
        onClose();
        router.push("/settings?section=privacy");
      },
      dividerAfter: true,
    },
    {
      key: "logout",
      label: "Log out",
      icon: <LogOut size={14} aria-hidden />,
      onClick: () => onRequestLogout(),
      danger: true,
    },
  ];

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Settings"
      className="absolute right-3 top-14 z-40 w-56 overflow-hidden rounded-lg border bg-[var(--color-bg-primary)] py-1 shadow-lg"
      style={{ borderColor: "var(--color-border-subtle)" }}
    >
      {items.map((item) => (
        <div key={item.key}>
          <button
            type="button"
            role="menuitem"
            onClick={item.onClick}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition hover:bg-[var(--color-bg-tertiary)]"
            style={{
              color: item.danger
                ? "var(--color-status-error)"
                : "var(--color-fg-primary)",
            }}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
          {item.dividerAfter ? (
            <div
              className="mx-3 my-1 h-px"
              style={{ backgroundColor: "var(--color-border-subtle)" }}
              role="separator"
            />
          ) : null}
        </div>
      ))}
    </div>
  );
}

/**
 * Confirmation modal for logout. Two-step pattern — clicking "Log out"
 * in the menu triggers this, only the explicit "Log out" button here
 * runs the destructive cleanup. Esc-to-close.
 */
function ConfirmLogoutModal({
  open,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-logout-title"
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ backgroundColor: "rgba(0,0,0,0.35)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="w-full max-w-[400px] overflow-hidden rounded-2xl border bg-[var(--color-bg-primary)] shadow-xl"
        style={{ borderColor: "var(--color-border-subtle)" }}
      >
        <header
          className="flex items-center justify-between border-b px-4 py-3"
          style={{ borderColor: "var(--color-border-subtle)" }}
        >
          <h2 id="confirm-logout-title" className="text-base font-semibold text-[var(--color-fg-primary)]">
            Log out?
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onCancel}
            className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--color-fg-secondary)] hover:bg-[var(--color-bg-tertiary)]"
          >
            <X size={16} />
          </button>
        </header>
        <div className="px-4 py-4 text-sm text-[var(--color-fg-secondary)]">
          Your session will be cleared on this device. You can log back in
          with the same phone number.
        </div>
        <footer
          className="flex items-center justify-end gap-2 border-t px-4 py-3"
          style={{ borderColor: "var(--color-border-subtle)" }}
        >
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-[var(--color-fg-primary)] hover:bg-[var(--color-bg-tertiary)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-lg px-3 py-1.5 text-sm font-semibold"
            style={{
              backgroundColor: "var(--color-accent)",
              color: "var(--color-accent-fg)",
            }}
          >
            Log out
          </button>
        </footer>
      </div>
    </div>
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
