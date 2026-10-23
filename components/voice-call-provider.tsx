"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Camera, CameraOff, Maximize2, Mic, MicOff, Minimize2, Phone, PhoneOff, Video } from "lucide-react";
import { toast } from "sonner";
import { Avatar } from "@/components/avatar";
import { useAuthStore } from "@/store/auth";
import { useRealtimeStore, type ActiveGroupCall } from "@/store/realtime";
import { getIceServers, type IceServer } from "@/lib/api";
import { isRealtimeConnected, sendCallSignal, subscribeToCallSignals, type CallSignal } from "@/lib/realtime";

type CallState = {
  callId: string;
  conversationId: number;
  peerId: number;
  peerName: string;
  peerAvatarUrl: string | null;
  mediaType: "audio" | "video";
  direction: "incoming" | "outgoing";
  status: "ringing" | "connecting" | "active";
  startedAt: number | null;
  muted: boolean;
  cameraOff: boolean;
  peerCameraOff: boolean;
  isGroup: boolean;
  participants: Array<{ id: number; displayName: string; avatarUrl: string | null }>;
  peerCameraOffById: Record<number, boolean>;
};

type MiniCallCardProps = {
  call: CallState;
  participants: CallState["participants"];
  streams: Record<number, MediaStream>;
  duration: string;
  self: { display_name: string | null; username: string | null; avatar_url: string | null } | null;
  onRestore: () => void;
  onMute: () => void;
  onCamera: () => void;
  onEnd: () => void;
  onAccept: () => void;
};

function MiniCallCard({ call, participants, streams, duration, self, onRestore, onMute, onCamera, onEnd, onAccept }: MiniCallCardProps) {
  const firstParticipant = participants[0];
  const ringing = call.direction === "incoming" && call.status === "ringing";
  const isVideo = call.mediaType === "video";
  return <section aria-label={`${isVideo ? "Video" : "Voice"} call, minimized`} className="fixed bottom-24 right-4 z-[100] w-[min(340px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-primary)] text-[var(--color-fg-primary)] shadow-2xl">
    {isVideo ? <div className="relative h-40 bg-neutral-950">
      {firstParticipant ? <RemoteVideo stream={streams[firstParticipant.id]} name={firstParticipant.displayName} cameraOff={call.isGroup ? Boolean(call.peerCameraOffById[firstParticipant.id]) : call.peerCameraOff} avatarUrl={firstParticipant.avatarUrl} /> : <div className="flex h-full items-center justify-center"><Avatar subject={{ avatar_url: call.peerAvatarUrl, display_name: call.peerName }} size={80} showOnline={false} /></div>}
      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between bg-gradient-to-t from-black/75 to-transparent p-3 text-white">
        <div className="min-w-0"><p className="truncate text-sm font-semibold">{call.peerName}</p><p className="text-xs text-white/75">{call.status === "active" ? duration : ringing ? "Incoming video call" : "Connecting…"}</p></div>
        <button type="button" onClick={onRestore} aria-label="Restore full-screen call" title="Return to call" className="rounded-lg bg-white/15 p-2 transition hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"><Maximize2 size={17} /></button>
      </div>
    </div> : <div className="flex items-center gap-3 p-3">
      {call.isGroup ? <div className="flex -space-x-3">{participants.slice(0, 3).map((participant) => <Avatar key={participant.id} subject={{ avatar_url: participant.avatarUrl, display_name: participant.displayName }} size={42} showOnline={false} />)}</div> : <Avatar subject={{ avatar_url: call.peerAvatarUrl, display_name: call.peerName }} size={44} showOnline={false} />}
      <button type="button" onClick={onRestore} className="min-w-0 flex-1 text-left" aria-label="Restore full-screen call"><span className="block truncate text-sm font-semibold">{call.peerName}</span><span className="block text-xs text-[var(--color-fg-secondary)]">{call.status === "active" ? duration : ringing ? "Incoming voice call" : "Connecting…"}</span></button>
      <button type="button" onClick={onRestore} aria-label="Restore full-screen call" title="Return to call" className="rounded-lg p-2 text-[var(--color-fg-secondary)] transition hover:bg-[var(--color-bg-tertiary)]"><Maximize2 size={17} /></button>
    </div>}
    <div className="flex items-center justify-center gap-3 border-t border-[var(--color-border-subtle)] px-3 py-2.5">
      {ringing ? <>
        <button type="button" onClick={onEnd} aria-label="Decline call" className="flex h-10 w-10 items-center justify-center rounded-full bg-red-600 text-white hover:bg-red-700"><PhoneOff size={18} /></button>
        <button type="button" onClick={onAccept} aria-label={`Answer ${isVideo ? "video" : "voice"} call`} className="flex h-10 w-10 items-center justify-center rounded-full bg-green-600 text-white hover:bg-green-700">{isVideo ? <Video size={18} /> : <Phone size={18} />}</button>
      </> : <>
        <button type="button" onClick={onMute} aria-label={call.muted ? "Unmute microphone" : "Mute microphone"} title={call.muted ? "Unmute" : "Mute"} className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--color-bg-tertiary)] hover:brightness-95">{call.muted ? <MicOff size={18} /> : <Mic size={18} />}</button>
        {isVideo ? <button type="button" onClick={onCamera} aria-label={call.cameraOff ? "Turn camera on" : "Turn camera off"} title={call.cameraOff ? "Turn camera on" : "Turn camera off"} className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--color-bg-tertiary)] hover:brightness-95">{call.cameraOff ? <CameraOff size={18} /> : <Camera size={18} />}</button> : null}
        <button type="button" onClick={onEnd} aria-label="End call" className="flex h-10 w-10 items-center justify-center rounded-full bg-red-600 text-white hover:bg-red-700"><PhoneOff size={18} /></button>
      </>}
    </div>
    {self ? <span className="sr-only">Signed in as {self.display_name ?? self.username ?? "you"}</span> : null}
  </section>;
}

type VoiceCallContextValue = {
  call: CallState | null;
  startCall: (conversationId: number, peerId: number, peerName: string, peerAvatarUrl?: string | null, mediaType?: "audio" | "video") => Promise<void>;
  startGroupCall: (conversationId: number, groupName: string, groupAvatarUrl: string | null, participants: Array<{ id: number; displayName: string; avatarUrl: string | null }>, mediaType: "audio" | "video") => Promise<void>;
  joinGroupCall: (active: ActiveGroupCall, groupAvatarUrl: string | null) => Promise<void>;
};

const VoiceCallContext = createContext<VoiceCallContextValue | null>(null);
const FALLBACK_ICE_SERVERS: IceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

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
    ? <video ref={videoRef} autoPlay playsInline className="h-full w-full object-cover" />
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
  const setActiveGroupCall = useRealtimeStore((state) => state.setActiveGroupCall);
  const clearActiveGroupCall = useRealtimeStore((state) => state.clearActiveGroupCall);
  const [call, setCall] = useState<CallState | null>(null);
  const [callMinimized, setCallMinimized] = useState(false);
  const [audioNeedsInteraction, setAudioNeedsInteraction] = useState(false);
  const [remoteStreams, setRemoteStreams] = useState<Record<number, MediaStream>>({});
  const [clock, setClock] = useState(0);

  useEffect(() => {
    setClock(Date.now());
  }, []);
  const callRef = useRef<CallState | null>(null);
  const peerConnectionsRef = useRef(new Map<number, RTCPeerConnection>());
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioElementsRef = useRef(new Map<number, HTMLAudioElement>());
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const pendingCandidatesRef = useRef(new Map<number, RTCIceCandidateInit[]>());
  const iceServerCacheRef = useRef<{ servers: IceServer[]; expiresAt: number } | null>(null);
  const iceServerRequestRef = useRef<Promise<IceServer[]> | null>(null);

  const updateCall = useCallback((next: CallState | null) => {
    callRef.current = next;
    setCall(next);
  }, []);

  const cleanup = useCallback(() => {
    const connections = [...peerConnectionsRef.current.values()];
    peerConnectionsRef.current.clear();
    updateCall(null);
    connections.forEach((connection) => connection.close());
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
    localStreamRef.current?.getTracks().forEach((track) => pc.addTrack(track, localStreamRef.current!));
    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      sendCallSignal({
        type: "call.ice",
        call_id: session.callId,
        conversation_id: session.conversationId,
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
      if (!current || current.callId !== session.callId) return;
      if (pc.connectionState === "connected") {
        updateCall({ ...current, status: "active", startedAt: current.startedAt ?? Date.now() });
      } else if (pc.connectionState === "disconnected") {
        updateCall({ ...current, status: "connecting" });
      } else if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        if (session.isGroup) {
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
        peerAvatarUrl: signal.from_avatar_url ?? null,
        mediaType: signal.media_type === "video" ? "video" : "audio",
        direction: "incoming",
        status: "ringing",
        startedAt: null,
        muted: false,
        cameraOff: false,
        peerCameraOff: false,
        isGroup: signal.is_group === true,
        participants: signal.is_group ? [inviter] : [],
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
    if (!current || !signal.call_id || signal.call_id !== current.callId) return;

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
    if (signal.type === "call.offer" && signal.description && (current.direction === "incoming" && current.status !== "ringing" || current.isGroup && current.status !== "ringing")) {
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
  }, [call?.callId, call?.direction, call?.status]);

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
      callId: crypto.randomUUID(), conversationId, peerId, peerName, peerAvatarUrl,
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
      peerName: groupName, peerAvatarUrl: groupAvatarUrl, mediaType,
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
      peerAvatarUrl: groupAvatarUrl,
      mediaType: active.media_type,
      direction: "incoming",
      status: "connecting",
      startedAt: Date.now(),
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

  useEffect(() => {
    if (localVideoRef.current && localStreamRef.current && call?.mediaType === "video") {
      localVideoRef.current.srcObject = localStreamRef.current;
      void localVideoRef.current.play().catch(() => {});
    }
    return () => { if (localVideoRef.current) localVideoRef.current.srcObject = null; };
  }, [call?.callId, call?.mediaType, call?.status]);

  const seconds = call?.startedAt ? Math.max(0, Math.floor((clock - call.startedAt) / 1000)) : 0;
  const duration = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  const remoteParticipants = call
    ? call.isGroup
      ? call.participants.filter((participant) => participant.id !== self?.id)
      : [{ id: call.peerId, displayName: call.peerName, avatarUrl: call.peerAvatarUrl }]
    : [];

  return (
    <VoiceCallContext.Provider value={{ call, startCall, startGroupCall, joinGroupCall }}>
      {children}
      {Object.entries(remoteStreams).map(([userId, stream]) => <RemoteAudio
        key={`audio-${userId}`}
        userId={Number(userId)}
        stream={stream}
        audioElements={remoteAudioElementsRef.current}
        onPlaybackBlocked={setAudioNeedsInteraction}
      />)}
      {call?.mediaType === "video" ? callMinimized ? <MiniCallCard call={call} participants={remoteParticipants} streams={remoteStreams} duration={duration} self={self} onRestore={() => setCallMinimized(false)} onMute={toggleMute} onCamera={toggleCamera} onEnd={declineOrEnd} onAccept={() => void acceptCall()} /> : <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black p-3 sm:p-6" role="presentation">
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
            {call.cameraOff ? <Avatar subject={{ avatar_url: self?.avatar_url ?? null, display_name: self?.display_name ?? self?.username ?? "You" }} size={76} showOnline={false} /> : <video ref={localVideoRef} autoPlay muted playsInline className="h-full w-full object-cover" />}
            <span className="absolute bottom-2 left-2 rounded-full bg-black/45 px-2 py-0.5 text-xs">You</span>
          </div>}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/35 via-transparent to-black/45" />
          <div className="absolute left-5 top-5 z-10"><h2 className="text-xl font-semibold">{call.peerName}</h2><p className="text-sm text-white/80">{call.status === "active" ? duration : call.direction === "incoming" ? `Incoming ${call.isGroup ? "group " : ""}video call` : call.status === "connecting" ? "Connecting…" : "Calling…"}</p></div>
          <button type="button" onClick={() => setCallMinimized(true)} aria-label="Minimize call and return to chat" title="Minimize call" className="absolute right-5 top-5 z-20 rounded-xl bg-white/15 p-2.5 text-white transition hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"><Minimize2 size={19} /></button>
          {audioNeedsInteraction ? <button onClick={() => void enableCallAudio()} className="absolute left-1/2 top-5 z-20 -translate-x-1/2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-black shadow-lg hover:bg-white/90">Tap to enable audio</button> : null}
          <div className="absolute bottom-6 left-1/2 z-20 flex -translate-x-1/2 items-center gap-4 rounded-full bg-black/45 px-5 py-3 backdrop-blur-md">
            {call.direction === "incoming" && call.status === "ringing" ? <><button onClick={declineOrEnd} aria-label="Decline call" className="flex h-14 w-14 items-center justify-center rounded-full bg-red-600 hover:bg-red-700"><PhoneOff size={22} /></button><button onClick={() => void acceptCall()} aria-label="Answer video call" className="flex h-14 w-14 items-center justify-center rounded-full bg-green-600 hover:bg-green-700"><Video size={22} /></button></> : <><button onClick={toggleMute} aria-label={call.muted ? "Unmute microphone" : "Mute microphone"} className="flex h-12 w-12 items-center justify-center rounded-full bg-white/15 hover:bg-white/25">{call.muted ? <MicOff size={21} /> : <Mic size={21} />}</button><button onClick={toggleCamera} aria-label={call.cameraOff ? "Turn camera on" : "Turn camera off"} className="flex h-12 w-12 items-center justify-center rounded-full bg-white/15 hover:bg-white/25">{call.cameraOff ? <CameraOff size={21} /> : <Camera size={21} />}</button><button onClick={declineOrEnd} aria-label="Leave call" className="flex h-14 w-14 items-center justify-center rounded-full bg-red-600 hover:bg-red-700"><PhoneOff size={22} /></button></>}
          </div>
        </section>
      </div> : call ? callMinimized ? <MiniCallCard call={call} participants={remoteParticipants} streams={remoteStreams} duration={duration} self={self} onRestore={() => setCallMinimized(false)} onMute={toggleMute} onCamera={toggleCamera} onEnd={declineOrEnd} onAccept={() => void acceptCall()} /> : <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm" role="presentation">
        <section role="dialog" aria-modal="true" aria-label="Voice call" className="w-full max-w-sm rounded-3xl border p-7 text-center shadow-2xl" style={{ backgroundColor: "var(--color-bg-primary)", borderColor: "var(--color-border-subtle)" }}>
          {call.isGroup ? <div className="mx-auto mb-4 flex -space-x-3 justify-center">{remoteParticipants.slice(0, 4).map((participant) => <Avatar key={participant.id} subject={{ avatar_url: participant.avatarUrl, display_name: participant.displayName }} size={52} showOnline={false} />)}</div> : <div className="mx-auto mb-4 flex h-24 w-24 items-center justify-center rounded-full ring-4 ring-[var(--color-bg-tertiary)]" style={{ boxShadow: call.status === "active" ? "0 0 0 6px rgb(22 163 74 / 15%)" : undefined }}><Avatar subject={{ avatar_url: call.peerAvatarUrl, display_name: call.peerName }} size={88} showOnline={false} /></div>}
          <div className="flex items-start justify-center gap-3"><div><h2 className="text-xl font-semibold text-[var(--color-fg-primary)]">{call.peerName}</h2>
          <p className="mt-1 text-sm text-[var(--color-fg-secondary)]">{call.status === "active" ? duration : call.direction === "incoming" ? `Incoming ${call.isGroup ? "group " : ""}voice call` : call.status === "connecting" ? "Connecting…" : "Calling…"}</p></div><button type="button" onClick={() => setCallMinimized(true)} aria-label="Minimize call and return to chat" title="Minimize call" className="rounded-lg p-2 text-[var(--color-fg-secondary)] transition hover:bg-[var(--color-bg-tertiary)]"><Minimize2 size={18} /></button></div>
          {call.isGroup && remoteParticipants.length ? <div className="mt-4 flex flex-wrap justify-center gap-2">{remoteParticipants.map((participant) => <span key={participant.id} className="rounded-full bg-[var(--color-bg-tertiary)] px-3 py-1 text-xs text-[var(--color-fg-secondary)]">{participant.displayName}</span>)}</div> : null}
          {audioNeedsInteraction ? <button onClick={() => void enableCallAudio()} className="mt-5 rounded-full bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white">Tap to enable audio</button> : null}
          <div className="mt-8 flex items-center justify-center gap-5">
            {call.direction === "incoming" && call.status === "ringing" ? <><button onClick={declineOrEnd} aria-label="Decline call" className="flex h-14 w-14 items-center justify-center rounded-full bg-red-600 text-white hover:bg-red-700"><PhoneOff size={22} /></button><button onClick={() => void acceptCall()} aria-label="Answer call" className="flex h-14 w-14 items-center justify-center rounded-full bg-green-600 text-white hover:bg-green-700"><Phone size={22} /></button></> : <><button onClick={toggleMute} aria-label={call.muted ? "Unmute microphone" : "Mute microphone"} className="flex h-12 w-12 items-center justify-center rounded-full text-[var(--color-fg-primary)] hover:bg-[var(--color-bg-tertiary)]">{call.muted ? <MicOff size={21} /> : <Mic size={21} />}</button><button onClick={declineOrEnd} aria-label="Leave call" className="flex h-14 w-14 items-center justify-center rounded-full bg-red-600 text-white hover:bg-red-700"><PhoneOff size={22} /></button></>}
          </div>
        </section>
      </div> : null}
    </VoiceCallContext.Provider>
  );
}
