"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { Camera, CameraOff, Maximize2, Mic, MicOff, Minimize2, MonitorOff, MonitorUp, Phone, PhoneOff, PictureInPicture2, Signal, UserPlus, Video, X } from "lucide-react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { Avatar } from "@/components/avatar";
import { useAuthStore } from "@/store/auth";
import { useRealtimeStore, type ActiveGroupCall } from "@/store/realtime";
import { createGroup, getAppSettings, getIceServers, getQueryClient, listContacts, listConversations, queryKeys, type Contact, type IceServer } from "@/lib/api";
import { isRealtimeConnected, sendCallSignal, subscribeToCallSignals, type CallSignal } from "@/lib/realtime";

type CallState = {
  callId: string;
  conversationId: number;
  peerId: number;
  peerName: string;
  inviterName: string | null;
  peerAvatarUrl: string | null;
  mediaType: "audio" | "video";
  direction: "incoming" | "outgoing";
  status: "ringing" | "connecting" | "reconnecting" | "active";
  startedAt: number | null;
  muted: boolean;
  cameraOff: boolean;
  peerCameraOff: boolean;
  isGroup: boolean;
  participants: Array<{ id: number; displayName: string; avatarUrl: string | null }>;
  peerCameraOffById: Record<number, boolean>;
};
type NetworkQuality = "checking" | "good" | "fair" | "weak";

type MiniCallCardProps = {
  call: CallState;
  participants: CallState["participants"];
  streams: Record<number, MediaStream>;
  duration: string;
  networkQuality: NetworkQuality;
  self: { display_name: string | null; username: string | null; avatar_url: string | null } | null;
  onRestore: () => void;
  onMute: () => void;
  onCamera: () => void;
  onScreenShare: () => void;
  isScreenSharing: boolean;
  onAddPeople: () => void;
  onEnd: () => void;
  onAccept: () => void;
  onPictureInPicture: () => void;
};

function MiniCallCard({ call, participants, streams, duration, networkQuality, self, onRestore, onMute, onCamera, onScreenShare, isScreenSharing, onAddPeople, onEnd, onAccept, onPictureInPicture }: MiniCallCardProps) {
  const cardRef = useRef<HTMLElement>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; left: number; top: number; moved: boolean } | null>(null);
  const resizeRef = useRef<{ pointerId: number; startX: number; startY: number; left: number; top: number; width: number; height: number } | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const [size, setSize] = useState({ width: 340, height: call.mediaType === "video" ? 230 : 140 });
  const [isMobile, setIsMobile] = useState(false);
  const [layoutLoaded, setLayoutLoaded] = useState(false);
  const firstParticipant = participants[0];
  const ringing = call.direction === "incoming" && call.status === "ringing";
  const isVideo = call.mediaType === "video";
  const storageKey = `signal-clone:minimized-call-window:${call.mediaType}`;

  useEffect(() => {
    const loadLayout = () => {
      setIsMobile(window.innerWidth < 640);
      try {
        const saved = localStorage.getItem(storageKey);
        if (saved) {
          const layout = JSON.parse(saved) as { left?: number; top?: number; width?: number; height?: number };
          if (typeof layout.width === "number" && Number.isFinite(layout.width) && typeof layout.height === "number" && Number.isFinite(layout.height)) {
            setSize({ width: Math.min(640, Math.max(280, layout.width)), height: Math.min(520, Math.max(isVideo ? 220 : 126, layout.height)) });
          }
          if (typeof layout.left === "number" && Number.isFinite(layout.left) && typeof layout.top === "number" && Number.isFinite(layout.top)) {
            setPosition({ left: Math.max(12, layout.left), top: Math.max(12, layout.top) });
          }
        }
      } catch { /* Ignore an invalid saved layout. */ }
      setLayoutLoaded(true);
    };
    loadLayout();
    const handleResize = () => {
      setIsMobile(window.innerWidth < 640);
      const card = cardRef.current;
      if (!card || window.innerWidth < 640) return;
      const rect = card.getBoundingClientRect();
      setPosition((current) => current ? {
        left: Math.min(current.left, window.innerWidth - rect.width - 12),
        top: Math.min(current.top, window.innerHeight - rect.height - 12),
      } : current);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [isVideo, storageKey]);

  useEffect(() => {
    if (!layoutLoaded) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify({ ...position, ...size }));
    } catch { /* Storage may be unavailable; the floating call still works. */ }
  }, [layoutLoaded, position, size, storageKey]);
  const startDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (window.innerWidth < 640 || (event.target instanceof Element && event.target.closest("button"))) return;
    const rect = cardRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, left: rect.left, top: rect.top, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    drag.moved = true;
    const card = cardRef.current;
    if (!card) return;
    const maxLeft = window.innerWidth - card.offsetWidth - 12;
    const maxTop = window.innerHeight - card.offsetHeight - 12;
    setPosition({ left: Math.min(Math.max(12, drag.left + dx), maxLeft), top: Math.min(Math.max(12, drag.top + dy), maxTop) });
  };
  const finishDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const card = cardRef.current;
    if (drag.moved && card) {
      const rect = card.getBoundingClientRect();
      const left = rect.left + rect.width / 2 < window.innerWidth / 2 ? 12 : window.innerWidth - rect.width - 12;
      const top = rect.top + rect.height / 2 < window.innerHeight / 2 ? 12 : window.innerHeight - rect.height - 12;
      setPosition({ left, top });
    }
    dragRef.current = null;
  };
  const startResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const rect = cardRef.current?.getBoundingClientRect();
    if (!rect) return;
    resizeRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    event.currentTarget.setPointerCapture(event.pointerId);
    setPosition({ left: rect.left, top: rect.top });
  };
  const moveResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const resize = resizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    const maxWidth = Math.min(640, window.innerWidth - resize.left - 12);
    const maxHeight = Math.min(520, window.innerHeight - resize.top - 12);
    setSize({ width: Math.min(Math.max(280, resize.width + event.clientX - resize.startX), maxWidth), height: Math.min(Math.max(isVideo ? 220 : 126, resize.height + event.clientY - resize.startY), maxHeight) });
  };
  const finishResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (resizeRef.current?.pointerId === event.pointerId) resizeRef.current = null;
  };
  const positionStyle = !isMobile && position ? { left: position.left, top: position.top } : undefined;
  const sizeStyle = !layoutLoaded || isMobile ? undefined : { width: size.width, height: size.height };
  return <section ref={cardRef} style={{ ...sizeStyle, ...positionStyle }} aria-label={`${isVideo ? "Video" : "Voice"} call, minimized`} className={`fixed z-[100] flex w-[min(340px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-primary)] text-[var(--color-fg-primary)] shadow-2xl max-sm:bottom-24 max-sm:right-2 max-sm:h-auto max-sm:w-[calc(100vw-1rem)] ${!isMobile && position ? "" : "bottom-24 right-4"}`}>
    {isVideo ? <>
    <div className="relative hidden min-h-0 flex-1 touch-none cursor-grab bg-neutral-950 active:cursor-grabbing sm:block" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={finishDrag} onPointerCancel={finishDrag}>
      {firstParticipant ? <RemoteVideo stream={streams[firstParticipant.id]} name={firstParticipant.displayName} cameraOff={call.isGroup ? Boolean(call.peerCameraOffById[firstParticipant.id]) : call.peerCameraOff} avatarUrl={firstParticipant.avatarUrl} /> : <div className="flex h-full items-center justify-center"><Avatar subject={{ avatar_url: call.peerAvatarUrl, display_name: call.peerName }} size={80} showOnline={false} /></div>}
      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between bg-gradient-to-t from-black/75 to-transparent p-3 text-white">
        <div className="min-w-0"><p className="truncate text-sm font-semibold">{call.peerName}</p><p aria-live="polite" className="text-xs text-white/75">{callStatusText(call, duration)}</p><ConnectionQuality quality={networkQuality} /></div>
        <button type="button" onClick={onRestore} aria-label="Restore full-screen call" title="Return to call" className="rounded-lg bg-white/15 p-2 transition hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"><Maximize2 size={17} /></button>
      </div>
    </div>
    <div className="flex items-center gap-2 p-2 sm:hidden" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={finishDrag} onPointerCancel={finishDrag}>
      <Avatar subject={{ avatar_url: firstParticipant?.avatarUrl ?? call.peerAvatarUrl, display_name: firstParticipant?.displayName ?? call.peerName }} size={40} showOnline={false} />
      <button type="button" onClick={onRestore} className="min-w-0 flex-1 text-left" aria-label="Restore full-screen call"><span className="block truncate text-sm font-semibold">{call.peerName}</span><span aria-live="polite" className="block text-xs text-[var(--color-fg-secondary)]">{callStatusText(call, duration)}</span><ConnectionQuality quality={networkQuality} /></button>
      <button type="button" onClick={onRestore} aria-label="Restore full-screen call" className="rounded-lg p-2 text-[var(--color-fg-secondary)]"><Maximize2 size={17} /></button>
    </div>
    </> : <div className="flex flex-1 items-center gap-3 p-3 touch-none cursor-grab active:cursor-grabbing" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={finishDrag} onPointerCancel={finishDrag}>
      {call.isGroup ? <div className="flex -space-x-3">{participants.slice(0, 3).map((participant) => <Avatar key={participant.id} subject={{ avatar_url: participant.avatarUrl, display_name: participant.displayName }} size={42} showOnline={false} />)}</div> : <Avatar subject={{ avatar_url: call.peerAvatarUrl, display_name: call.peerName }} size={44} showOnline={false} />}
      <button type="button" onClick={onRestore} className="min-w-0 flex-1 text-left" aria-label="Restore full-screen call"><span className="block truncate text-sm font-semibold">{call.peerName}</span><span aria-live="polite" className="block text-xs text-[var(--color-fg-secondary)]">{callStatusText(call, duration)}</span><ConnectionQuality quality={networkQuality} /></button>
      <button type="button" onClick={onRestore} aria-label="Restore full-screen call" title="Return to call" className="rounded-lg p-2 text-[var(--color-fg-secondary)] transition hover:bg-[var(--color-bg-tertiary)]"><Maximize2 size={17} /></button>
    </div>}
    <div className="flex items-center justify-center gap-3 border-t border-[var(--color-border-subtle)] px-3 py-2.5">
      {ringing ? <>
        <button type="button" onClick={onEnd} aria-label="Decline call" className="flex h-10 w-10 items-center justify-center rounded-full bg-red-600 text-white hover:bg-red-700"><PhoneOff size={18} /></button>
        <button type="button" onClick={onAccept} aria-label={`Answer ${isVideo ? "video" : "voice"} call`} className="flex h-10 w-10 items-center justify-center rounded-full bg-green-600 text-white hover:bg-green-700">{isVideo ? <Video size={18} /> : <Phone size={18} />}</button>
      </> : <>
        {isVideo ? <button type="button" onClick={onPictureInPicture} aria-label="Open video in picture-in-picture" title="Picture-in-picture" className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--color-bg-tertiary)] hover:brightness-95"><PictureInPicture2 size={18} /></button> : null}
        {call.status === "active" ? <button type="button" onClick={onAddPeople} aria-label={call.isGroup ? "Invite a group member to the call" : "Add people to call"} title={call.isGroup ? "Invite a group member" : "Add people"} className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--color-bg-tertiary)] hover:brightness-95"><UserPlus size={18} /></button> : null}
        {isVideo ? <button type="button" onClick={onScreenShare} aria-label={isScreenSharing ? "Stop screen sharing" : "Share screen"} title={isScreenSharing ? "Stop screen sharing" : "Share screen"} className={`flex h-10 w-10 items-center justify-center rounded-full ${isScreenSharing ? "bg-[var(--color-accent)] text-white" : "bg-[var(--color-bg-tertiary)]"} hover:brightness-95`}>{isScreenSharing ? <MonitorOff size={18} /> : <MonitorUp size={18} />}</button> : null}
        <button type="button" onClick={onMute} aria-label={call.muted ? "Unmute microphone" : "Mute microphone"} title={call.muted ? "Unmute" : "Mute"} className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--color-bg-tertiary)] hover:brightness-95">{call.muted ? <MicOff size={18} /> : <Mic size={18} />}</button>
        {isVideo ? <button type="button" onClick={onCamera} aria-label={call.cameraOff ? "Turn camera on" : "Turn camera off"} title={call.cameraOff ? "Turn camera on" : "Turn camera off"} className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--color-bg-tertiary)] hover:brightness-95">{call.cameraOff ? <CameraOff size={18} /> : <Camera size={18} />}</button> : null}
        <button type="button" onClick={onEnd} aria-label="End call" className="flex h-10 w-10 items-center justify-center rounded-full bg-red-600 text-white hover:bg-red-700"><PhoneOff size={18} /></button>
      </>}
    </div>
    <button type="button" aria-label="Resize call window" title="Drag to resize" onPointerDown={startResize} onPointerMove={moveResize} onPointerUp={finishResize} onPointerCancel={finishResize} className="absolute bottom-0 right-0 hidden h-5 w-5 cursor-nwse-resize touch-none sm:block" style={{ background: "linear-gradient(135deg, transparent 50%, var(--color-border-default) 50%, var(--color-border-default) 58%, transparent 58%, transparent 68%, var(--color-border-default) 68%, var(--color-border-default) 76%, transparent 76%)" }} />
    {self ? <span className="sr-only">Signed in as {self.display_name ?? self.username ?? "you"}</span> : null}
  </section>;
}

type VoiceCallContextValue = {
  call: CallState | null;
  startCall: (conversationId: number, peerId: number, peerName: string, peerAvatarUrl?: string | null, mediaType?: "audio" | "video") => Promise<void>;
  startGroupCall: (conversationId: number, groupName: string, groupAvatarUrl: string | null, participants: Array<{ id: number; displayName: string; avatarUrl: string | null }>, mediaType: "audio" | "video") => Promise<void>;
  joinGroupCall: (active: ActiveGroupCall, groupAvatarUrl: string | null) => Promise<void>;
  reinviteGroupCall: (active: ActiveGroupCall, userId: number) => void;
};

const VoiceCallContext = createContext<VoiceCallContextValue | null>(null);
const FALLBACK_ICE_SERVERS: IceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

function callStatusText(call: CallState, duration: string) {
  if (call.status === "ringing" && call.direction === "incoming" && call.isGroup && call.inviterName) {
    return `${call.inviterName} is inviting you to join this call`;
  }
  if (call.status === "active") return duration;
  if (call.status === "reconnecting") return "Reconnecting…";
  if (call.status === "ringing") return call.direction === "incoming"
    ? `Incoming ${call.isGroup ? "group " : ""}${call.mediaType} call`
    : "Calling…";
  return "Connecting…";
}

function ConnectionQuality({ quality }: { quality: NetworkQuality }) {
  const label = quality === "good" ? "Good connection" : quality === "fair" ? "Fair connection" : quality === "weak" ? "Weak connection" : "Checking connection";
  const color = quality === "good" ? "bg-emerald-400" : quality === "fair" ? "bg-amber-400" : quality === "weak" ? "bg-red-400" : "bg-white/50";
  return <span title={label} aria-label={label} className="mt-1 inline-flex items-center gap-1.5 text-[11px] text-white/75"><Signal size={13} className={quality === "weak" ? "text-red-400" : quality === "fair" ? "text-amber-400" : quality === "good" ? "text-emerald-400" : "text-white/50"} /><span className={`h-1.5 w-1.5 rounded-full ${color}`} /><span>{label}</span></span>;
}

function RemoteVideo({ stream, name, cameraOff, avatarUrl }: {
  stream: MediaStream | undefined;
  name: string;
  cameraOff: boolean;
  avatarUrl: string | null;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream || cameraOff) return;
    if (video.srcObject !== stream) video.srcObject = stream;
    void video.play().catch(() => {});
    return () => { video.srcObject = null; };
  }, [stream, cameraOff]);

  return stream && !cameraOff
    ? <video ref={videoRef} data-call-remote-video autoPlay muted playsInline className="h-full w-full object-cover" />
    : <Avatar subject={{ avatar_url: avatarUrl, display_name: name }} size={112} showOnline={false} />;
}

function RemoteAudio({ stream, onPlaybackBlocked, userId, audioElements }: {
  stream: MediaStream;
  onPlaybackBlocked: (blocked: boolean) => void;
  userId: number;
  audioElements: Map<number, HTMLAudioElement>;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const setAudioElement = useCallback((element: HTMLAudioElement | null) => {
    audioRef.current = element;
    if (element) audioElements.set(userId, element);
    else audioElements.delete(userId);
  }, [audioElements, userId]);
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    let attachedTrackIds = "";
    const attachAudioTracks = () => {
      const tracks = stream.getAudioTracks().filter((track) => track.readyState === "live");
      if (!tracks.length) {
        attachedTrackIds = "";
        audio.srcObject = null;
        return;
      }
      const trackIds = tracks.map((track) => track.id).join(",");
      if (trackIds === attachedTrackIds) return;
      attachedTrackIds = trackIds;
      audio.srcObject = new MediaStream(tracks);
      void audio.play().then(() => onPlaybackBlocked(false)).catch(() => onPlaybackBlocked(true));
    };
    stream.addEventListener("addtrack", attachAudioTracks);
    stream.addEventListener("removetrack", attachAudioTracks);
    attachAudioTracks();
    return () => {
      stream.removeEventListener("addtrack", attachAudioTracks);
      stream.removeEventListener("removetrack", attachAudioTracks);
      audio.pause();
      audio.srcObject = null;
    };
  }, [stream, onPlaybackBlocked]);

  return <audio ref={setAudioElement} autoPlay playsInline className="sr-only" />;
}

export function useVoiceCall() {
  const context = useContext(VoiceCallContext);
  if (!context) throw new Error("useVoiceCall must be used inside VoiceCallProvider");
  return context;
}

export function VoiceCallProvider({ children }: { children: ReactNode }) {
  const self = useAuthStore((state) => state.user);
  const preferences = useQuery({ queryKey: queryKeys.appSettings, queryFn: getAppSettings, enabled: Boolean(self?.id) });
  const setActiveGroupCall = useRealtimeStore((state) => state.setActiveGroupCall);
  const clearActiveGroupCall = useRealtimeStore((state) => state.clearActiveGroupCall);
  const [call, setCall] = useState<CallState | null>(null);
  const [callMinimized, setCallMinimized] = useState(false);
  const [audioNeedsInteraction, setAudioNeedsInteraction] = useState(false);
  const [remoteStreams, setRemoteStreams] = useState<Record<number, MediaStream>>({});
  const [clock, setClock] = useState(0);
  const [networkQuality, setNetworkQuality] = useState<NetworkQuality>("checking");
  const [screenSharing, setScreenSharing] = useState(false);
  const [addPeopleOpen, setAddPeopleOpen] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [groupInviteOptions, setGroupInviteOptions] = useState<Array<{ id: number; name: string; avatarUrl: string | null }>>([]);
  const [addPeopleMode, setAddPeopleMode] = useState<"convert" | "reinvite">("convert");
  const [selectedContactIds, setSelectedContactIds] = useState<number[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [addingPeople, setAddingPeople] = useState(false);

  useEffect(() => {
    setClock(Date.now());
  }, []);
  const callRef = useRef<CallState | null>(null);
  const peerConnectionsRef = useRef(new Map<number, RTCPeerConnection>());
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioElementsRef = useRef(new Map<number, HTMLAudioElement>());
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const pendingCandidatesRef = useRef(new Map<number, RTCIceCandidateInit[]>());
  const iceServerCacheRef = useRef<{ servers: IceServer[]; expiresAt: number } | null>(null);
  const iceServerRequestRef = useRef<Promise<IceServer[]> | null>(null);

  const stopScreenShare = useCallback(async () => {
    const screenStream = screenStreamRef.current;
    if (!screenStream) return;
    screenStreamRef.current = null;
    const screenTrack = screenStream.getVideoTracks()[0];
    if (screenTrack) {
      screenTrack.onended = null;
      screenTrack.stop();
    }
    const cameraTrack = localStreamRef.current?.getVideoTracks()[0] ?? null;
    await Promise.allSettled([...peerConnectionsRef.current.values()].map(async (connection) => {
      const sender = connection.getSenders().find((item) => item.track?.kind === "video");
      if (sender) await sender.replaceTrack(cameraTrack);
    }));
    setScreenSharing(false);
    const current = callRef.current;
    if (current) {
      const recipients = current.isGroup
        ? current.participants.filter((participant) => participant.id !== self?.id).map((participant) => participant.id)
        : [current.peerId];
      recipients.forEach((peerId) => sendCallSignal({ type: "call.camera", call_id: current.callId, conversation_id: current.conversationId, to_user_id: peerId, camera_off: current.cameraOff }));
    }
  }, [self?.id]);

  async function toggleScreenShare() {
    if (screenStreamRef.current) {
      await stopScreenShare();
      return;
    }
    const current = callRef.current;
    if (!current || current.mediaType !== "video" || current.status !== "active") {
      toast.info("Connect the video call before sharing your screen.");
      return;
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      toast.error("Screen sharing is not supported by this browser.");
      return;
    }
    let capturedScreen: MediaStream | null = null;
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      capturedScreen = screenStream;
      const screenTrack = screenStream.getVideoTracks()[0];
      if (!screenTrack) {
        screenStream.getTracks().forEach((track) => track.stop());
        return;
      }
      const senders = [...peerConnectionsRef.current.values()].flatMap((connection) => connection.getSenders().filter((sender) => sender.track?.kind === "video"));
      if (!senders.length) {
        screenStream.getTracks().forEach((track) => track.stop());
        toast.info("Wait for the video connection before sharing your screen.");
        return;
      }
      await Promise.all(senders.map((sender) => sender.replaceTrack(screenTrack)));
      screenStreamRef.current = screenStream;
      screenTrack.onended = () => { void stopScreenShare(); };
      setScreenSharing(true);
      const recipients = current.isGroup
        ? current.participants.filter((participant) => participant.id !== self?.id).map((participant) => participant.id)
        : [current.peerId];
      recipients.forEach((peerId) => sendCallSignal({ type: "call.camera", call_id: current.callId, conversation_id: current.conversationId, to_user_id: peerId, camera_off: false }));
    } catch (error) {
      capturedScreen?.getTracks().forEach((track) => track.stop());
      const cameraTrack = localStreamRef.current?.getVideoTracks()[0] ?? null;
      await Promise.allSettled([...peerConnectionsRef.current.values()].map(async (connection) => {
        const sender = connection.getSenders().find((item) => item.track?.kind === "video");
        if (sender && screenStreamRef.current !== capturedScreen) await sender.replaceTrack(cameraTrack);
      }));
      if (error instanceof DOMException && error.name === "NotAllowedError") return;
      toast.error("Could not start screen sharing. Check your browser permissions and try again.");
    }
  }

  useEffect(() => {
    if (!call || call.status !== "active") {
      setNetworkQuality("checking");
      return;
    }
    let cancelled = false;
    const measure = async () => {
      const connections = [...peerConnectionsRef.current.values()].filter((connection) => connection.connectionState === "connected");
      if (!connections.length) {
        if (!cancelled) setNetworkQuality("checking");
        return;
      }
      const roundTrips: number[] = [];
      await Promise.all(connections.map(async (connection) => {
        try {
          const stats = await connection.getStats();
          stats.forEach((report) => {
            if (report.type === "candidate-pair" && report.state === "succeeded" && report.nominated && typeof report.currentRoundTripTime === "number") {
              roundTrips.push(report.currentRoundTripTime);
            }
          });
        } catch { /* A connection may close while stats are being collected. */ }
      }));
      if (cancelled) return;
      if (!roundTrips.length) {
        setNetworkQuality("checking");
        return;
      }
      const worstRoundTrip = Math.max(...roundTrips);
      setNetworkQuality(worstRoundTrip > 0.35 ? "weak" : worstRoundTrip > 0.18 ? "fair" : "good");
    };
    void measure();
    const interval = window.setInterval(() => void measure(), 4000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [call?.callId, call?.status]);

  const updateCall = useCallback((next: CallState | null) => {
    callRef.current = next;
    setCall(next);
  }, []);

  const cleanup = useCallback(() => {
    const connections = [...peerConnectionsRef.current.values()];
    peerConnectionsRef.current.clear();
    updateCall(null);
    setAddPeopleOpen(false);
    setSelectedContactIds([]);
    connections.forEach((connection) => connection.close());
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current = null;
    setScreenSharing(false);
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    pendingCandidatesRef.current.clear();
    setRemoteStreams({});
    setAudioNeedsInteraction(false);
  }, [updateCall]);

  const iceServers = useCallback(async () => {
    const cached = iceServerCacheRef.current;
    if (cached && cached.expiresAt > Date.now()) return cached.servers;
    if (!iceServerRequestRef.current) {
      iceServerRequestRef.current = getIceServers(AbortSignal.timeout(5000))
        .then(({ ice_servers }) => {
          iceServerCacheRef.current = { servers: ice_servers, expiresAt: Date.now() + 5 * 60_000 };
          return ice_servers;
        })
        .catch(() => {
          // Avoid serial network timeouts for every peer in a group call.
          iceServerCacheRef.current = { servers: FALLBACK_ICE_SERVERS, expiresAt: Date.now() + 30_000 };
          return FALLBACK_ICE_SERVERS;
        })
        .finally(() => { iceServerRequestRef.current = null; });
    }
    return iceServerRequestRef.current;
  }, []);

  const createPeerConnection = useCallback(async (session: CallState, remoteUserId: number) => {
    const existing = peerConnectionsRef.current.get(remoteUserId);
    if (existing) return existing;
    const pc = new RTCPeerConnection({ iceServers: await iceServers() });
    peerConnectionsRef.current.set(remoteUserId, pc);
    localStreamRef.current?.getTracks().forEach((track) => {
      const outgoingTrack = track.kind === "video" ? screenStreamRef.current?.getVideoTracks()[0] ?? track : track;
      pc.addTrack(outgoingTrack, localStreamRef.current!);
    });
    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      const current = callRef.current;
      if (!current || peerConnectionsRef.current.get(remoteUserId) !== pc) return;
      sendCallSignal({
        type: "call.ice",
        call_id: current.callId,
        conversation_id: current.conversationId,
        to_user_id: remoteUserId,
        candidate: event.candidate.toJSON(),
      });
    };
    pc.ontrack = (event) => {
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      setRemoteStreams((current) => current[remoteUserId] === stream ? current : { ...current, [remoteUserId]: stream });
    };
    pc.onconnectionstatechange = () => {
      const current = callRef.current;
      if (!current || peerConnectionsRef.current.get(remoteUserId) !== pc) return;
      if (pc.connectionState === "connected") {
        updateCall({ ...current, status: "active", startedAt: current.startedAt ?? Date.now() });
      } else if (pc.connectionState === "connecting" || pc.connectionState === "disconnected") {
        updateCall({ ...current, status: current.startedAt ? "reconnecting" : "connecting" });
      } else if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        if (current.isGroup) {
          peerConnectionsRef.current.delete(remoteUserId);
          setRemoteStreams((streams) => { const next = { ...streams }; delete next[remoteUserId]; return next; });
        } else cleanup();
        if (pc.connectionState === "failed") toast.error("Call connection failed. For calls across different networks, configure a TURN server in the backend.");
      }
    };
    return pc;
  }, [cleanup, iceServers, updateCall]);

  const flushCandidates = useCallback(async (pc: RTCPeerConnection, remoteUserId: number) => {
    const queued = pendingCandidatesRef.current.get(remoteUserId) ?? [];
    pendingCandidatesRef.current.delete(remoteUserId);
    for (const candidate of queued) await pc.addIceCandidate(candidate);
  }, []);

  const sendOffer = useCallback(async (session: CallState, remoteUserId: number) => {
    try {
      const pc = await createPeerConnection(session, remoteUserId);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      sendCallSignal({
        type: "call.offer",
        call_id: session.callId,
        conversation_id: session.conversationId,
        to_user_id: remoteUserId,
        description: pc.localDescription?.toJSON() ?? offer,
      });
    } catch {
      toast.error("Couldn't start the call");
      cleanup();
    }
  }, [cleanup, createPeerConnection]);

  const handleSignal = useCallback(async (signal: CallSignal) => {
    if (signal.type === "call.group_state" && signal.conversation_id && signal.call_id) {
      if (signal.active && signal.participants) {
        setActiveGroupCall({
          call_id: signal.call_id,
          conversation_id: signal.conversation_id,
          group_name: signal.group_name || "Group call",
          media_type: signal.media_type === "video" ? "video" : "audio",
          caller_id: signal.caller_id ?? signal.from_user_id ?? 0,
          participants: signal.participants,
        });
      } else {
        clearActiveGroupCall(signal.conversation_id, signal.call_id);
      }
      return;
    }
    if (signal.type === "call.incoming") {
      if (!signal.call_id || !signal.conversation_id || !signal.from_user_id) return;
      if (callRef.current) {
        sendCallSignal({ type: "call.reject", call_id: signal.call_id, conversation_id: signal.conversation_id, to_user_id: signal.from_user_id, media_type: signal.media_type, is_group: signal.is_group });
        return;
      }
      // Fetch STUN/TURN config while the recipient is still hearing the ring.
      void iceServers();
      const inviter = {
        id: signal.from_user_id,
        displayName: signal.from_name || "Signal user",
        avatarUrl: signal.from_avatar_url ?? null,
      };
      updateCall({
        callId: signal.call_id,
        conversationId: signal.conversation_id,
        peerId: signal.from_user_id,
        peerName: signal.is_group ? signal.group_name || "Group call" : inviter.displayName,
        inviterName: inviter.displayName,
        peerAvatarUrl: signal.from_avatar_url ?? null,
        mediaType: signal.media_type === "video" ? "video" : "audio",
        direction: "incoming",
        status: "ringing",
        startedAt: null,
        muted: false,
        cameraOff: false,
        peerCameraOff: false,
        isGroup: signal.is_group === true,
        participants: signal.is_group
          ? (signal.participants ?? [{ id: inviter.id, display_name: inviter.displayName, avatar_url: inviter.avatarUrl }])
            .map((participant) => ({ id: participant.id, displayName: participant.display_name, avatarUrl: participant.avatar_url }))
          : [],
        peerCameraOffById: {},
      });
      return;
    }

    if (signal.type === "call.error") {
      toast.error(signal.message || "Call request failed");
      const currentCall = callRef.current;
      if (currentCall?.status === "ringing" || (currentCall?.isGroup && currentCall.status === "connecting")) {
        cleanup();
      }
      return;
    }
    const current = callRef.current;
    if (!current || !signal.call_id) return;
    if (signal.type === "call.upgraded" && signal.call_id === current.callId && !current.isGroup && signal.group_call_id && signal.group_conversation_id && signal.from_user_id) {
      const participants = (signal.participants ?? [
        { id: current.peerId, display_name: signal.from_name || current.peerName, avatar_url: current.peerAvatarUrl },
      ]).map((participant) => ({
        id: participant.id,
        displayName: participant.display_name,
        avatarUrl: participant.avatar_url,
      }));
      const groupSession: CallState = {
        ...current,
        callId: signal.group_call_id,
        conversationId: signal.group_conversation_id,
        peerId: signal.from_user_id,
        peerName: signal.group_name || "Group call",
        inviterName: null,
        peerAvatarUrl: null,
        mediaType: signal.media_type === "video" ? "video" : "audio",
        status: "active",
        startedAt: current.startedAt ?? Date.now(),
        isGroup: true,
        participants,
        peerCameraOff: current.peerCameraOff,
        peerCameraOffById: current.peerCameraOffById,
      };
      updateCall(groupSession);
      return;
    }
    if (signal.call_id !== current.callId) return;

    if (signal.type === "call.reinvite_sent") {
      toast.success("Calling group member to join");
      return;
    }
    if (signal.type === "call.reinvite_failed") {
      toast.error(signal.message || "Could not reach that group member");
      return;
    }
    if (signal.type === "call.invite_result") {
      const delivered = signal.delivered_user_ids?.length ?? 0;
      const offline = signal.offline_user_ids?.length ?? 0;
      if (delivered === 0) toast.info("Your call continues, but the selected people are offline and could not be rung.");
      else if (offline) toast.info(`Ringing ${delivered} member${delivered === 1 ? "" : "s"}; ${offline} offline.`);
      else toast.success(`Ringing ${delivered} member${delivered === 1 ? "" : "s"} to join the call.`);
      return;
    }
    if (current.isGroup && signal.type === "call.rejected") {
      toast.info(`${signal.from_name || "A member"} declined the call`);
      return;
    }

    if (signal.type === "call.camera" && typeof signal.camera_off === "boolean" && signal.from_user_id) {
      updateCall({
        ...current,
        peerCameraOff: signal.camera_off,
        peerCameraOffById: { ...current.peerCameraOffById, [signal.from_user_id]: signal.camera_off },
      });
      return;
    }

    if (current.isGroup && signal.type === "call.participant_joined" && signal.participants) {
      updateCall({
        ...current,
        participants: signal.participants.map((participant) => ({ id: participant.id, displayName: participant.display_name, avatarUrl: participant.avatar_url })),
        status: current.direction === "outgoing" && current.status === "ringing" ? "connecting" : current.status,
      });
      return;
    }

    if (current.isGroup && signal.type === "call.participant_left" && signal.participants) {
      const participants = signal.participants.map((participant) => ({ id: participant.id, displayName: participant.display_name, avatarUrl: participant.avatar_url }));
      const remainingIds = new Set(participants.map((participant) => participant.id));
      for (const [userId, connection] of peerConnectionsRef.current) {
        if (!remainingIds.has(userId)) {
          peerConnectionsRef.current.delete(userId);
          connection.close();
        }
      }
      setRemoteStreams((streams) => Object.fromEntries(Object.entries(streams).filter(([userId]) => remainingIds.has(Number(userId)))));
      updateCall({ ...current, participants });
      return;
    }

    if (current.isGroup && signal.type === "call.rejected") {
      return;
    }

    if (["call.unavailable", "call.rejected", "call.cancelled", "call.ended", "call.peer_offline"].includes(signal.type)) {
      if (signal.type === "call.unavailable" || signal.type === "call.rejected") toast.info(signal.message || `${current.peerName} didn't answer`);
      if (signal.type === "call.peer_offline") toast.info(`${current.peerName} disconnected`);
      cleanup();
      return;
    }

    if (signal.type === "call.accepted" && current.direction === "outgoing" && !current.isGroup) {
      updateCall({ ...current, status: "connecting" });
      await sendOffer({ ...current, status: "connecting" }, current.peerId);
      return;
    }

    const remoteUserId = signal.from_user_id ?? current.peerId;
    const pc = peerConnectionsRef.current.get(remoteUserId);
    if (signal.type === "call.offer" && signal.description && (current.direction === "incoming" && current.status !== "ringing" || current.isGroup && current.status !== "ringing" || current.status === "active" || current.status === "reconnecting")) {
      try {
        const connection = pc ?? await createPeerConnection(current, remoteUserId);
        await connection.setRemoteDescription(signal.description);
        await flushCandidates(connection, remoteUserId);
        const answer = await connection.createAnswer();
        await connection.setLocalDescription(answer);
        sendCallSignal({
          type: "call.answer",
          call_id: current.callId,
          conversation_id: current.conversationId,
          to_user_id: remoteUserId,
          description: connection.localDescription?.toJSON() ?? answer,
        });
      } catch {
        toast.error("Couldn't connect the call");
        cleanup();
      }
      return;
    }

    if (signal.type === "call.answer" && signal.description && pc) {
      try {
        await pc.setRemoteDescription(signal.description);
        await flushCandidates(pc, remoteUserId);
      } catch {
        toast.error("Couldn't connect the call");
        cleanup();
      }
      return;
    }

    if (signal.type === "call.ice" && signal.candidate) {
      const connection = peerConnectionsRef.current.get(remoteUserId);
      if (!connection || !connection.remoteDescription) {
        const queued = pendingCandidatesRef.current.get(remoteUserId) ?? [];
        queued.push(signal.candidate);
        pendingCandidatesRef.current.set(remoteUserId, queued);
      }
      else {
        try { await connection.addIceCandidate(signal.candidate); }
        catch { /* A late candidate can arrive after a call ends. */ }
      }
    }
  }, [cleanup, createPeerConnection, flushCandidates, sendOffer, updateCall, setActiveGroupCall, clearActiveGroupCall, iceServers]);

  useEffect(() => subscribeToCallSignals((signal) => { void handleSignal(signal); }), [handleSignal]);
  useEffect(() => {
    if (!call?.isGroup || !self || call.status === "ringing" || !localStreamRef.current) return;
    const session = call;
    let cancelled = false;
    const connectPeers = async () => {
      for (const peer of session.participants) {
        if (peer.id === self.id || peer.id < self.id || peerConnectionsRef.current.has(peer.id)) continue;
        try {
          const connection = await createPeerConnection(session, peer.id);
          if (cancelled || callRef.current?.callId !== session.callId) return;
          const offer = await connection.createOffer();
          await connection.setLocalDescription(offer);
          sendCallSignal({
            type: "call.offer", call_id: session.callId,
            conversation_id: session.conversationId, to_user_id: peer.id,
            description: connection.localDescription?.toJSON() ?? offer,
          });
        } catch {
          if (!cancelled) toast.error(`Couldn't connect to ${peer.displayName}`);
        }
      }
    };
    void connectPeers();
    return () => { cancelled = true; };
  }, [call?.callId, call?.isGroup, call?.participants, call?.status, createPeerConnection, self]);
  useEffect(() => {
    if (!call || call.status !== "ringing") return;
    if (preferences.data?.calls.ringtone_enabled === false) return;
    const timer = window.setTimeout(() => {
      const current = callRef.current;
      if (!current || current.callId !== call.callId) return;
      sendCallSignal({
        type: current.direction === "outgoing" ? "call.cancel" : "call.reject",
        call_id: current.callId,
        conversation_id: current.conversationId,
      to_user_id: current.peerId,
        media_type: current.mediaType,
        reason: "timeout",
      });
      cleanup();
      if (current.direction === "outgoing") toast.info("No answer");
    }, 30_000);
    return () => window.clearTimeout(timer);
  }, [call, cleanup]);

  // Use Web Audio for a small local ringback/ringtone, so no external
  // sound file or extra dependency is needed. The effect is torn down
  // as soon as ringing ends or the call changes.
  useEffect(() => {
    if (!call || call.status !== "ringing") return;
    const AudioContextClass = window.AudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    let disposed = false;
    const oscillators = new Set<OscillatorNode>();

    const playTone = (frequency: number, delay: number, duration: number) => {
      window.setTimeout(() => {
        if (disposed || context.state === "closed") return;
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillators.add(oscillator);
        oscillator.type = "sine";
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0, context.currentTime);
        gain.gain.linearRampToValueAtTime(0.12, context.currentTime + 0.04);
        gain.gain.setValueAtTime(0.12, context.currentTime + duration - 0.06);
        gain.gain.linearRampToValueAtTime(0, context.currentTime + duration);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start();
        oscillator.stop(context.currentTime + duration);
        oscillator.onended = () => {
          oscillators.delete(oscillator);
          oscillator.disconnect();
          gain.disconnect();
        };
      }, delay);
    };

    const ring = () => {
      if (call.direction === "outgoing") {
        // Familiar dual-tone ringback for the caller.
        playTone(440, 0, 0.45);
        playTone(480, 0, 0.45);
        playTone(440, 650, 0.45);
        playTone(480, 650, 0.45);
      } else {
        // A brighter, three-note cadence makes the recipient's ringtone
        // distinct from the caller's ringback.
        playTone(660, 0, 0.24);
        playTone(880, 300, 0.38);
        playTone(660, 850, 0.24);
        playTone(880, 1150, 0.38);
      }
    };

    void context.resume().catch(() => {});
    ring();
    const interval = window.setInterval(ring, call.direction === "outgoing" ? 3000 : 3000);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      oscillators.forEach((oscillator) => {
        try { oscillator.stop(); } catch { /* Already stopped. */ }
      });
      void context.close().catch(() => {});
    };
  }, [call?.callId, call?.direction, call?.status, preferences.data?.calls.ringtone_enabled]);

  useEffect(() => {
    if (!call?.startedAt) return;
    setClock(Date.now());
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [call?.startedAt]);
  useEffect(() => { setCallMinimized(false); }, [call?.callId]);
  useEffect(() => () => cleanup(), [cleanup]);

  const startCall = useCallback(async (conversationId: number, peerId: number, peerName: string, peerAvatarUrl: string | null = null, mediaType: "audio" | "video" = "audio") => {
    if (callRef.current) { toast.info("You're already in a call"); return; }
    if (!isRealtimeConnected()) {
      toast.error("Reconnecting to calls. Try again in a moment.");
      return;
    }
    const session: CallState = {
      callId: crypto.randomUUID(), conversationId, peerId, peerName, inviterName: null, peerAvatarUrl,
      mediaType, direction: "outgoing", status: "ringing", startedAt: null, muted: false, cameraOff: false, peerCameraOff: false,
      isGroup: false, participants: [], peerCameraOffById: {},
    };
    try {
      void iceServers();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: mediaType === "video" });
      localStreamRef.current = stream;
      updateCall(session);
    if (!sendCallSignal({ type: "call.invite", call_id: session.callId, conversation_id: conversationId, to_user_id: peerId, media_type: mediaType })) {
        cleanup();
        toast.error("Call signaling is unavailable");
      }
    } catch (error) {
      cleanup();
      const message = error instanceof DOMException && error.name === "NotAllowedError"
        ? "Allow microphone access to make a call"
        : mediaType === "video" ? "Couldn't access your camera or microphone" : "Couldn't access your microphone";
      toast.error(message);
    }
  }, [cleanup, iceServers, updateCall]);

  const startGroupCall = useCallback(async (
    conversationId: number,
    groupName: string,
    groupAvatarUrl: string | null,
    participants: Array<{ id: number; displayName: string; avatarUrl: string | null }>,
    mediaType: "audio" | "video",
  ) => {
    if (callRef.current) { toast.info("You're already in a call"); return; }
    if (!isRealtimeConnected()) { toast.error("Reconnecting to calls. Try again in a moment."); return; }
    const invitees = participants.filter((participant) => participant.id !== self?.id);
    if (!invitees.length) { toast.info("There are no other group members to call"); return; }
    if (invitees.length > 8) { toast.error("Group calls currently support up to 9 people"); return; }
    const session: CallState = {
      callId: crypto.randomUUID(), conversationId, peerId: invitees[0].id,
      peerName: groupName, inviterName: null, peerAvatarUrl: groupAvatarUrl, mediaType,
      direction: "outgoing", status: "ringing", startedAt: null,
      muted: false, cameraOff: false, peerCameraOff: false, isGroup: true,
      participants: self ? [{ id: self.id, displayName: self.display_name ?? self.username ?? "You", avatarUrl: self.avatar_url }] : [],
      peerCameraOffById: {},
    };
    try {
      void iceServers();
      localStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true, video: mediaType === "video" });
      updateCall(session);
      if (!sendCallSignal({
        type: "call.invite", call_id: session.callId, conversation_id: conversationId,
        to_user_ids: invitees.map((participant) => participant.id), media_type: mediaType,
      })) {
        cleanup();
        toast.error("Call signaling is unavailable");
      }
    } catch (error) {
      cleanup();
      toast.error(error instanceof DOMException && error.name === "NotAllowedError" ? "Allow camera and microphone access" : "Couldn't access your camera or microphone");
    }
  }, [cleanup, iceServers, self, updateCall]);

  const joinGroupCall = useCallback(async (active: ActiveGroupCall, groupAvatarUrl: string | null) => {
    if (callRef.current) { toast.info("You're already in a call"); return; }
    if (!isRealtimeConnected()) { toast.error("Reconnecting to calls. Try again in a moment."); return; }
    if (active.participants.length >= 9) { toast.error("This group call is full"); return; }
    const others = active.participants.filter((participant) => participant.id !== self?.id);
    if (!others.length) { toast.info("This call has already ended"); return; }
    const session: CallState = {
      callId: active.call_id,
      conversationId: active.conversation_id,
      peerId: active.caller_id || others[0].id,
      peerName: active.group_name,
      inviterName: null,
      peerAvatarUrl: groupAvatarUrl,
      mediaType: active.media_type,
      direction: "incoming",
      status: "connecting",
      startedAt: null,
      muted: false,
      cameraOff: false,
      peerCameraOff: false,
      isGroup: true,
      participants: active.participants.map((participant) => ({ id: participant.id, displayName: participant.display_name, avatarUrl: participant.avatar_url })),
      peerCameraOffById: {},
    };
    try {
      void iceServers();
      localStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true, video: active.media_type === "video" });
      updateCall(session);
      if (!sendCallSignal({
        type: "call.join",
        call_id: active.call_id,
        conversation_id: active.conversation_id,
        to_user_id: active.caller_id || others[0].id,
      })) throw new Error("Call signaling is unavailable");
    } catch (error) {
      cleanup();
      toast.error(error instanceof DOMException && error.name === "NotAllowedError" ? "Allow microphone and camera access to join" : "Couldn't join the call");
    }
  }, [cleanup, iceServers, self, updateCall]);

  const reinviteGroupCall = useCallback((active: ActiveGroupCall, userId: number) => {
    if (!self || !active.participants.some((participant) => participant.id === self.id)) {
      toast.error("Join the call before inviting another member");
      return;
    }
    if (active.participants.some((participant) => participant.id === userId)) {
      toast.info("That member is already in the call");
      return;
    }
    if (!sendCallSignal({
      type: "call.reinvite", call_id: active.call_id,
      conversation_id: active.conversation_id, to_user_id: userId,
      media_type: active.media_type,
      active_participant_ids: active.participants.map((participant) => participant.id),
    })) toast.error("Call signaling is unavailable");
  }, [self]);

  async function openAddPeople() {
    const current = callRef.current;
    if (!current || current.status !== "active") return;
    setAddPeopleOpen(true);
    setLoadingContacts(true);
    setSelectedContactIds([]);
    try {
      if (current.isGroup) {
        setAddPeopleMode("reinvite");
        const conversations = await listConversations();
        const group = conversations.find((item) => item.id === current.conversationId);
        setGroupInviteOptions((group?.participants ?? [])
          .filter((member) => member.id !== self?.id && !current.participants.some((active) => active.id === member.id))
          .map((member) => ({ id: member.id, name: member.display_name ?? member.username ?? member.phone ?? "Signal user", avatarUrl: member.avatar_url })));
      } else {
        setAddPeopleMode("convert");
        setContacts(await listContacts());
      }
    } catch {
      toast.error(current.isGroup ? "Could not load group members" : "Could not load your contacts");
      setAddPeopleOpen(false);
    } finally {
      setLoadingContacts(false);
    }
  }

  async function addPeopleToCall() {
    const current = callRef.current;
    if (!current || current.status !== "active" || !self) return;
    if (!isRealtimeConnected()) { toast.error("Call signaling is unavailable. Reconnect before adding people."); return; }
    if (addPeopleMode === "reinvite" && current.isGroup) {
      const invitees = groupInviteOptions.filter((member) => selectedContactIds.includes(member.id));
      if (!invitees.length) return;
      setAddingPeople(true);
      try {
        const allSent = invitees.every((member) => sendCallSignal({
          type: "call.reinvite", call_id: current.callId,
          conversation_id: current.conversationId, to_user_id: member.id,
          media_type: current.mediaType,
          active_participant_ids: current.participants.map((participant) => participant.id),
        }));
        if (!allSent) throw new Error("Call signaling is unavailable");
        setAddPeopleOpen(false);
        setSelectedContactIds([]);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not invite group members");
      } finally {
        setAddingPeople(false);
      }
      return;
    }
    if (current.isGroup) return;
    const selectedContacts = contacts.map((entry) => entry.contact).filter((contact) =>
      selectedContactIds.includes(contact.id) && contact.id !== self.id && contact.id !== current.peerId,
    );
    if (!selectedContacts.length) return;
    if (selectedContacts.length > 7) { toast.error("Group calls support up to 9 people"); return; }
    setAddingPeople(true);
    try {
      const memberNames = [
        self.display_name ?? self.username ?? "You",
        current.peerName,
        ...selectedContacts.map((contact) => contact.display_name ?? contact.username ?? contact.phone ?? "Signal user"),
      ];
      const groupName = memberNames.join(", ").slice(0, 128);
      const conversation = await createGroup({
        type: "group", name: groupName,
        member_ids: [current.peerId, ...selectedContacts.map((contact) => contact.id)],
        admin_ids: [current.peerId],
      });
      const groupCallId = crypto.randomUUID();
      const durationSeconds = current.startedAt ? Math.floor((Date.now() - current.startedAt) / 1000) : 0;
      if (!sendCallSignal({
        type: "call.upgrade", call_id: current.callId,
        conversation_id: current.conversationId, to_user_id: current.peerId,
        group_call_id: groupCallId, group_conversation_id: conversation.id,
        invitee_user_ids: selectedContacts.map((contact) => contact.id),
        duration_seconds: durationSeconds,
      })) throw new Error("Call signaling is unavailable");

      const existingPeer = current.participants?.find((participant) => participant.id === current.peerId);
      updateCall({
        ...current, callId: groupCallId, conversationId: conversation.id,
        peerName: groupName, peerAvatarUrl: conversation.avatar_url,
        status: "active", startedAt: current.startedAt ?? Date.now(),
        isGroup: true,
        participants: [
          { id: self.id, displayName: self.display_name ?? self.username ?? "You", avatarUrl: self.avatar_url },
          ...(existingPeer ? [existingPeer] : [{ id: current.peerId, displayName: current.peerName, avatarUrl: current.peerAvatarUrl }]),
        ],
        peerCameraOff: current.peerCameraOff,
        peerCameraOffById: current.peerCameraOffById,
      });
      setAddPeopleOpen(false);
      setSelectedContactIds([]);
      setCallMinimized(false);
      void getQueryClient().invalidateQueries({ queryKey: queryKeys.conversations });
      toast.success("Group created. Your call is moving to the new group.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create the group call");
    } finally {
      setAddingPeople(false);
    }
  }

  async function acceptCall() {
    const current = callRef.current;
    if (!current || current.direction !== "incoming") return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: current.mediaType === "video" });
      localStreamRef.current = stream;
      if (!current.isGroup) await createPeerConnection(current, current.peerId);
      if (!sendCallSignal({ type: "call.accept", call_id: current.callId, conversation_id: current.conversationId, to_user_id: current.peerId })) {
        throw new Error("Signaling is disconnected");
      }
      updateCall({ ...current, status: "connecting" });
    } catch (error) {
      sendCallSignal({ type: "call.reject", call_id: current.callId, conversation_id: current.conversationId, to_user_id: current.peerId, media_type: current.mediaType });
      cleanup();
      toast.error(error instanceof DOMException && error.name === "NotAllowedError" ? "Allow microphone access to answer" : "Couldn't answer the call");
    }
  }

  function declineOrEnd() {
    const current = callRef.current;
    if (!current) return;
    const terminationType = current.direction === "incoming" && current.status === "ringing"
      ? "call.reject"
      : current.status === "ringing"
        ? "call.cancel"
        : current.isGroup ? "call.leave" : "call.end";
    const recipientId = current.isGroup
      ? current.participants.find((participant) => participant.id !== self?.id)?.id ?? current.peerId
      : current.peerId;
    sendCallSignal({
      type: terminationType,
      call_id: current.callId,
      conversation_id: current.conversationId,
      to_user_id: recipientId,
      media_type: current.mediaType,
      ...(current.status === "active" && current.startedAt ? { duration_seconds: Math.floor((Date.now() - current.startedAt) / 1000) } : {}),
    });
    cleanup();
  }

  function toggleMute() {
    const current = callRef.current;
    if (!current) return;
    const muted = !current.muted;
    localStreamRef.current?.getAudioTracks().forEach((track) => { track.enabled = !muted; });
    updateCall({ ...current, muted });
  }

  function toggleCamera() {
    const current = callRef.current;
    if (!current || current.mediaType !== "video") return;
    if (screenStreamRef.current) { toast.info("Stop screen sharing before changing your camera."); return; }
    const track = localStreamRef.current?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    const cameraOff = !track.enabled;
    updateCall({ ...current, cameraOff });
    const recipients = current.isGroup
      ? current.participants.filter((participant) => participant.id !== self?.id).map((participant) => participant.id)
      : [current.peerId];
    recipients.forEach((peerId) => sendCallSignal({ type: "call.camera", call_id: current.callId, conversation_id: current.conversationId, to_user_id: peerId, camera_off: cameraOff }));
  }

  async function enableCallAudio() {
    const results = await Promise.allSettled(
      [...remoteAudioElementsRef.current.values()].map((audio) => audio.play()),
    );
    setAudioNeedsInteraction(results.some((result) => result.status === "rejected"));
  }

  async function togglePictureInPicture() {
    const video = document.querySelector<HTMLVideoElement>("video[data-call-remote-video]");
    if (!video) {
      toast.info("Picture-in-picture is available once the other person’s video appears.");
      return;
    }
    if (!document.pictureInPictureEnabled || !video.requestPictureInPicture) {
      toast.error("Picture-in-picture is not supported by this browser.");
      return;
    }
    try {
      if (document.pictureInPictureElement === video) await document.exitPictureInPicture();
      else await video.requestPictureInPicture();
    } catch {
      toast.error("Could not open picture-in-picture. Try again after the video connects.");
    }
  }

  useEffect(() => {
    if (localVideoRef.current && localStreamRef.current && call?.mediaType === "video") {
      localVideoRef.current.srcObject = screenStreamRef.current ?? localStreamRef.current;
      void localVideoRef.current.play().catch(() => {});
    }
    return () => { if (localVideoRef.current) localVideoRef.current.srcObject = null; };
  }, [call?.callId, call?.mediaType, call?.status, screenSharing]);

  const seconds = call?.startedAt ? Math.max(0, Math.floor((clock - call.startedAt) / 1000)) : 0;
  const duration = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  const remoteParticipants = call
    ? call.isGroup
      ? call.participants.filter((participant) => participant.id !== self?.id)
      : [{ id: call.peerId, displayName: call.peerName, avatarUrl: call.peerAvatarUrl }]
    : [];

  return (
    <VoiceCallContext.Provider value={{ call, startCall, startGroupCall, joinGroupCall, reinviteGroupCall }}>
      {children}
      {Object.entries(remoteStreams).map(([userId, stream]) => <RemoteAudio
        key={`audio-${userId}`}
        userId={Number(userId)}
        stream={stream}
        audioElements={remoteAudioElementsRef.current}
        onPlaybackBlocked={setAudioNeedsInteraction}
      />)}
      {call?.mediaType === "video" ? callMinimized ? <MiniCallCard call={call} participants={remoteParticipants} streams={remoteStreams} duration={duration} networkQuality={networkQuality} self={self} onRestore={() => setCallMinimized(false)} onMute={toggleMute} onCamera={toggleCamera} onScreenShare={() => void toggleScreenShare()} isScreenSharing={screenSharing} onAddPeople={() => void openAddPeople()} onEnd={declineOrEnd} onAccept={() => void acceptCall()} onPictureInPicture={() => void togglePictureInPicture()} /> : <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black p-3 sm:p-6" role="presentation">
        <section role="dialog" aria-modal="true" aria-label="Video call" className="relative h-full max-h-[min(82vh,900px)] w-full max-w-5xl overflow-hidden rounded-3xl bg-neutral-950 text-white shadow-2xl">
          <div className="absolute inset-0 grid gap-3 p-3 sm:p-5" style={{ gridTemplateColumns: `repeat(${Math.max(1, Math.ceil(Math.sqrt(remoteParticipants.length || 1)))}, minmax(0, 1fr))` }}>
            {remoteParticipants.map((participant) => {
              const stream = remoteStreams[participant.id];
              const cameraOff = call.isGroup ? Boolean(call.peerCameraOffById[participant.id]) : call.peerCameraOff;
              return <div key={participant.id} className="relative flex min-h-0 items-center justify-center overflow-hidden rounded-2xl bg-neutral-900">
                <RemoteVideo stream={stream} name={participant.displayName} cameraOff={cameraOff} avatarUrl={participant.avatarUrl} />
                <span className="absolute bottom-3 left-3 rounded-full bg-black/45 px-3 py-1 text-sm">{participant.displayName}</span>
              </div>;
            })}
            {remoteParticipants.length === 0 ? <div className="flex min-h-0 flex-col items-center justify-center rounded-2xl bg-neutral-900"><Avatar subject={{ avatar_url: call.peerAvatarUrl, display_name: call.peerName }} size={112} showOnline={false} /><p className="mt-4 text-sm text-white/75">Waiting for group members…</p></div> : null}
          </div>
          {call.direction === "incoming" && call.status === "ringing" ? null : <div className="absolute bottom-24 right-5 z-10 flex aspect-video w-36 items-center justify-center overflow-hidden rounded-2xl border border-white/30 bg-neutral-900 shadow-lg sm:w-52">
            {call.cameraOff && !screenSharing ? <Avatar subject={{ avatar_url: self?.avatar_url ?? null, display_name: self?.display_name ?? self?.username ?? "You" }} size={76} showOnline={false} /> : <video ref={localVideoRef} autoPlay muted playsInline className="h-full w-full object-cover" />}
            <span className="absolute bottom-2 left-2 rounded-full bg-black/45 px-2 py-0.5 text-xs">{screenSharing ? "Your screen" : "You"}</span>
          </div>}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/35 via-transparent to-black/45" />
          <div className="absolute left-5 top-5 z-10"><h2 className="text-xl font-semibold">{call.peerName}</h2><p aria-live="polite" className="text-sm text-white/80">{callStatusText(call, duration)}</p><ConnectionQuality quality={networkQuality} /></div>
          <div className="absolute right-5 top-5 z-20 flex gap-2">{call.status === "active" ? <button type="button" onClick={() => void openAddPeople()} aria-label={call.isGroup ? "Invite a group member to the call" : "Add people to call"} title={call.isGroup ? "Invite a group member" : "Add people"} className="rounded-xl bg-white/15 p-2.5 text-white transition hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"><UserPlus size={19} /></button> : null}<button type="button" onClick={() => void togglePictureInPicture()} aria-label="Open video in picture-in-picture" title="Picture-in-picture" className="rounded-xl bg-white/15 p-2.5 text-white transition hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"><PictureInPicture2 size={19} /></button><button type="button" onClick={() => setCallMinimized(true)} aria-label="Minimize call and return to chat" title="Minimize call" className="rounded-xl bg-white/15 p-2.5 text-white transition hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"><Minimize2 size={19} /></button></div>
          {audioNeedsInteraction ? <button onClick={() => void enableCallAudio()} className="absolute left-1/2 top-5 z-20 -translate-x-1/2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-black shadow-lg hover:bg-white/90">Tap to enable audio</button> : null}
          <div className="absolute bottom-6 left-1/2 z-20 flex -translate-x-1/2 items-center gap-4 rounded-full bg-black/45 px-5 py-3 backdrop-blur-md">
            {call.direction === "incoming" && call.status === "ringing" ? <><button onClick={declineOrEnd} aria-label="Decline call" className="flex h-14 w-14 items-center justify-center rounded-full bg-red-600 hover:bg-red-700"><PhoneOff size={22} /></button><button onClick={() => void acceptCall()} aria-label="Answer video call" className="flex h-14 w-14 items-center justify-center rounded-full bg-green-600 hover:bg-green-700"><Video size={22} /></button></> : <><button onClick={toggleMute} aria-label={call.muted ? "Unmute microphone" : "Mute microphone"} className="flex h-12 w-12 items-center justify-center rounded-full bg-white/15 hover:bg-white/25">{call.muted ? <MicOff size={21} /> : <Mic size={21} />}</button><button onClick={() => void toggleScreenShare()} aria-label={screenSharing ? "Stop screen sharing" : "Share screen"} title={screenSharing ? "Stop screen sharing" : "Share screen"} className={`flex h-12 w-12 items-center justify-center rounded-full ${screenSharing ? "bg-[var(--color-accent)]" : "bg-white/15 hover:bg-white/25"}`}>{screenSharing ? <MonitorOff size={21} /> : <MonitorUp size={21} />}</button><button onClick={toggleCamera} aria-label={call.cameraOff ? "Turn camera on" : "Turn camera off"} className="flex h-12 w-12 items-center justify-center rounded-full bg-white/15 hover:bg-white/25">{call.cameraOff ? <CameraOff size={21} /> : <Camera size={21} />}</button><button onClick={declineOrEnd} aria-label="Leave call" className="flex h-14 w-14 items-center justify-center rounded-full bg-red-600 hover:bg-red-700"><PhoneOff size={22} /></button></>}
          </div>
        </section>
      </div> : call ? callMinimized ? <MiniCallCard call={call} participants={remoteParticipants} streams={remoteStreams} duration={duration} networkQuality={networkQuality} self={self} onRestore={() => setCallMinimized(false)} onMute={toggleMute} onCamera={toggleCamera} onScreenShare={() => void toggleScreenShare()} isScreenSharing={screenSharing} onAddPeople={() => void openAddPeople()} onEnd={declineOrEnd} onAccept={() => void acceptCall()} onPictureInPicture={() => void togglePictureInPicture()} /> : <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm" role="presentation">
        <section role="dialog" aria-modal="true" aria-label="Voice call" className="w-full max-w-sm rounded-3xl border p-7 text-center shadow-2xl" style={{ backgroundColor: "var(--color-bg-primary)", borderColor: "var(--color-border-subtle)" }}>
          {call.isGroup ? <div className="mx-auto mb-4 flex -space-x-3 justify-center">{remoteParticipants.slice(0, 4).map((participant) => <Avatar key={participant.id} subject={{ avatar_url: participant.avatarUrl, display_name: participant.displayName }} size={52} showOnline={false} />)}</div> : <div className="mx-auto mb-4 flex h-24 w-24 items-center justify-center rounded-full ring-4 ring-[var(--color-bg-tertiary)]" style={{ boxShadow: call.status === "active" ? "0 0 0 6px rgb(22 163 74 / 15%)" : undefined }}><Avatar subject={{ avatar_url: call.peerAvatarUrl, display_name: call.peerName }} size={88} showOnline={false} /></div>}
          <div className="flex items-start justify-center gap-3"><div><h2 className="text-xl font-semibold text-[var(--color-fg-primary)]">{call.peerName}</h2>
          <p aria-live="polite" className="mt-1 text-sm text-[var(--color-fg-secondary)]">{callStatusText(call, duration)}</p><ConnectionQuality quality={networkQuality} /></div><button type="button" onClick={() => setCallMinimized(true)} aria-label="Minimize call and return to chat" title="Minimize call" className="rounded-lg p-2 text-[var(--color-fg-secondary)] transition hover:bg-[var(--color-bg-tertiary)]"><Minimize2 size={18} /></button></div>
          {call.isGroup && remoteParticipants.length ? <div className="mt-4 flex flex-wrap justify-center gap-2">{remoteParticipants.map((participant) => <span key={participant.id} className="rounded-full bg-[var(--color-bg-tertiary)] px-3 py-1 text-xs text-[var(--color-fg-secondary)]">{participant.displayName}</span>)}</div> : null}
          {audioNeedsInteraction ? <button onClick={() => void enableCallAudio()} className="mt-5 rounded-full bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white">Tap to enable audio</button> : null}
          <div className="mt-8 flex items-center justify-center gap-5">
            {call.direction === "incoming" && call.status === "ringing" ? <><button onClick={declineOrEnd} aria-label="Decline call" className="flex h-14 w-14 items-center justify-center rounded-full bg-red-600 text-white hover:bg-red-700"><PhoneOff size={22} /></button><button onClick={() => void acceptCall()} aria-label="Answer call" className="flex h-14 w-14 items-center justify-center rounded-full bg-green-600 text-white hover:bg-green-700"><Phone size={22} /></button></> : <>{call.status === "active" ? <button onClick={() => void openAddPeople()} aria-label={call.isGroup ? "Invite a group member to the call" : "Add people to call"} title={call.isGroup ? "Invite a group member" : "Add people"} className="flex h-12 w-12 items-center justify-center rounded-full text-[var(--color-fg-primary)] hover:bg-[var(--color-bg-tertiary)]"><UserPlus size={21} /></button> : null}<button onClick={toggleMute} aria-label={call.muted ? "Unmute microphone" : "Mute microphone"} className="flex h-12 w-12 items-center justify-center rounded-full text-[var(--color-fg-primary)] hover:bg-[var(--color-bg-tertiary)]">{call.muted ? <MicOff size={21} /> : <Mic size={21} />}</button><button onClick={declineOrEnd} aria-label="Leave call" className="flex h-14 w-14 items-center justify-center rounded-full bg-red-600 text-white hover:bg-red-700"><PhoneOff size={22} /></button></>}
          </div>
        </section>
      </div> : null}
      {addPeopleOpen ? <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setAddPeopleOpen(false); }}>
        <section role="dialog" aria-modal="true" aria-labelledby="add-call-people-title" className="w-full max-w-md rounded-2xl border p-5 shadow-2xl" style={{ backgroundColor: "var(--color-bg-primary)", borderColor: "var(--color-border-subtle)" }}>
          <div className="flex items-center justify-between"><div><h2 id="add-call-people-title" className="text-lg font-semibold text-[var(--color-fg-primary)]">{addPeopleMode === "reinvite" ? "Invite people to the call" : "Add people to this call"}</h2><p className="mt-1 text-sm text-[var(--color-fg-secondary)]">{addPeopleMode === "reinvite" ? "Call a group member who has not joined yet." : "This will create a group chat and move your call there."}</p></div><button type="button" onClick={() => setAddPeopleOpen(false)} aria-label="Close" className="rounded-lg p-2 text-[var(--color-fg-secondary)] hover:bg-[var(--color-bg-tertiary)]"><X size={18} /></button></div>
          <div className="mt-4 max-h-72 overflow-y-auto">
            {loadingContacts ? <p className="py-8 text-center text-sm text-[var(--color-fg-secondary)]">Loading people…</p> : addPeopleMode === "reinvite" ? groupInviteOptions.length === 0 ? <p className="py-8 text-center text-sm text-[var(--color-fg-secondary)]">Everyone in this group is already on the call.</p> : groupInviteOptions.map((member) => {
              const selected = selectedContactIds.includes(member.id);
              const maxSelected = Math.max(0, 9 - (call?.participants.length ?? 1));
              return <label key={member.id} className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-[var(--color-bg-tertiary)]">
                <input type="checkbox" checked={selected} disabled={!selected && selectedContactIds.length >= maxSelected} onChange={() => setSelectedContactIds((ids) => selected ? ids.filter((id) => id !== member.id) : [...ids, member.id])} className="h-4 w-4 accent-[var(--color-accent)]" />
                <Avatar subject={{ avatar_url: member.avatarUrl, display_name: member.name }} size={38} showOnline={false} />
                <span className="min-w-0 flex-1 truncate text-sm text-[var(--color-fg-primary)]">{member.name}</span>
              </label>;
            }) : contacts.filter((entry) => entry.contact.id !== self?.id && entry.contact.id !== call?.peerId).length === 0 ? <p className="py-8 text-center text-sm text-[var(--color-fg-secondary)]">No contacts available to add.</p> : contacts.filter((entry) => entry.contact.id !== self?.id && entry.contact.id !== call?.peerId).map(({ contact }) => {
              const selected = selectedContactIds.includes(contact.id);
              const name = contact.display_name ?? contact.username ?? contact.phone ?? "Signal user";
              return <label key={contact.id} className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-[var(--color-bg-tertiary)]">
                <input type="checkbox" checked={selected} disabled={!selected && selectedContactIds.length >= 7} onChange={() => setSelectedContactIds((ids) => selected ? ids.filter((id) => id !== contact.id) : [...ids, contact.id])} className="h-4 w-4 accent-[var(--color-accent)]" />
                <Avatar subject={{ avatar_url: contact.avatar_url, display_name: name }} size={38} showOnline={false} />
                <span className="min-w-0 flex-1 truncate text-sm text-[var(--color-fg-primary)]">{name}</span>
              </label>;
            })}
          </div>
          <p className="mt-2 text-xs text-[var(--color-fg-secondary)]">{selectedContactIds.length} selected{addPeopleMode === "convert" ? " · 9 people maximum, including you and your current caller." : ""}</p>
          <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setAddPeopleOpen(false)} className="rounded-lg px-4 py-2 text-sm text-[var(--color-fg-secondary)] hover:bg-[var(--color-bg-tertiary)]">Cancel</button><button type="button" disabled={addingPeople || loadingContacts || selectedContactIds.length === 0} onClick={() => void addPeopleToCall()} className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{addingPeople ? (addPeopleMode === "reinvite" ? "Calling…" : "Creating group…") : (addPeopleMode === "reinvite" ? "Call selected members" : "Create group call")}</button></div>
        </section>
      </div> : null}
    </VoiceCallContext.Provider>
  );
}
