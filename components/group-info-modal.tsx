"use client";

/**
 * Phase 6 — Group Info modal.
 *
 * Opens from the chat header for group conversations (and a small
 * contact-info sheet for directs — Phase 7 polish on the latter).
 *
 * Per the spec:
 *   - Editable name (admin only)
 *   - Member list with role badges + per-member online dot from the
 *     realtime presence store
 *   - "Add member" (admin only) — opens a child search picker that
 *     reuses `searchUsers(..., conversationId)`
 *   - Per-member "Remove" (admin only, not on self)
 *   - "Leave group" (any member; warning if last admin)
 *   - "Delete group" (admin only, with confirm)
 */

import { useEffect, useState, type ChangeEvent } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  LogOut,
  ImagePlus,
  Search,
  Shield,
  Timer,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Avatar } from "./avatar";
import { ConversationAvatar } from "./conversation-avatar";
import {
  ApiError,
  addMember,
  deleteGroup,
  promoteMember,
  queryKeys,
  removeMember,
  searchUsers,
  setDisappearingTimer,
  updateGroupAvatar,
  uploadImage,
  DISAPPEARING_TIMER_OPTIONS,
  type Conversation,
  type User,
  type UserSearchResult,
} from "@/lib/api";
import { useRealtimeStore } from "@/store/realtime";

interface Props {
  open: boolean;
  onClose: () => void;
  conversation: Conversation;
  currentUserId: number | null;
}

const DEBOUNCE_MS = 150;

export function GroupInfoModal({
  open,
  onClose,
  conversation,
  currentUserId,
}: Props) {
  const queryClient = useQueryClient();

  const isAdmin = conversation.role === "admin";
  const presenceByUser = useRealtimeStore((s) => s.presenceByUser);

  const [nameDraft, setNameDraft] = useState(conversation.name ?? "");
  useEffect(() => {
    if (open) setNameDraft(conversation.name ?? "");
  }, [open, conversation.name]);

  const [adding, setAdding] = useState(false);
  const [groupPhoto, setGroupPhoto] = useState<File | null>(null);
  const [groupPhotoPreview, setGroupPhotoPreview] = useState("");
  useEffect(() => {
    if (!open) setGroupPhoto(null);
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
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [addSearch, setAddSearch] = useState("");
  const [debouncedAddSearch, setDebouncedAddSearch] = useState("");
  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedAddSearch(addSearch.trim()), DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [addSearch]);

  // Esc-to-close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const memberIds = new Set(conversation.participants?.map((p) => p.id) ?? []);
  const adminIds = (conversation.participants ?? [])
    .filter((p) => p.role === "admin")
    .map((p) => p.id);
  const isLastAdmin =
    isAdmin && adminIds.length === 1 && adminIds[0] === currentUserId;

  const addQuery = useQuery({
    queryKey: ["users", "search", "add-member", conversation.id, debouncedAddSearch],
    queryFn: () => searchUsers(debouncedAddSearch, conversation.id),
    enabled: adding && debouncedAddSearch.length > 0,
    staleTime: 30_000,
  });

  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: queryKeys.conversations });

  const groupPhotoMutation = useMutation({
    mutationFn: async (file: File) => {
      const uploaded = await uploadImage(file);
      return updateGroupAvatar(conversation.id, uploaded.url);
    },
    onSuccess: (data) => {
      queryClient.setQueryData<Conversation[]>(queryKeys.conversations, (items) =>
        items?.map((item) =>
          item.id === conversation.id
            ? { ...item, avatar_url: data.avatar_url }
            : item,
        ),
      );
      setGroupPhoto(null);
      toast.success("Group photo updated");
      refresh();
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : "Couldn't update group photo";
      toast.error(msg);
    },
  });

  const timerMutation = useMutation({
    mutationFn: (seconds: number | null) =>
      setDisappearingTimer(conversation.id, seconds),
    onMutate: async (seconds) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.conversations });
      const previous = queryClient.getQueryData<Conversation[]>(queryKeys.conversations);
      queryClient.setQueryData<Conversation[]>(queryKeys.conversations, (items) =>
        items?.map((item) => item.id === conversation.id
          ? { ...item, disappear_after_seconds: seconds }
          : item),
      );
      return { previous };
    },
    onSuccess: () => {
      toast.success("Disappearing message timer updated");
    },
    onError: (err, _seconds, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.conversations, context.previous);
      }
      const msg = err instanceof ApiError ? err.message : "Couldn't update timer";
      toast.error(msg);
    },
    onSettled: refresh,
  });

  const addMutation = useMutation({
    mutationFn: (userId: number) => addMember(conversation.id, userId),
    onSuccess: (data) => {
      toast.success(`Added ${data.added.display_name ?? data.added.phone}`);
      refresh();
      setAddSearch("");
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : "Couldn't add member";
      toast.error(msg);
    },
  });

  const removeMutation = useMutation({
    mutationFn: (userId: number) => removeMember(conversation.id, userId),
    onSuccess: () => {
      toast.success("Removed");
      refresh();
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : "Couldn't remove";
      toast.error(msg);
    },
  });

  const promoteMutation = useMutation({
    mutationFn: (userId: number) => promoteMember(conversation.id, userId, "admin"),
    onSuccess: () => {
      toast.success("Promoted to admin");
      refresh();
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : "Couldn't promote";
      toast.error(msg);
    },
  });

  function handleGroupPhotoChange(event: ChangeEvent<HTMLInputElement>) {
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

  const deleteMutation = useMutation({
    mutationFn: () => deleteGroup(conversation.id),
    onSuccess: () => {
      toast.success("Group deleted");
      refresh();
      onClose();
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : "Couldn't delete";
      toast.error(msg);
    },
  });

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${conversation.type === "group" ? "Group" : "Contact"} info for ${conversation.name ?? "this conversation"}`}
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ backgroundColor: "rgba(0,0,0,0.35)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-[480px] flex-col overflow-hidden rounded-2xl border bg-[var(--color-bg-primary)] shadow-xl"
        style={{ borderColor: "var(--color-border-subtle)" }}
      >
        <header
          className="flex items-center justify-between border-b px-4 py-3"
          style={{ borderColor: "var(--color-border-subtle)" }}
        >
            <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--color-fg-primary)]">
            {conversation.type === "group" ? <Users size={16} /> : <UserPlus size={16} />} {conversation.type === "group" ? "Group info" : "Contact info"}
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

        <div className="overflow-y-auto p-4">
          {conversation.type === "group" ? (
            <section
              className="mb-4 flex items-center gap-3 rounded-xl border p-3"
              style={{ borderColor: "var(--color-border-subtle)" }}
            >
              {groupPhotoPreview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={groupPhotoPreview}
                  alt="Group photo preview"
                  className="h-14 w-14 shrink-0 rounded-full object-cover"
                />
              ) : (
                <ConversationAvatar
                  avatarUrl={conversation.avatar_url}
                  displayName={conversation.name ?? "Group"}
                  isGroup
                  size={56}
                />
              )}
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className="text-sm font-medium text-[var(--color-fg-primary)]">
                  Group photo
                </span>
                {isAdmin ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <label
                      htmlFor={`group-photo-${conversation.id}`}
                      className="inline-flex w-fit cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs text-[var(--color-fg-primary)] hover:bg-[var(--color-bg-tertiary)]"
                      style={{ borderColor: "var(--color-border-subtle)" }}
                    >
                      <ImagePlus size={13} aria-hidden />
                      {conversation.avatar_url?.includes("api.dicebear.com")
                        ? "Add photo"
                        : "Change photo"}
                    </label>
                    <input
                      id={`group-photo-${conversation.id}`}
                      type="file"
                      accept="image/*"
                      onChange={handleGroupPhotoChange}
                      disabled={groupPhotoMutation.isPending}
                      className="sr-only"
                      aria-label="Choose group photo"
                    />
                    {groupPhoto ? (
                      <button
                        type="button"
                        onClick={() => groupPhotoMutation.mutate(groupPhoto)}
                        disabled={groupPhotoMutation.isPending}
                        className="rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                        style={{
                          backgroundColor: "var(--color-accent)",
                          color: "var(--color-accent-fg)",
                        }}
                      >
                        {groupPhotoMutation.isPending ? "Saving…" : "Save photo"}
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <span className="text-xs text-[var(--color-fg-muted)]">
                    Only group admins can change the photo.
                  </span>
                )}
                {groupPhoto ? (
                  <span className="truncate text-xs text-[var(--color-fg-muted)]">
                    {groupPhoto.name}
                  </span>
                ) : null}
              </div>
            </section>
          ) : null}
          <section className="mb-4 rounded-xl border p-3" style={{ borderColor: "var(--color-border-subtle)" }}>
            <div className="flex items-center gap-2 text-sm font-medium text-[var(--color-fg-primary)]">
              <Timer size={15} /> Disappearing messages
            </div>
            <p className="mt-1 text-xs text-[var(--color-fg-muted)]">
              {conversation.disappear_after_seconds == null
                ? "Off"
                : `Messages disappear after ${DISAPPEARING_TIMER_OPTIONS.find((option) => option.value === conversation.disappear_after_seconds)?.label ?? "a set time"}`}
            </p>
            <label className="mt-2 block">
              <span className="sr-only">Disappearing messages timer</span>
              <select
                value={conversation.disappear_after_seconds ?? ""}
                disabled={timerMutation.isPending}
                onChange={(event) => timerMutation.mutate(event.target.value ? Number(event.target.value) : null)}
                className="w-full rounded-lg border bg-[var(--color-bg-secondary)] px-3 py-2 text-sm text-[var(--color-fg-primary)] outline-none focus:ring-2 focus:ring-[var(--color-accent)] disabled:opacity-60"
                style={{ borderColor: "var(--color-border-subtle)" }}
              >
                {DISAPPEARING_TIMER_OPTIONS.map((option) => (
                  <option key={option.label} value={option.value ?? ""}>{option.label}</option>
                ))}
              </select>
            </label>
          </section>
          {/* Group name (editable if admin) */}
          <section className="mb-4">
            <label className="block text-xs font-medium text-[var(--color-fg-secondary)]">
              Name
            </label>
            {isAdmin ? (
              <input
                value={nameDraft}
                disabled
                readOnly
                title="(Phase 7 will wire name editing)"
                className="mt-1 w-full rounded-lg border bg-[var(--color-bg-secondary)] px-3 py-2 text-sm text-[var(--color-fg-primary)] outline-none focus:ring-2 focus:ring-[var(--color-accent)] disabled:opacity-70"
                style={{ borderColor: "var(--color-border-subtle)" }}
              />
            ) : (
              <p className="mt-1 text-sm text-[var(--color-fg-primary)]">
                {conversation.name ?? "(unnamed)"}
              </p>
            )}
          </section>

          {/* Members */}
          <section className="mb-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-medium text-[var(--color-fg-secondary)]">
                Members ({conversation.participants?.length ?? 0})
              </h3>
              {isAdmin ? (
                <button
                  type="button"
                  onClick={() => setAdding((v) => !v)}
                  className="flex items-center gap-1 text-xs text-[var(--color-accent)] hover:underline"
                >
                  <UserPlus size={12} /> {adding ? "Done" : "Add member"}
                </button>
              ) : null}
            </div>

            {adding ? (
              <div className="mb-3">
                <label className="relative block">
                  <span className="sr-only">Add members</span>
                  <Search
                    className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-fg-muted)]"
                    size={14}
                    aria-hidden
                  />
                  <input
                    autoFocus
                    type="search"
                    placeholder="Add a member"
                    value={addSearch}
                    onChange={(e) => setAddSearch(e.target.value)}
                    className="w-full rounded-full border bg-[var(--color-bg-secondary)] py-1.5 pl-8 pr-3 text-sm text-[var(--color-fg-primary)] outline-none placeholder:text-[var(--color-fg-muted)] focus:ring-2 focus:ring-[var(--color-accent)]"
                    style={{ borderColor: "var(--color-border-subtle)" }}
                  />
                </label>
                {addQuery.data && addQuery.data.length > 0 ? (
                  <ul className="mt-2 max-h-44 overflow-y-auto">
                    {addQuery.data
                      .filter((r) => !memberIds.has(r.id))
                      .map((u) => (
                        <li key={u.id}>
                          <button
                            type="button"
                            disabled={addMutation.isPending}
                            onClick={() => addMutation.mutate(u.id)}
                            className="flex w-full items-center gap-3 rounded px-2 py-1.5 text-left hover:bg-[var(--color-bg-tertiary)] disabled:opacity-50"
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
                            <UserPlus size={14} className="text-[var(--color-accent)]" />
                          </button>
                        </li>
                      ))}
                  </ul>
                ) : null}
              </div>
            ) : null}

            <ul className="flex flex-col gap-1">
              {(conversation.participants ?? []).map((p) => {
                const isSelf = p.id === currentUserId;
                const isParticipantAdmin = p.role === "admin";
                const online = Boolean(presenceByUser[p.id]);
                return (
                  <li
                    key={p.id}
                    className="flex items-center gap-3 rounded px-2 py-1.5 hover:bg-[var(--color-bg-tertiary)]"
                  >
                    <Avatar
                      subject={{
                        avatar_url: p.avatar_url ?? "",
                        display_name: p.display_name ?? p.phone ?? "?",
                        last_seen: p.last_seen ?? null,
                      }}
                      online={online}
                    />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium text-[var(--color-fg-primary)]">
                        {p.display_name ?? p.phone}
                        {isSelf ? (
                          <span className="ml-1 text-xs text-[var(--color-fg-muted)]">
                            (you)
                          </span>
                        ) : null}
                      </span>
                      <span className="truncate text-[11px] text-[var(--color-fg-muted)]">
                        {online ? "online" : p.phone}
                      </span>
                    </div>
                    {isParticipantAdmin ? (
                      <span
                        className="flex items-center gap-1 rounded-full bg-[var(--color-accent)]/15 px-2 py-0.5 text-[11px] font-semibold"
                        style={{ color: "var(--color-accent)" }}
                      >
                        <Shield size={10} /> admin
                      </span>
                    ) : null}
                    {isAdmin && !isSelf ? (
                      <div className="flex items-center gap-1">
                        {!isParticipantAdmin ? (
                          <button
                            type="button"
                            onClick={() => promoteMutation.mutate(p.id)}
                            className="rounded px-2 py-1 text-xs text-[var(--color-accent)] hover:bg-[var(--color-bg-tertiary)]"
                          >
                            Promote
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => removeMutation.mutate(p.id)}
                          aria-label={`Remove ${p.display_name ?? p.phone}`}
                          className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-status-error)]"
                        >
                          <UserMinus size={14} />
                        </button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        </div>

        <footer
          className="flex items-center justify-between gap-2 border-t px-4 py-3"
          style={{ borderColor: "var(--color-border-subtle)" }}
        >
          <button
            type="button"
            disabled={isLastAdmin || removeMutation.isPending}
            onClick={() => {
              if (currentUserId == null) return;
              // Re-use removeMember — the backend treats "leave" and
              // "remove" symmetrically (the row disappears either way).
              removeMutation.mutate(currentUserId, {
                onSuccess: () => {
                  toast.success("Left group");
                  onClose();
                },
              });
            }}
            className="inline-flex items-center gap-1 rounded px-3 py-1.5 text-xs text-[var(--color-fg-primary)] hover:bg-[var(--color-bg-tertiary)] disabled:cursor-not-allowed disabled:opacity-50"
            title={isLastAdmin ? "Promote another admin first" : "Leave group"}
          >
            <LogOut size={12} /> Leave
          </button>
          {isAdmin ? (
            confirmDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-xs" style={{ color: "var(--color-status-error)" }}>
                  Confirm delete?
                </span>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="rounded px-2 py-1 text-xs hover:bg-[var(--color-bg-tertiary)]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => deleteMutation.mutate()}
                  disabled={deleteMutation.isPending}
                  className="rounded px-2 py-1 text-xs"
                  style={{
                    backgroundColor: "var(--color-status-error)",
                    color: "var(--color-accent-fg)",
                  }}
                >
                  {deleteMutation.isPending ? "Deleting…" : "Delete"}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="inline-flex items-center gap-1 rounded px-3 py-1.5 text-xs"
                style={{ color: "var(--color-status-error)" }}
              >
                <Trash2 size={12} /> Delete group
              </button>
            )
          ) : null}
        </footer>
      </div>
    </div>
  );
}

/* Self-reference for unused-import linting if any. */
const _userType: User | null = null;
void _userType;
// (UserSearchResult is type-only — used in `useQuery<UserSearchResult[]>` above)
