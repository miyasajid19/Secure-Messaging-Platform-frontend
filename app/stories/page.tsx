"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Camera, ChevronLeft, ChevronRight, ImagePlus, LoaderCircle, Play, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { ApiError, createStory, deleteStory, listStories, markStoryViewed, queryKeys, reactToStory, removeStoryReaction, uploadStoryMedia } from "@/lib/api";
import { useAuthStore, selectIsAuthenticated } from "@/store/auth";
import { Avatar } from "@/components/avatar";

const STORY_BACKGROUNDS = ["#2563eb", "#7c3aed", "#db2777", "#ea580c", "#059669", "#111827"];
const STORY_REACTIONS = ["❤️", "😂", "😮", "😢", "🔥", "👍"];

export default function StoriesPage() {
  const router = useRouter();
  const hydrated = useAuthStore((state) => state.hydrated);
  const authenticated = useAuthStore(selectIsAuthenticated);
  const currentUser = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  const [composerOpen, setComposerOpen] = useState(false);
  const [caption, setCaption] = useState("");
  const [background, setBackground] = useState(STORY_BACKGROUNDS[0]);
  const [media, setMedia] = useState<File | null>(null);
  const [mediaPreview, setMediaPreview] = useState<string | null>(null);
  const [active, setActive] = useState<{ groupIndex: number; storyIndex: number } | null>(null);

  useEffect(() => {
    if (hydrated && !authenticated) router.replace("/auth/phone");
  }, [hydrated, authenticated, router]);

  const storiesQuery = useQuery({
    queryKey: queryKeys.stories,
    queryFn: listStories,
    enabled: hydrated && authenticated,
    staleTime: 15_000,
    refetchInterval: 60_000,
  });
  const groups = storiesQuery.data ?? [];
  const createMutation = useMutation({
    mutationFn: async () => {
      let uploaded: { url: string; media_type: "image" | "video" } | null = null;
      if (media) uploaded = await uploadStoryMedia(media);
      return createStory({ media_url: uploaded?.url ?? null, media_type: uploaded?.media_type ?? "image", text: caption.trim() || null, background });
    },
    onSuccess: async () => {
      setComposerOpen(false); setCaption(""); setMedia(null); setMediaPreview(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.stories });
      toast.success("Story shared");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Couldn't share story"),
  });
  const deleteMutation = useMutation({
    mutationFn: deleteStory,
    onSuccess: async () => {
      setActive(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.stories });
      toast.success("Story deleted");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Couldn't delete story"),
  });
  const reactionMutation = useMutation({
    mutationFn: async ({ storyId, emoji, current }: { storyId: number; emoji: string; current: string | null }) =>
      current === emoji ? removeStoryReaction(storyId) : reactToStory(storyId, emoji),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.stories }),
    onError: (error) => toast.error(error instanceof Error ? error.message : "Couldn't react to story"),
  });

  const currentGroup = active ? groups[active.groupIndex] : null;
  const currentStory = currentGroup?.stories[active!.storyIndex] ?? null;
  useEffect(() => {
    if (!currentStory || currentStory.user.id === currentUser?.id || currentStory.viewed_by_me) return;
    void markStoryViewed(currentStory.id).then(() => queryClient.invalidateQueries({ queryKey: queryKeys.stories })).catch(() => {});
  }, [currentStory?.id, currentStory?.user.id, currentStory?.viewed_by_me, currentUser?.id, queryClient]);

  const totalStories = useMemo(() => groups.reduce((count, group) => count + group.stories.length, 0), [groups]);
  function openComposer() { setComposerOpen(true); }
  function handleMedia(file: File | null) {
    if (!file) return;
    const isImage = file.type.startsWith("image/") && file.type !== "image/svg+xml";
    const isVideo = ["video/mp4", "video/webm", "video/quicktime"].includes(file.type);
    if (!isImage && !isVideo) { toast.error("Choose a photo or an MP4, WebM, or MOV video"); return; }
    const limit = isVideo ? 50 * 1024 * 1024 : 5 * 1024 * 1024;
    if (file.size > limit) { toast.error(`Keep ${isVideo ? "videos" : "photos"} under ${isVideo ? "50" : "5"} MB`); return; }
    setMedia(file);
    setMediaPreview(URL.createObjectURL(file));
  }
  function stepStory(direction: -1 | 1) {
    if (!active) return;
    let { groupIndex, storyIndex } = active;
    storyIndex += direction;
    while (groupIndex >= 0 && groupIndex < groups.length) {
      const count = groups[groupIndex].stories.length;
      if (storyIndex >= 0 && storyIndex < count) { setActive({ groupIndex, storyIndex }); return; }
      groupIndex += direction;
      if (groupIndex < 0 || groupIndex >= groups.length) break;
      storyIndex = direction > 0 ? 0 : groups[groupIndex].stories.length - 1;
    }
    setActive(null);
  }

  if (!hydrated || !authenticated) return <main className="flex min-h-screen items-center justify-center text-sm text-[var(--color-fg-secondary)]">Loading Stories…</main>;

  return (
    <main className="min-h-screen overflow-y-auto pb-[calc(70px+env(safe-area-inset-bottom))] lg:pb-8" style={{ backgroundColor: "var(--color-bg-secondary)" }}>
      <header className="mx-auto flex max-w-5xl items-center gap-4 px-5 py-6 sm:px-8">
        <button onClick={() => router.push("/chat")} aria-label="Back to chats" className="rounded-full p-2 text-[var(--color-fg-secondary)] hover:bg-[var(--color-bg-tertiary)]"><ArrowLeft size={20} /></button>
        <div className="min-w-0 flex-1"><h1 className="text-2xl font-semibold text-[var(--color-fg-primary)]">Stories</h1><p className="mt-1 text-sm text-[var(--color-fg-secondary)]">Photos and notes disappear after 24 hours.</p></div>
        <button onClick={openComposer} className="inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold" style={{ backgroundColor: "var(--color-accent)", color: "var(--color-accent-fg)" }}><Plus size={18} /> Add story</button>
      </header>

      <section className="mx-auto max-w-5xl px-5 sm:px-8" aria-label="Active stories">
        <div className="mb-4 flex items-center justify-between"><h2 className="text-sm font-semibold text-[var(--color-fg-primary)]">Recent updates</h2><span className="text-xs text-[var(--color-fg-muted)]">{totalStories} {totalStories === 1 ? "story" : "stories"}</span></div>
        {storiesQuery.isLoading ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">{[0, 1, 2, 3].map((item) => <div key={item} className="h-48 animate-pulse rounded-2xl" style={{ backgroundColor: "var(--color-bg-tertiary)" }} />)}</div> : storiesQuery.error ? <div className="rounded-2xl border p-6 text-sm text-[var(--color-fg-secondary)]" style={{ borderColor: "var(--color-border-subtle)" }}>{storiesQuery.error instanceof ApiError ? storiesQuery.error.message : "Couldn't load stories."} <button onClick={() => void storiesQuery.refetch()} className="ml-2 font-semibold text-[var(--color-accent)]">Try again</button></div> : groups.length === 0 ? <div className="flex min-h-64 flex-col items-center justify-center rounded-3xl border border-dashed px-6 text-center" style={{ borderColor: "var(--color-border-subtle)" }}><div className="mb-4 rounded-full p-4 text-[var(--color-accent)]" style={{ backgroundColor: "var(--color-bg-primary)" }}><Camera size={24} /></div><h3 className="font-semibold text-[var(--color-fg-primary)]">No stories yet</h3><p className="mt-1 max-w-sm text-sm text-[var(--color-fg-secondary)]">Share a quick photo or note. It will be here for the next 24 hours.</p><button onClick={openComposer} className="mt-5 rounded-full px-4 py-2 text-sm font-semibold" style={{ backgroundColor: "var(--color-accent)", color: "var(--color-accent-fg)" }}>Share your first story</button></div> : <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">{groups.map((group, groupIndex) => {
          const latest = group.stories[group.stories.length - 1];
          return <button key={group.user.id} onClick={() => setActive({ groupIndex, storyIndex: 0 })} className="group relative h-48 overflow-hidden rounded-2xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] sm:h-60" style={{ backgroundColor: "var(--color-bg-tertiary)" }}>
            {latest.media_url ? (latest.media_type === "video" ? <video src={latest.media_url} muted playsInline preload="metadata" className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" /> : <img src={latest.media_url} alt="" className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" />) : <div className="absolute inset-0 flex items-center justify-center px-5 text-center text-xl font-semibold text-white" style={{ backgroundColor: latest.background }}>{latest.text}</div>}
            {latest.media_type === "video" ? <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/40 p-3 text-white"><Play size={20} fill="currentColor" /></span> : null}
            <div className="absolute inset-0 bg-gradient-to-b from-black/35 via-transparent to-black/70" />
            <div className="absolute inset-x-3 top-3 flex gap-1">{group.stories.map((story) => <span key={story.id} className="h-0.5 flex-1 rounded-full" style={{ backgroundColor: story.viewed_by_me ? "#ffffff80" : "white" }} />)}</div>
            <div className="absolute inset-x-3 bottom-3 flex items-center gap-2"><Avatar subject={{ avatar_url: group.user.avatar_url, display_name: group.user.display_name || group.user.username || "User" }} size={34} showOnline={false} /><span className="truncate text-sm font-semibold text-white">{group.user.id === currentUser?.id ? "Your story" : group.user.display_name || group.user.username || "Signal user"}</span></div>
          </button>;
        })}</div>}
      </section>

      {composerOpen ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setComposerOpen(false); }}><section role="dialog" aria-modal="true" aria-labelledby="story-title" className="w-full max-w-md overflow-hidden rounded-3xl border shadow-2xl" style={{ backgroundColor: "var(--color-bg-primary)", borderColor: "var(--color-border-subtle)" }}>
        <header className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: "var(--color-border-subtle)" }}><div><h2 id="story-title" className="font-semibold text-[var(--color-fg-primary)]">Create a story</h2><p className="mt-0.5 text-xs text-[var(--color-fg-secondary)]">Visible for 24 hours</p></div><button onClick={() => setComposerOpen(false)} aria-label="Close" className="rounded-full p-2 hover:bg-[var(--color-bg-tertiary)]"><X size={18} /></button></header>
        <div className="space-y-4 p-5"><div className="relative flex h-64 items-center justify-center overflow-hidden rounded-2xl px-6 text-center" style={{ backgroundColor: mediaPreview ? "#111" : background }}>{mediaPreview ? (media?.type.startsWith("video/") ? <video src={mediaPreview} muted playsInline controls className="absolute inset-0 h-full w-full object-contain" /> : <img src={mediaPreview} alt="Story preview" className="absolute inset-0 h-full w-full object-cover" />) : <p className="relative text-2xl font-semibold text-white">{caption.trim() || "Your note will appear here"}</p>}</div>
          <textarea value={caption} onChange={(event) => setCaption(event.target.value)} maxLength={500} rows={3} placeholder="Add a caption or write a note…" className="w-full resize-none rounded-xl border bg-transparent px-3 py-2.5 text-sm text-[var(--color-fg-primary)] outline-none placeholder:text-[var(--color-fg-muted)] focus:border-[var(--color-accent)]" style={{ borderColor: "var(--color-border-subtle)" }} />
          <div className="flex items-center justify-between gap-3"><label className="inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-2 text-sm text-[var(--color-fg-primary)] hover:bg-[var(--color-bg-tertiary)]" style={{ borderColor: "var(--color-border-subtle)" }}><ImagePlus size={17} />{media ? "Change media" : "Add photo or video"}<input type="file" accept="image/*,video/mp4,video/webm,video/quicktime" className="sr-only" onChange={(event) => handleMedia(event.target.files?.[0] ?? null)} /></label>{media ? <button onClick={() => { setMedia(null); setMediaPreview(null); }} className="text-xs text-[var(--color-fg-secondary)] hover:underline">Remove media</button> : <div className="flex gap-1.5">{STORY_BACKGROUNDS.map((color) => <button key={color} onClick={() => setBackground(color)} aria-label={`Choose ${color} background`} className="h-6 w-6 rounded-full ring-offset-2" style={{ backgroundColor: color, outline: background === color ? `2px solid ${color}` : undefined }} />)}</div>}</div>
          <button disabled={createMutation.isPending || (!caption.trim() && !media)} onClick={() => createMutation.mutate()} className="flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50" style={{ backgroundColor: "var(--color-accent)", color: "var(--color-accent-fg)" }}>{createMutation.isPending ? <><LoaderCircle size={17} className="animate-spin" /> Sharing…</> : "Share story"}</button>
        </div>
      </section></div> : null}

      {active && currentStory && currentGroup ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-3 sm:p-6" role="presentation" onClick={() => setActive(null)}><section role="dialog" aria-modal="true" aria-label="Story viewer" className="relative h-[min(88vh,760px)] w-full max-w-[430px] overflow-hidden rounded-3xl bg-black" onClick={(event) => event.stopPropagation()}>
        {currentStory.media_url ? (currentStory.media_type === "video" ? <video key={currentStory.id} src={currentStory.media_url} autoPlay muted playsInline controls onEnded={() => stepStory(1)} className="absolute inset-x-0 top-0 h-[calc(100%-6.5rem)] w-full object-contain" /> : <img src={currentStory.media_url} alt="Story" className="absolute inset-0 h-full w-full object-contain" />) : <div className="absolute inset-0 flex items-center justify-center px-10 pb-24 text-center text-3xl font-semibold text-white" style={{ backgroundColor: currentStory.background }}>{currentStory.text}</div>}
        {currentStory.media_url && currentStory.text ? <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-6 pb-12 pt-20 text-center text-lg font-medium text-white">{currentStory.text}</div> : null}
        <div className="absolute inset-x-3 top-3 flex gap-1">{currentGroup.stories.map((story, index) => <span key={story.id} className="h-0.5 flex-1 rounded-full" style={{ backgroundColor: index <= active.storyIndex ? "white" : "#ffffff66" }} />)}</div>
        <div className="absolute inset-x-4 top-7 flex items-center gap-3"><Avatar subject={{ avatar_url: currentGroup.user.avatar_url, display_name: currentGroup.user.display_name || currentGroup.user.username || "User" }} size={36} showOnline={false} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-white">{currentGroup.user.id === currentUser?.id ? "Your story" : currentGroup.user.display_name || currentGroup.user.username || "Signal user"}</p><p className="text-xs text-white/70">{new Date(currentStory.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}{currentGroup.user.id === currentUser?.id ? ` · ${currentStory.view_count} views` : ""}</p></div>{currentGroup.user.id === currentUser?.id ? <button onClick={() => deleteMutation.mutate(currentStory.id)} aria-label="Delete story" className="rounded-full p-2 text-white hover:bg-white/15"><Trash2 size={18} /></button> : null}<button onClick={() => setActive(null)} aria-label="Close story" className="rounded-full p-2 text-white hover:bg-white/15"><X size={19} /></button></div>
        {currentStory.media_type !== "video" ? <><button onClick={() => stepStory(-1)} aria-label="Previous story" className="absolute inset-y-20 left-0 w-1/3 cursor-pointer" /><button onClick={() => stepStory(1)} aria-label="Next story" className="absolute inset-y-20 right-0 w-1/3 cursor-pointer" /></> : null}
        <div className="absolute inset-x-0 bottom-4 z-10 flex flex-col items-center gap-2 px-4">
          {currentGroup.user.id === currentUser?.id ? (
            currentStory.reactions.length > 0 ? <div className="flex max-h-32 w-full max-w-sm flex-wrap justify-center gap-1.5 overflow-y-auto rounded-2xl border border-white/15 bg-black/55 p-2.5 shadow-xl backdrop-blur-xl">
              {currentStory.reactions.map((reaction) => (
                <span key={reaction.user_id} className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-sm text-white">
                  <span>{reaction.emoji}</span><span className="max-w-28 truncate">{reaction.display_name || reaction.username || "User"}</span>
                </span>
              ))}
            </div> : null
          ) : (
            <>
              {currentStory.my_reaction ? <span className="rounded-full border border-white/15 bg-black/55 px-3 py-1.5 text-sm text-white shadow-lg backdrop-blur-xl">Your reaction <span className="ml-1 text-lg">{currentStory.my_reaction}</span></span> : null}
              <div className="flex items-center gap-1 rounded-full border border-white/15 bg-black/55 px-2 py-1.5 shadow-xl backdrop-blur-xl">
                {STORY_REACTIONS.map((emoji) => <button key={emoji} onClick={() => reactionMutation.mutate({ storyId: currentStory.id, emoji, current: currentStory.my_reaction })} aria-label={`React ${emoji}`} aria-pressed={currentStory.my_reaction === emoji} title={`React ${emoji}`} className={`rounded-full px-2 py-1 text-xl leading-none transition-[transform,background-color,box-shadow] duration-200 ease-out hover:-translate-y-1 hover:scale-125 hover:bg-white/15 hover:shadow-[0_4px_16px_rgba(255,255,255,0.2)] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${currentStory.my_reaction === emoji ? "scale-110 bg-white/20 shadow-[0_0_14px_rgba(255,255,255,0.24)]" : ""}`}>
                  {emoji}
                </button>)}
              </div>
            </>
          )}
        </div>
        <button onClick={() => stepStory(-1)} aria-label="Previous" className="absolute left-2 top-1/2 rounded-full bg-black/25 p-1 text-white"><ChevronLeft size={20} /></button><button onClick={() => stepStory(1)} aria-label="Next" className="absolute right-2 top-1/2 rounded-full bg-black/25 p-1 text-white"><ChevronRight size={20} /></button>
      </section></div> : null}
    </main>
  );
}
