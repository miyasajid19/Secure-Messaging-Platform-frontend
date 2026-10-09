"use client";

/**
 * Phase 6 — New Group modal.
 *
 * Two-step UX collapsed into one screen for v1:
 *   - Name input (required)
 *   - Member picker: debounced search via `searchUsers`, with chips
 *     for already-selected members. Multi-select.
 *
 * `createGroup()` is the only network call. On success we close the
 * modal, invalidate `['conversations']`, select the new chat, and toast.
 *
 * Spec: @task.md §4 ("New Group modal").
 */

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, ImagePlus, Plus, Search, UserCircle2, X } from "lucide-react";
import { toast } from "sonner";
import { Avatar } from "./avatar";
import {
  ApiError,
  createGroup,
  queryKeys,
  searchUsers,
  setDisappearingTimer,
  uploadImage,
  DISAPPEARING_TIMER_OPTIONS,
  type UserSearchResult,
} from "@/lib/api";
import { useUiStore } from "@/store/ui";

interface Props {
  open: boolean;
  onClose: () => void;
  currentUserId: number | null;
}

const DEBOUNCE_MS = 150;

interface PickedMember {
  id: number;
  display_name: string | null;
  phone: string;
  avatar_url: string | null;
}

export function NewGroupModal({ open, onClose, currentUserId }: Props) {
  const queryClient = useQueryClient();
  const setSelected = useUiStore((s) => s.setSelected);

  const [name, setName] = useState("");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [picked, setPicked] = useState<PickedMember[]>([]);
  const [groupPhoto, setGroupPhoto] = useState<File | null>(null);
  const [groupPhotoPreview, setGroupPhotoPreview] = useState("");
  const [disappearingSeconds, setDisappearingSeconds] = useState("");

  // Reset on close.
  useEffect(() => {
    if (!open) {
      setName("");
      setSearch("");
      setDebounced("");
      setPicked([]);
      setGroupPhoto(null);
      setDisappearingSeconds("");
    }
  }, [open]);

  useEffect(() => {
    if (!groupPhoto) {
      setGroupPhotoPreview("");
      return;
    }
    const previewUrl = URL.createObjectURL(groupPhoto);
    setGroupPhotoPreview(previewUrl);
    return () => URL.revokeObjectURL(previewUrl);
  }, [groupPhoto]);

  // Debounce search box.
  useEffect(() => {
    const id = window.setTimeout(
      () => setDebounced(search.trim().toLowerCase()),
      DEBOUNCE_MS,
    );
    return () => window.clearTimeout(id);
  }, [search]);

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
    queryKey: ["users", "search", "new-group", debounced],
    queryFn: () => searchUsers(debounced),
    enabled: open && debounced.length > 0,
    staleTime: 30_000,
  });

  const results: UserSearchResult[] = searchQuery.data ?? [];
  // Filter out the current user (groups don't include self in picker)
  // and the already-picked members.
  const pickedIds = useMemo(() => new Set(picked.map((p) => p.id)), [picked]);
  const filtered = results.filter(
    (r) => r.id !== currentUserId && !pickedIds.has(r.id),
  );

  const createMutation = useMutation({
    mutationFn: async () => {
      // Phase 6 spec: "Create button (disabled if no name or <2
      // members — direct = 2 people, group = 2+)". 2+ members = the
      // backend auto-adds the caller as admin, so we send only the
      // *other* picked members. Sending the caller's id here would
      // trip a 403 on the backend (the previous backend behaviour
      // that the FIX task addresses).
      if (!currentUserId) throw new Error("Not authenticated");
      const memberIds = picked
        .map((p) => p.id)
        // Defensive: the search-result filter already excludes the
        // caller, but if a future code path slips them in, drop
        // them here rather than ship the bug to the backend.
        .filter((id) => id !== currentUserId);
      const uploadedPhoto = groupPhoto ? await uploadImage(groupPhoto) : null;
      const conversation = await createGroup({
        type: "group",
        name: name.trim(),
        member_ids: memberIds,
        avatar_url: uploadedPhoto?.url,
      });
      let timerFailed = false;
      if (disappearingSeconds) {
        try {
          await setDisappearingTimer(conversation.id, Number(disappearingSeconds));
        } catch {
          timerFailed = true;
        }
      }
      return { conversation, timerFailed };
    },
    onSuccess: ({ conversation, timerFailed }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
      setSelected(conversation.id);
      toast.success(`Group "${conversation.name ?? "untitled"}" created`);
      if (timerFailed) toast.error("Group created, but its disappearing-message timer could not be set");
      onClose();
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : "Couldn't create group";
      toast.error(msg);
    },
  });

  if (!open) return null;

  const canCreate = name.trim().length > 0 && picked.length >= 1 && !createMutation.isPending;

  function togglePick(u: UserSearchResult) {
    setPicked((prev) =>
      prev.find((p) => p.id === u.id)
        ? prev.filter((p) => p.id !== u.id)
        : [
            ...prev,
            {
              id: u.id,
              display_name: u.display_name,
              phone: u.phone,
              avatar_url: u.avatar_url,
            },
          ],
    );
  }

  function handlePhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = "";
    if (!file.type.startsWith("image/") || file.type === "image/svg+xml") {
      toast.error("Choose a supported image file");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Group photos must be 5 MB or smaller");
      return;
    }
    setGroupPhoto(file);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="New group"
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ backgroundColor: "rgba(0,0,0,0.35)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-[420px] overflow-hidden rounded-2xl border bg-[var(--color-bg-primary)] shadow-xl"
        style={{ borderColor: "var(--color-border-subtle)" }}
      >
        <header
          className="flex items-center justify-between border-b px-4 py-3"
          style={{ borderColor: "var(--color-border-subtle)" }}
        >
          <h2 className="text-base font-semibold text-[var(--color-fg-primary)]">
            Name this group
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--color-fg-secondary)] hover:bg-[var(--color-bg-tertiary)]"
          >
            <X size={16} />
          </button>
        </header>

        <div className="p-4">
          <div className="mb-4 flex flex-col items-center">
            <div className="relative mb-4">
              <div className="flex h-28 w-28 items-center justify-center overflow-hidden rounded-full border bg-[var(--color-bg-secondary)]" style={{ borderColor: "var(--color-border-subtle)" }}>
                {groupPhotoPreview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={groupPhotoPreview} alt="Group photo preview" className="h-full w-full object-cover" />
                ) : <UserCircle2 size={58} className="text-[var(--color-fg-muted)]" aria-hidden />}
              </div>
              <label htmlFor="new-group-photo" title="Add group photo" className="absolute bottom-0 right-0 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border bg-[var(--color-bg-primary)] text-[var(--color-fg-secondary)] shadow-sm hover:bg-[var(--color-bg-tertiary)]" style={{ borderColor: "var(--color-border-subtle)" }}>
                <Camera size={17} aria-hidden />
              </label>
            </div>
            <input
              id="new-group-photo"
              type="file"
              accept="image/*"
              onChange={handlePhotoChange}
              disabled={createMutation.isPending}
              className="sr-only"
              aria-label="Add group photo"
            />
            {groupPhoto ? <span className="mb-2 max-w-full truncate text-xs text-[var(--color-fg-muted)]">{groupPhoto.name}</span> : null}
            <label className="block w-full">
              <span className="sr-only">Group name</span>
            <input
              type="text"
              placeholder="Group name (required)"
              value={name}
              maxLength={64}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border bg-[var(--color-bg-secondary)] px-3 py-3 text-sm text-[var(--color-fg-primary)] outline-none placeholder:text-[var(--color-fg-muted)] focus:ring-2 focus:ring-[var(--color-accent)]"
              style={{ borderColor: "var(--color-border-subtle)" }}
            />
          </label>
          </div>

          <label className="mb-3 flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-sm text-[var(--color-fg-primary)]" style={{ borderColor: "var(--color-border-subtle)" }}>
            <span className="flex items-center gap-2"><span className="text-[var(--color-fg-secondary)]"><ImagePlus size={16} /></span>Disappearing messages</span>
            <select value={disappearingSeconds} onChange={(event) => setDisappearingSeconds(event.target.value)} className="rounded-md bg-[var(--color-bg-secondary)] px-2 py-1.5 text-sm text-[var(--color-fg-primary)] outline-none">
              {DISAPPEARING_TIMER_OPTIONS.map((option) => <option key={option.label} value={option.value ?? ""}>{option.label}</option>)}
            </select>
          </label>

          <label className="relative mb-3 block">
            <span className="mb-1 block text-xs font-medium text-[var(--color-fg-secondary)]">
              Add members ({picked.length})
            </span>
            <Search
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-fg-muted)]"
              size={14}
              aria-hidden
              style={{ marginTop: 12 }}
            />
            <input
              type="search"
              placeholder="Phone, name, or username"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-full border bg-[var(--color-bg-secondary)] py-2 pl-9 pr-3 text-sm text-[var(--color-fg-primary)] outline-none placeholder:text-[var(--color-fg-muted)] focus:ring-2 focus:ring-[var(--color-accent)]"
              style={{ borderColor: "var(--color-border-subtle)" }}
            />
          </label>

          {/* Selected chips */}
          {picked.length > 0 ? (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {picked.map((p) => (
                <span
                  key={p.id}
                  className="flex items-center gap-1 rounded-full bg-[var(--color-bg-tertiary)] px-2 py-1 text-xs text-[var(--color-fg-primary)]"
                >
                  {p.display_name ?? p.phone}
                  <button
                    type="button"
                    onClick={() => togglePick({ id: p.id, phone: p.phone, display_name: p.display_name, avatar_url: p.avatar_url, already_contact: false, already_member: false } as UserSearchResult)}
                    aria-label={`Remove ${p.display_name ?? p.phone}`}
                    className="ml-1 flex h-4 w-4 items-center justify-center rounded-full text-[var(--color-fg-muted)] hover:bg-[var(--color-fg-secondary)]/30"
                  >
                    <X size={10} />
                  </button>
                </span>
              ))}
            </div>
          ) : null}

          {/* Results list */}
          <div className="max-h-[280px] overflow-y-auto">
            {debounced.length === 0 ? (
              <p className="px-2 py-6 text-center text-sm text-[var(--color-fg-muted)]">
                Start typing to find people to add.
              </p>
            ) : searchQuery.isLoading ? (
              <p className="px-2 py-6 text-center text-sm text-[var(--color-fg-muted)]">
                Searching…
              </p>
            ) : filtered.length === 0 ? (
              <p className="px-2 py-6 text-center text-sm text-[var(--color-fg-muted)]">
                No matches.
              </p>
            ) : (
              <ul className="flex flex-col">
                {filtered.map((u) => (
                  <li key={u.id}>
                    <button
                      type="button"
                      onClick={() => togglePick(u)}
                      className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-[var(--color-bg-tertiary)]"
                    >
                      <Avatar
                        subject={{
                          avatar_url: u.avatar_url ?? "",
                          display_name: u.display_name ?? u.phone,
                        }}
                      />
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm font-medium text-[var(--color-fg-primary)]">
                          {u.display_name ?? u.phone}
                        </span>
                        <span className="truncate text-xs text-[var(--color-fg-muted)]">
                          {u.phone}
                        </span>
                      </div>
                      <Plus
                        size={16}
                        className="text-[var(--color-accent)]"
                        aria-hidden
                      />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mt-4 flex items-center justify-between border-t pt-3"
               style={{ borderColor: "var(--color-border-subtle)" }}>
            <span className="text-xs text-[var(--color-fg-muted)]">
              {picked.length} selected
            </span>
            <button
              type="button"
              disabled={!canCreate}
              onClick={() => createMutation.mutate()}
              className="rounded-lg px-4 py-2 text-sm font-semibold text-[var(--color-accent-fg)] disabled:cursor-not-allowed disabled:opacity-50"
              style={{ backgroundColor: "var(--color-accent)" }}
            >
              {createMutation.isPending ? "Creating…" : "Create"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
