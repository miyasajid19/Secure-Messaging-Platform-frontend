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
import { Camera, CameraOff, Mic, MicOff, Phone, PhoneOff, Video } from "lucide-react";
import { toast } from "sonner";
import { Avatar } from "@/components/avatar";
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
};

type VoiceCallContextValue = {
  call: CallState | null;
  startCall: (conversationId: number, peerId: number, peerName: string, peerAvatarUrl?: string | null, mediaType?: "audio" | "video") => Promise<void>;
};

const VoiceCallContext = createContext<VoiceCallContextValue | null>(null);
const FALLBACK_ICE_SERVERS: IceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

export function useVoiceCall() {
  const context = useContext(VoiceCallContext);
  if (!context) throw new Error("useVoiceCall must be used inside VoiceCallProvider");
  return context;
}

export function VoiceCallProvider({ children }: { children: ReactNode }) {
  const [call, setCall] = useState<CallState | null>(null);
  const [clock, setClock] = useState(Date.now());
  const callRef = useRef<CallState | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);

  const updateCall = useCallback((next: CallState | null) => {
    callRef.current = next;
    setCall(next);
  }, []);

  const cleanup = useCallback(() => {
    const connection = peerConnectionRef.current;
    peerConnectionRef.current = null;
    updateCall(null);
    connection?.close();
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    pendingCandidatesRef.current = [];
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
  }, [updateCall]);

  const iceServers = useCallback(async () => {
    try {
      return (await getIceServers()).ice_servers;
    } catch {
      return FALLBACK_ICE_SERVERS;
    }
  }, []);

  const createPeerConnection = useCallback(async (session: CallState) => {
    if (peerConnectionRef.current) return peerConnectionRef.current;
    const pc = new RTCPeerConnection({ iceServers: await iceServers() });
    peerConnectionRef.current = pc;
    localStreamRef.current?.getTracks().forEach((track) => pc.addTrack(track, localStreamRef.current!));
    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      sendCallSignal({
        type: "call.ice",
        call_id: session.callId,
        conversation_id: session.conversationId,
        to_user_id: session.peerId,
        candidate: event.candidate.toJSON(),
      });
    };
    pc.ontrack = (event) => {
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      if (session.mediaType === "video") {
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = stream;
          void remoteVideoRef.current.play().catch(() => {});
        }
      } else if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = stream;
        void remoteAudioRef.current.play().catch(() => {});
      }
    };
    pc.onconnectionstatechange = () => {
      const current = callRef.current;
      if (!current || current.callId !== session.callId) return;
      if (pc.connectionState === "connected") {
        updateCall({ ...current, status: "active", startedAt: current.startedAt ?? Date.now() });
      } else if (pc.connectionState === "disconnected") {
        updateCall({ ...current, status: "connecting" });
      } else if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        cleanup();
        if (pc.connectionState === "failed") toast.error("Call connection failed");
      }
    };
    return pc;
  }, [cleanup, iceServers, updateCall]);

  const flushCandidates = useCallback(async (pc: RTCPeerConnection) => {
    const queued = pendingCandidatesRef.current.splice(0);
    for (const candidate of queued) await pc.addIceCandidate(candidate);
  }, []);

  const sendOffer = useCallback(async (session: CallState) => {
    try {
      const pc = await createPeerConnection(session);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      sendCallSignal({
        type: "call.offer",
        call_id: session.callId,
        conversation_id: session.conversationId,
        to_user_id: session.peerId,
        description: pc.localDescription?.toJSON() ?? offer,
      });
    } catch {
      toast.error("Couldn't start the call");
      cleanup();
    }
  }, [cleanup, createPeerConnection]);

  const handleSignal = useCallback(async (signal: CallSignal) => {
    if (signal.type === "call.incoming") {
      if (!signal.call_id || !signal.conversation_id || !signal.from_user_id) return;
      if (callRef.current) {
        sendCallSignal({ type: "call.reject", call_id: signal.call_id, conversation_id: signal.conversation_id, to_user_id: signal.from_user_id });
        return;
      }
      updateCall({
        callId: signal.call_id,
        conversationId: signal.conversation_id,
        peerId: signal.from_user_id,
        peerName: signal.from_name || "Signal user",
        peerAvatarUrl: signal.from_avatar_url ?? null,
        mediaType: signal.media_type === "video" ? "video" : "audio",
        direction: "incoming",
        status: "ringing",
        startedAt: null,
        muted: false,
        cameraOff: false,
      });
      return;
    }

    if (signal.type === "call.error") {
      toast.error(signal.message || "Call request failed");
      if (callRef.current?.status === "ringing") cleanup();
      return;
    }
    const current = callRef.current;
    if (!current || !signal.call_id || signal.call_id !== current.callId) return;

    if (["call.unavailable", "call.rejected", "call.cancelled", "call.ended", "call.peer_offline"].includes(signal.type)) {
      if (signal.type === "call.unavailable" || signal.type === "call.rejected") toast.info(signal.message || `${current.peerName} didn't answer`);
      if (signal.type === "call.peer_offline") toast.info(`${current.peerName} disconnected`);
      cleanup();
      return;
    }

    if (signal.type === "call.accepted" && current.direction === "outgoing") {
      updateCall({ ...current, status: "connecting" });
      await sendOffer({ ...current, status: "connecting" });
      return;
    }

    const pc = peerConnectionRef.current;
    if (signal.type === "call.offer" && current.direction === "incoming" && signal.description) {
      try {
        const connection = pc ?? await createPeerConnection(current);
        await connection.setRemoteDescription(signal.description);
        await flushCandidates(connection);
        const answer = await connection.createAnswer();
        await connection.setLocalDescription(answer);
        sendCallSignal({
          type: "call.answer",
          call_id: current.callId,
          conversation_id: current.conversationId,
          to_user_id: current.peerId,
          description: connection.localDescription?.toJSON() ?? answer,
        });
      } catch {
        toast.error("Couldn't connect the call");
        cleanup();
      }
      return;
    }

    if (signal.type === "call.answer" && current.direction === "outgoing" && signal.description && pc) {
      try {
        await pc.setRemoteDescription(signal.description);
        await flushCandidates(pc);
      } catch {
        toast.error("Couldn't connect the call");
        cleanup();
      }
      return;
    }

    if (signal.type === "call.ice" && signal.candidate) {
      const connection = peerConnectionRef.current;
      if (!connection || !connection.remoteDescription) pendingCandidatesRef.current.push(signal.candidate);
      else {
        try { await connection.addIceCandidate(signal.candidate); }
        catch { /* A late candidate can arrive after a call ends. */ }
      }
    }
  }, [cleanup, createPeerConnection, flushCandidates, sendOffer, updateCall]);

  useEffect(() => subscribeToCallSignals((signal) => { void handleSignal(signal); }), [handleSignal]);
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
      });
      cleanup();
      if (current.direction === "outgoing") toast.info("No answer");
    }, 30_000);
    return () => window.clearTimeout(timer);
  }, [call, cleanup]);
  useEffect(() => {
    if (!call?.startedAt) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [call?.startedAt]);
  useEffect(() => () => cleanup(), [cleanup]);

  const startCall = useCallback(async (conversationId: number, peerId: number, peerName: string, peerAvatarUrl: string | null = null, mediaType: "audio" | "video" = "audio") => {
    if (callRef.current) { toast.info("You're already in a call"); return; }
    if (!isRealtimeConnected()) {
      toast.error("Reconnecting to calls. Try again in a moment.");
      return;
    }
    const session: CallState = {
      callId: crypto.randomUUID(), conversationId, peerId, peerName, peerAvatarUrl,
      mediaType, direction: "outgoing", status: "ringing", startedAt: null, muted: false, cameraOff: false,
    };
    try {
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
  }, [cleanup, updateCall]);

  async function acceptCall() {
    const current = callRef.current;
    if (!current || current.direction !== "incoming") return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: current.mediaType === "video" });
      localStreamRef.current = stream;
      await createPeerConnection(current);
      if (!sendCallSignal({ type: "call.accept", call_id: current.callId, conversation_id: current.conversationId, to_user_id: current.peerId })) {
        throw new Error("Signaling is disconnected");
      }
      updateCall({ ...current, status: "connecting" });
    } catch (error) {
      sendCallSignal({ type: "call.reject", call_id: current.callId, conversation_id: current.conversationId, to_user_id: current.peerId });
      cleanup();
      toast.error(error instanceof DOMException && error.name === "NotAllowedError" ? "Allow microphone access to answer" : "Couldn't answer the call");
    }
  }

  function declineOrEnd() {
    const current = callRef.current;
    if (!current) return;
    sendCallSignal({
      type: current.direction === "incoming" && current.status === "ringing" ? "call.reject" : current.status === "ringing" ? "call.cancel" : "call.end",
      call_id: current.callId,
      conversation_id: current.conversationId,
      to_user_id: current.peerId,
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
    updateCall({ ...current, cameraOff: !track.enabled });
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

  return (
    <VoiceCallContext.Provider value={{ call, startCall }}>
      {children}
      <audio ref={remoteAudioRef} autoPlay playsInline />
      {call?.mediaType === "video" ? <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black p-3 sm:p-6" role="presentation">
        <section role="dialog" aria-modal="true" aria-label="Video call" className="relative h-full max-h-[min(82vh,900px)] w-full max-w-5xl overflow-hidden rounded-3xl bg-neutral-950 text-white shadow-2xl">
          <video ref={remoteVideoRef} autoPlay playsInline className="h-full w-full object-cover" />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/45 via-transparent to-black/55" />
          <div className="absolute left-5 top-5 z-10"><h2 className="text-xl font-semibold">{call.peerName}</h2><p className="text-sm text-white/80">{call.status === "active" ? duration : call.direction === "incoming" ? "Incoming video call" : call.status === "connecting" ? "Connecting…" : "Calling…"}</p></div>
          {call.status !== "active" ? <div className="absolute inset-0 flex items-center justify-center"><Avatar subject={{ avatar_url: call.peerAvatarUrl, display_name: call.peerName }} size={112} showOnline={false} /></div> : null}
          {call.direction === "incoming" && call.status === "ringing" ? null : <video ref={localVideoRef} autoPlay muted playsInline className="absolute bottom-24 right-5 z-10 aspect-video w-36 rounded-2xl border border-white/30 bg-black object-cover shadow-lg sm:w-52" />}
          <div className="absolute bottom-6 left-1/2 z-20 flex -translate-x-1/2 items-center gap-4 rounded-full bg-black/45 px-5 py-3 backdrop-blur-md">
            {call.direction === "incoming" && call.status === "ringing" ? <><button onClick={declineOrEnd} aria-label="Decline call" className="flex h-14 w-14 items-center justify-center rounded-full bg-red-600 hover:bg-red-700"><PhoneOff size={22} /></button><button onClick={() => void acceptCall()} aria-label="Answer video call" className="flex h-14 w-14 items-center justify-center rounded-full bg-green-600 hover:bg-green-700"><Video size={22} /></button></> : <><button onClick={toggleMute} aria-label={call.muted ? "Unmute microphone" : "Mute microphone"} className="flex h-12 w-12 items-center justify-center rounded-full bg-white/15 hover:bg-white/25">{call.muted ? <MicOff size={21} /> : <Mic size={21} />}</button><button onClick={toggleCamera} aria-label={call.cameraOff ? "Turn camera on" : "Turn camera off"} className="flex h-12 w-12 items-center justify-center rounded-full bg-white/15 hover:bg-white/25">{call.cameraOff ? <CameraOff size={21} /> : <Camera size={21} />}</button><button onClick={declineOrEnd} aria-label="End call" className="flex h-14 w-14 items-center justify-center rounded-full bg-red-600 hover:bg-red-700"><PhoneOff size={22} /></button></>}
          </div>
        </section>
      </div> : call ? <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm" role="presentation">
        <section role="dialog" aria-modal="true" aria-label="Voice call" className="w-full max-w-sm rounded-3xl border p-7 text-center shadow-2xl" style={{ backgroundColor: "var(--color-bg-primary)", borderColor: "var(--color-border-subtle)" }}>
          <div className="mx-auto mb-4 flex h-24 w-24 items-center justify-center rounded-full ring-4 ring-[var(--color-bg-tertiary)]" style={{ boxShadow: call.status === "active" ? "0 0 0 6px rgb(22 163 74 / 15%)" : undefined }}>
            <Avatar subject={{ avatar_url: call.peerAvatarUrl, display_name: call.peerName }} size={88} showOnline={false} />
          </div>
          <h2 className="text-xl font-semibold text-[var(--color-fg-primary)]">{call.peerName}</h2>
          <p className="mt-1 text-sm text-[var(--color-fg-secondary)]">{call.status === "active" ? duration : call.direction === "incoming" ? "Incoming voice call" : call.status === "connecting" ? "Connecting…" : "Calling…"}</p>
          <div className="mt-8 flex items-center justify-center gap-5">
            {call.direction === "incoming" && call.status === "ringing" ? <>
              <button onClick={declineOrEnd} aria-label="Decline call" className="flex h-14 w-14 items-center justify-center rounded-full bg-red-600 text-white hover:bg-red-700"><PhoneOff size={22} /></button>
              <button onClick={() => void acceptCall()} aria-label="Answer call" className="flex h-14 w-14 items-center justify-center rounded-full bg-green-600 text-white hover:bg-green-700"><Phone size={22} /></button>
            </> : <>
              <button onClick={toggleMute} aria-label={call.muted ? "Unmute microphone" : "Mute microphone"} className="flex h-12 w-12 items-center justify-center rounded-full text-[var(--color-fg-primary)] hover:bg-[var(--color-bg-tertiary)]"><span className="sr-only">{call.muted ? "Unmute" : "Mute"}</span>{call.muted ? <MicOff size={21} /> : <Mic size={21} />}</button>
              <button onClick={declineOrEnd} aria-label="End call" className="flex h-14 w-14 items-center justify-center rounded-full bg-red-600 text-white hover:bg-red-700"><PhoneOff size={22} /></button>
            </>}
          </div>
        </section>
      </div> : null}
    </VoiceCallContext.Provider>
  );
}
