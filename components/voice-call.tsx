"use client";

import clsx from "clsx";
import { Loader2, Mic, MicOff, Phone, PhoneCall, PhoneOff, X } from "lucide-react";
import Pusher from "pusher-js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CallSignal, CallSignalType } from "@/lib/call";
import { PUSHER_CHANNEL, PUSHER_EVENT_CALL_SIGNAL } from "@/lib/realtime";
import { getSenderLabel, type Member, type Sender } from "@/lib/types";

type CallStatus = "idle" | "calling" | "ringing" | "connecting" | "active";
type RingMode = "outgoing" | "incoming";

type VoiceCallProps = {
  sender: Sender;
  members: readonly Member[];
};

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:global.stun.twilio.com:3478" }
];
const SIGNAL_FAST_POLLING_INTERVAL_MS = 500;
const SIGNAL_IDLE_REALTIME_POLLING_INTERVAL_MS = 1500;
const SIGNAL_BACKGROUND_POLLING_INTERVAL_MS = 6000;
const SIGNAL_POLLING_LOOKBACK_MS = 1500;
const OUTGOING_CALL_TIMEOUT_MS = 45000;

function createCallId() {
  if (globalThis.crypto?.randomUUID) {
    return `call-${globalThis.crypto.randomUUID()}`;
  }

  return `call-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function readApiError(response: Response, fallback: string) {
  const data = (await response.json().catch(() => null)) as { error?: unknown } | null;
  return typeof data?.error === "string" ? data.error : fallback;
}

export function VoiceCall({ sender, members }: VoiceCallProps) {
  const [status, setStatus] = useState<CallStatus>("idle");
  const [activePeer, setActivePeer] = useState<Sender | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const statusRef = useRef(status);
  const activePeerRef = useRef<Sender | null>(activePeer);
  const callIdRef = useRef<string | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const localStreamPromiseRef = useRef<Promise<MediaStream> | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const ringtoneIntervalRef = useRef<number | null>(null);
  const outgoingTimeoutRef = useRef<number | null>(null);
  const seenSignalIdsRef = useRef<Set<string>>(new Set());
  const lastSignalPollAtRef = useRef(new Date(Date.now() - 5000).toISOString());
  const pusherConnectedRef = useRef(false);

  const pusherKey = process.env.NEXT_PUBLIC_PUSHER_KEY;
  const pusherCluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER;
  const peerOptions = useMemo(() => members.filter((member) => member.id !== sender), [members, sender]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    activePeerRef.current = activePeer;
  }, [activePeer]);

  const getAudioContext = useCallback(() => {
    const WebAudioContext =
      window.AudioContext ??
      (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

    if (!WebAudioContext) {
      return null;
    }

    audioContextRef.current ??= new WebAudioContext();
    return audioContextRef.current;
  }, []);

  const unlockAudio = useCallback(async () => {
    const audioContext = getAudioContext();

    if (audioContext?.state === "suspended") {
      await audioContext.resume().catch(() => undefined);
    }
  }, [getAudioContext]);

  const stopRingtone = useCallback(() => {
    if (ringtoneIntervalRef.current) {
      window.clearInterval(ringtoneIntervalRef.current);
      ringtoneIntervalRef.current = null;
    }
  }, []);

  const clearOutgoingTimeout = useCallback(() => {
    if (outgoingTimeoutRef.current) {
      window.clearTimeout(outgoingTimeoutRef.current);
      outgoingTimeoutRef.current = null;
    }
  }, []);

  const playTone = useCallback(
    (frequency: number, duration: number, delay = 0) => {
      const audioContext = getAudioContext();

      if (!audioContext) {
        return;
      }

      const startAt = audioContext.currentTime + delay;
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();

      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, startAt);
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(0.08, startAt + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start(startAt);
      oscillator.stop(startAt + duration + 0.03);
    },
    [getAudioContext]
  );

  const playRingtonePattern = useCallback(
    (mode: RingMode) => {
      if (mode === "incoming") {
        playTone(740, 0.18, 0);
        playTone(740, 0.18, 0.28);
        return;
      }

      playTone(520, 0.16, 0);
      playTone(660, 0.16, 0.22);
    },
    [playTone]
  );

  const startRingtone = useCallback(
    (mode: RingMode) => {
      stopRingtone();
      void unlockAudio().then(() => {
        playRingtonePattern(mode);
        ringtoneIntervalRef.current = window.setInterval(
          () => playRingtonePattern(mode),
          mode === "incoming" ? 1400 : 1900
        );
      });
    },
    [playRingtonePattern, stopRingtone, unlockAudio]
  );

  useEffect(() => {
    function handleFirstInteraction() {
      void unlockAudio();
    }

    document.addEventListener("pointerdown", handleFirstInteraction, { once: true });
    document.addEventListener("keydown", handleFirstInteraction, { once: true });

    return () => {
      document.removeEventListener("pointerdown", handleFirstInteraction);
      document.removeEventListener("keydown", handleFirstInteraction);
    };
  }, [unlockAudio]);

  useEffect(() => {
    if (status === "calling") {
      startRingtone("outgoing");
      return;
    }

    if (status === "ringing") {
      startRingtone("incoming");
      return;
    }

    stopRingtone();
  }, [startRingtone, status, stopRingtone]);

  const sendSignal = useCallback(
    async (type: CallSignalType, nextCallId: string, to: Sender, payload?: CallSignal["payload"]) => {
      const response = await fetch("/api/call", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          type,
          callId: nextCallId,
          from: sender,
          to,
          payload
        })
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, "語音通話訊號送出失敗。"));
      }
    },
    [sender]
  );

  const cleanupCall = useCallback(() => {
    stopRingtone();
    clearOutgoingTimeout();

    const peerConnection = peerConnectionRef.current;
    peerConnectionRef.current = null;
    peerConnection?.close();

    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    localStreamPromiseRef.current = null;

    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }

    pendingCandidatesRef.current = [];
    callIdRef.current = null;
    activePeerRef.current = null;
    setActivePeer(null);
    setStatus("idle");
    setIsMuted(false);
  }, [clearOutgoingTimeout, stopRingtone]);

  const closePanel = useCallback(() => {
    if (statusRef.current !== "idle") {
      return;
    }

    setError(null);
    setIsPanelOpen(false);
  }, []);

  const getLocalStream = useCallback(async () => {
    if (localStreamRef.current) {
      return localStreamRef.current;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("這個瀏覽器不支援語音通話。");
    }

    localStreamPromiseRef.current ??= navigator.mediaDevices
      .getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false
      })
      .then((stream) => {
        localStreamRef.current = stream;
        return stream;
      })
      .finally(() => {
        localStreamPromiseRef.current = null;
      });

    return localStreamPromiseRef.current;
  }, []);

  const addPendingCandidates = useCallback(async () => {
    const peerConnection = peerConnectionRef.current;

    if (!peerConnection?.remoteDescription) {
      return;
    }

    const candidates = pendingCandidatesRef.current;
    pendingCandidatesRef.current = [];

    for (const candidate of candidates) {
      await peerConnection.addIceCandidate(candidate).catch(() => undefined);
    }
  }, []);

  const createPeerConnection = useCallback(
    (nextCallId: string) => {
      peerConnectionRef.current?.close();

      const peerConnection = new RTCPeerConnection({
        iceServers: ICE_SERVERS
      });

      peerConnection.onicecandidate = (event) => {
        const peer = activePeerRef.current;

        if (event.candidate && peer) {
          void sendSignal("ice-candidate", nextCallId, peer, {
            candidate: event.candidate.toJSON()
          });
        }
      };

      peerConnection.ontrack = (event) => {
        const [remoteStream] = event.streams;

        if (remoteAudioRef.current && remoteStream) {
          remoteAudioRef.current.srcObject = remoteStream;
          void remoteAudioRef.current.play().catch(() => undefined);
        }

        setStatus("active");
      };

      peerConnection.onconnectionstatechange = () => {
        if (peerConnectionRef.current !== peerConnection) {
          return;
        }

        if (["failed", "disconnected"].includes(peerConnection.connectionState)) {
          cleanupCall();
          setIsPanelOpen(true);
          setError("語音連線中斷，請重新撥打。");
        }
      };

      peerConnectionRef.current = peerConnection;
      return peerConnection;
    },
    [cleanupCall, sendSignal]
  );

  const addLocalTracks = useCallback(
    async (peerConnection: RTCPeerConnection) => {
      const localStream = await getLocalStream();
      const existingTrackIds = new Set(peerConnection.getSenders().map((senderTrack) => senderTrack.track?.id));

      localStream.getTracks().forEach((track) => {
        if (!existingTrackIds.has(track.id)) {
          peerConnection.addTrack(track, localStream);
        }
      });
    },
    [getLocalStream]
  );

  const startOutgoingTimeout = useCallback(
    (nextCallId: string, peer: Sender) => {
      clearOutgoingTimeout();
      outgoingTimeoutRef.current = window.setTimeout(() => {
        if (callIdRef.current !== nextCallId || statusRef.current !== "calling") {
          return;
        }

        void sendSignal("hangup", nextCallId, peer).catch(() => undefined);
        cleanupCall();
        setIsPanelOpen(true);
        setError(`${getSenderLabel(peer, members)} 沒有回應。`);
      }, OUTGOING_CALL_TIMEOUT_MS);
    },
    [cleanupCall, clearOutgoingTimeout, members, sendSignal]
  );

  const startCall = useCallback(
    async (peer: Sender) => {
      if (peer === sender || statusRef.current !== "idle") {
        return;
      }

      setError(null);
      setIsPanelOpen(true);
      setActivePeer(peer);
      activePeerRef.current = peer;

      const nextCallId = createCallId();
      callIdRef.current = nextCallId;
      setStatus("calling");
      startOutgoingTimeout(nextCallId, peer);

      try {
        await sendSignal("call-request", nextCallId, peer);
        await getLocalStream();
      } catch (callError) {
        await sendSignal("hangup", nextCallId, peer).catch(() => undefined);
        cleanupCall();
        setIsPanelOpen(true);
        setError(callError instanceof Error ? callError.message : "無法開始語音通話。");
      }
    },
    [cleanupCall, getLocalStream, sender, sendSignal, startOutgoingTimeout]
  );

  const acceptCall = useCallback(async () => {
    const activeCallId = callIdRef.current;
    const peer = activePeerRef.current;

    if (!activeCallId || !peer) {
      return;
    }

    setError(null);
    setStatus("connecting");

    try {
      const peerConnection = createPeerConnection(activeCallId);
      await addLocalTracks(peerConnection);
      await sendSignal("call-accept", activeCallId, peer);
    } catch (callError) {
      await sendSignal("hangup", activeCallId, peer).catch(() => undefined);
      cleanupCall();
      setIsPanelOpen(true);
      setError(callError instanceof Error ? callError.message : "無法接聽語音通話。");
    }
  }, [addLocalTracks, cleanupCall, createPeerConnection, sendSignal]);

  const rejectCall = useCallback(async () => {
    const activeCallId = callIdRef.current;
    const peer = activePeerRef.current;

    if (activeCallId && peer) {
      await sendSignal("call-reject", activeCallId, peer).catch(() => undefined);
    }

    cleanupCall();
    setError(null);
    setIsPanelOpen(false);
  }, [cleanupCall, sendSignal]);

  const hangUp = useCallback(async () => {
    const activeCallId = callIdRef.current;
    const peer = activePeerRef.current;

    if (activeCallId && peer) {
      await sendSignal("hangup", activeCallId, peer).catch(() => undefined);
    }

    cleanupCall();
    setError(null);
    setIsPanelOpen(false);
  }, [cleanupCall, sendSignal]);

  const toggleMute = useCallback(() => {
    const nextMuted = !isMuted;
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted;
    });
    setIsMuted(nextMuted);
  }, [isMuted]);

  const markSignalSeen = useCallback((signal: CallSignal) => {
    const fallbackKey = `${signal.type}:${signal.callId}:${signal.from}:${signal.to}:${signal.createdAt ?? ""}:${JSON.stringify(
      signal.payload ?? {}
    )}`;
    const signalKey = signal.id ?? fallbackKey;
    const seenSignals = seenSignalIdsRef.current;

    if (seenSignals.has(signalKey)) {
      return false;
    }

    seenSignals.add(signalKey);

    if (seenSignals.size > 500) {
      const oldestSignal = seenSignals.values().next().value;

      if (oldestSignal) {
        seenSignals.delete(oldestSignal);
      }
    }

    return true;
  }, []);

  const handleSignal = useCallback(
    async (signal: CallSignal) => {
      if (signal.to !== sender || signal.from === sender) {
        return;
      }

      if (signal.type === "call-request") {
        if (statusRef.current !== "idle") {
          await sendSignal("call-reject", signal.callId, signal.from).catch(() => undefined);
          return;
        }

        callIdRef.current = signal.callId;
        activePeerRef.current = signal.from;
        setActivePeer(signal.from);
        setIsPanelOpen(true);
        setError(null);
        setStatus("ringing");
        return;
      }

      const peer = activePeerRef.current;

      if (!peer || signal.from !== peer || signal.callId !== callIdRef.current) {
        return;
      }

      if (signal.type === "call-reject") {
        cleanupCall();
        setIsPanelOpen(true);
        setError(`${getSenderLabel(peer, members)} 沒有接聽。`);
        return;
      }

      if (signal.type === "hangup") {
        cleanupCall();
        setIsPanelOpen(true);
        setError(`${getSenderLabel(peer, members)} 已掛斷。`);
        return;
      }

      if (signal.type === "call-accept") {
        clearOutgoingTimeout();
        setStatus("connecting");

        try {
          const peerConnection = createPeerConnection(signal.callId);
          await addLocalTracks(peerConnection);
          const offer = await peerConnection.createOffer();
          await peerConnection.setLocalDescription(offer);
          await sendSignal("offer", signal.callId, peer, { offer });
        } catch (callError) {
          await sendSignal("hangup", signal.callId, peer).catch(() => undefined);
          cleanupCall();
          setIsPanelOpen(true);
          setError(callError instanceof Error ? callError.message : "語音通話連線失敗。");
        }
        return;
      }

      if (signal.type === "offer" && signal.payload?.offer) {
        const peerConnection = peerConnectionRef.current ?? createPeerConnection(signal.callId);

        try {
          await addLocalTracks(peerConnection);
          await peerConnection.setRemoteDescription(signal.payload.offer);
          await addPendingCandidates();
          const answer = await peerConnection.createAnswer();
          await peerConnection.setLocalDescription(answer);
          await sendSignal("answer", signal.callId, peer, { answer });
          setStatus("connecting");
        } catch (callError) {
          await sendSignal("hangup", signal.callId, peer).catch(() => undefined);
          cleanupCall();
          setIsPanelOpen(true);
          setError(callError instanceof Error ? callError.message : "語音通話連線失敗。");
        }
        return;
      }

      if (signal.type === "answer" && signal.payload?.answer) {
        const peerConnection = peerConnectionRef.current;

        if (peerConnection) {
          await peerConnection.setRemoteDescription(signal.payload.answer).catch(() => undefined);
          await addPendingCandidates();
          setStatus("active");
        }
        return;
      }

      if (signal.type === "ice-candidate" && signal.payload?.candidate) {
        const peerConnection = peerConnectionRef.current;

        if (!peerConnection?.remoteDescription) {
          pendingCandidatesRef.current.push(signal.payload.candidate);
          return;
        }

        await peerConnection.addIceCandidate(signal.payload.candidate).catch(() => undefined);
      }
    },
    [
      addLocalTracks,
      addPendingCandidates,
      cleanupCall,
      clearOutgoingTimeout,
      createPeerConnection,
      members,
      sendSignal,
      sender
    ]
  );

  const receiveSignal = useCallback(
    async (signal: CallSignal) => {
      if (!markSignalSeen(signal)) {
        return;
      }

      await handleSignal(signal);
    },
    [handleSignal, markSignalSeen]
  );

  useEffect(() => {
    seenSignalIdsRef.current.clear();
    lastSignalPollAtRef.current = new Date(Date.now() - 5000).toISOString();
    cleanupCall();
  }, [cleanupCall, sender]);

  useEffect(() => {
    if (!pusherKey || !pusherCluster) {
      return;
    }

    const pusher = new Pusher(pusherKey, {
      cluster: pusherCluster
    });
    const channel = pusher.subscribe(PUSHER_CHANNEL);
    const handleStateChange = ({ current }: { current: string }) => {
      pusherConnectedRef.current = current === "connected";
    };

    pusher.connection.bind("state_change", handleStateChange);
    channel.bind(PUSHER_EVENT_CALL_SIGNAL, (signal: CallSignal) => {
      void receiveSignal(signal);
    });

    return () => {
      pusherConnectedRef.current = false;
      pusher.connection.unbind("state_change", handleStateChange);
      channel.unbind(PUSHER_EVENT_CALL_SIGNAL);
      pusher.unsubscribe(PUSHER_CHANNEL);
      pusher.disconnect();
    };
  }, [pusherCluster, pusherKey, receiveSignal]);

  useEffect(() => {
    let isStopped = false;
    let timeoutId: number | null = null;

    function getPollingDelay() {
      if (document.hidden) {
        return SIGNAL_BACKGROUND_POLLING_INTERVAL_MS;
      }

      if (statusRef.current !== "idle") {
        return SIGNAL_FAST_POLLING_INTERVAL_MS;
      }

      return pusherConnectedRef.current ? SIGNAL_IDLE_REALTIME_POLLING_INTERVAL_MS : SIGNAL_FAST_POLLING_INTERVAL_MS;
    }

    function schedulePoll(delay = getPollingDelay()) {
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }

      timeoutId = window.setTimeout(() => {
        void pollSignals().finally(() => {
          if (!isStopped) {
            schedulePoll();
          }
        });
      }, delay);
    }

    function handleVisibilityChange() {
      schedulePoll();
    }

    async function pollSignals() {
      const since = new Date(
        new Date(lastSignalPollAtRef.current).getTime() - SIGNAL_POLLING_LOOKBACK_MS
      ).toISOString();

      try {
        const response = await fetch(`/api/call?to=${sender}&since=${encodeURIComponent(since)}`, {
          cache: "no-store"
        });

        if (!response.ok || isStopped) {
          return;
        }

        const data = (await response.json()) as { signals?: CallSignal[] };
        const signals = data.signals ?? [];
        let latestSignalTime = new Date(lastSignalPollAtRef.current).getTime();

        for (const signal of signals) {
          if (signal.createdAt) {
            latestSignalTime = Math.max(latestSignalTime, new Date(signal.createdAt).getTime());
          }

          await receiveSignal(signal);
        }

        lastSignalPollAtRef.current = new Date(Math.max(latestSignalTime, Date.now())).toISOString();
      } catch {
        // Pusher is the primary path; polling retries on the next tick.
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    void pollSignals().finally(() => {
      if (!isStopped) {
        schedulePoll();
      }
    });

    return () => {
      isStopped = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);

      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [receiveSignal, sender]);

  useEffect(() => {
    return () => {
      cleanupCall();
    };
  }, [cleanupCall]);

  const showCallPanel = isPanelOpen || status !== "idle" || Boolean(error);
  const activePeerLabel = activePeer ? getSenderLabel(activePeer, members) : null;
  const statusText =
    status === "calling"
      ? `正在撥打 ${activePeerLabel}`
      : status === "ringing"
        ? `${activePeerLabel} 來電`
        : status === "connecting"
          ? "正在建立連線"
          : status === "active"
            ? `與 ${activePeerLabel} 通話中`
            : "語音通話";
  const detailText =
    status === "calling"
      ? "等待對方接聽"
      : status === "ringing"
        ? "選擇接聽或拒接"
        : status === "connecting"
          ? "正在交換加密音訊"
          : status === "active"
            ? isMuted
              ? "你的麥克風已靜音"
              : "麥克風已開啟"
            : "選擇要撥打的身分";

  return (
    <>
      <button
        type="button"
        onClick={() => setIsPanelOpen(true)}
        className={clsx(
          "inline-flex h-10 w-10 items-center justify-center rounded-md border transition focus:outline-none focus:ring-4 focus:ring-brand/20",
          status === "active"
            ? "border-green-200 bg-green-50 text-green-700 hover:bg-green-100"
            : status !== "idle"
              ? "border-brand/30 bg-brand/10 text-brand hover:bg-brand/15"
              : "border-line text-slate-700 hover:border-slate-300 hover:bg-slate-50"
        )}
        aria-label="語音通話"
        title="語音通話"
      >
        <Phone size={17} />
      </button>

      <audio ref={remoteAudioRef} autoPlay playsInline />

      {showCallPanel ? (
        <div className="fixed right-4 top-20 z-[1000] w-[min(calc(100vw-2rem),390px)] overflow-hidden rounded-lg border border-line bg-white shadow-soft">
          <div className="border-b border-line bg-slate-50/80 px-4 py-3">
            <div className="flex items-center gap-3">
              <div
                className={clsx(
                  "flex h-11 w-11 shrink-0 items-center justify-center rounded-md",
                  status === "active"
                    ? "bg-green-100 text-green-700"
                    : status === "ringing"
                      ? "bg-brand/10 text-brand"
                      : "bg-white text-slate-700 shadow-sm"
                )}
              >
                {status === "connecting" ? <Loader2 className="animate-spin" size={19} /> : <PhoneCall size={19} />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink">{statusText}</p>
                <p className="mt-0.5 truncate text-xs text-slate-500">{detailText}</p>
              </div>
              {status === "idle" ? (
                <button
                  type="button"
                  onClick={closePanel}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-500 hover:bg-white hover:text-slate-900"
                  aria-label="關閉"
                >
                  <X size={18} />
                </button>
              ) : null}
            </div>
          </div>

          <div className="p-4">
            {error ? (
              <div className="mb-3 rounded-md border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            ) : null}

            {status === "idle" ? (
              <div className="grid grid-cols-2 gap-2">
                {peerOptions.map((peer) => (
                  <button
                    key={peer.id}
                    type="button"
                    onClick={() => void startCall(peer.id)}
                    className="group flex min-h-20 flex-col items-start justify-between rounded-md border border-line bg-white p-3 text-left transition hover:border-brand/40 hover:bg-brand/5 focus:outline-none focus:ring-4 focus:ring-brand/15"
                  >
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-slate-100 text-sm font-semibold text-slate-700 transition group-hover:bg-brand group-hover:text-white">
                      {peer.name}
                    </span>
                    <span className="text-xs font-medium text-slate-500">撥打</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="rounded-md border border-line bg-slate-50 px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-slate-500">對方</p>
                      <p className="truncate text-base font-semibold text-ink">{activePeerLabel}</p>
                    </div>
                    <span
                      className={clsx(
                        "inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium",
                        status === "active" ? "bg-green-100 text-green-700" : "bg-brand/10 text-brand"
                      )}
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-current" />
                      {status === "active" ? "通話中" : status === "ringing" ? "來電" : "連線中"}
                    </span>
                  </div>
                </div>

                <div className="flex justify-end gap-2">
                  {status === "ringing" ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void rejectCall()}
                        className="inline-flex h-11 w-11 items-center justify-center rounded-md bg-red-600 text-white transition hover:bg-red-700 focus:outline-none focus:ring-4 focus:ring-red-200"
                        aria-label="拒接"
                      >
                        <PhoneOff size={19} />
                      </button>
                      <button
                        type="button"
                        onClick={() => void acceptCall()}
                        className="inline-flex h-11 w-11 items-center justify-center rounded-md bg-green-600 text-white transition hover:bg-green-700 focus:outline-none focus:ring-4 focus:ring-green-200"
                        aria-label="接聽"
                      >
                        <PhoneCall size={19} />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={toggleMute}
                        className={clsx(
                          "inline-flex h-11 w-11 items-center justify-center rounded-md border transition focus:outline-none focus:ring-4 focus:ring-brand/15",
                          isMuted
                            ? "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
                            : "border-line text-slate-700 hover:bg-slate-50"
                        )}
                        aria-label={isMuted ? "取消靜音" : "靜音"}
                      >
                        {isMuted ? <MicOff size={19} /> : <Mic size={19} />}
                      </button>
                      <button
                        type="button"
                        onClick={() => void hangUp()}
                        className="inline-flex h-11 w-11 items-center justify-center rounded-md bg-red-600 text-white transition hover:bg-red-700 focus:outline-none focus:ring-4 focus:ring-red-200"
                        aria-label="掛斷"
                      >
                        <PhoneOff size={19} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
