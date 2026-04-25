"use client";

import clsx from "clsx";
import { Mic, MicOff, Phone, PhoneCall, PhoneOff, X } from "lucide-react";
import Pusher from "pusher-js";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CallSignal, CallSignalType } from "@/lib/call";
import { PUSHER_CHANNEL, PUSHER_EVENT_CALL_SIGNAL } from "@/lib/realtime";
import { SENDER_LABEL, type Sender } from "@/lib/types";

type CallStatus = "idle" | "calling" | "ringing" | "connecting" | "active";
type RingMode = "outgoing" | "incoming";

type VoiceCallProps = {
  sender: Sender;
  recipient: Sender;
};

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:global.stun.twilio.com:3478" }
];
const SIGNAL_POLLING_INTERVAL_MS = 800;
const SIGNAL_POLLING_LOOKBACK_MS = 1500;

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

export function VoiceCall({ sender, recipient }: VoiceCallProps) {
  const [status, setStatus] = useState<CallStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const statusRef = useRef(status);
  const callIdRef = useRef<string | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const ringtoneIntervalRef = useRef<number | null>(null);
  const seenSignalIdsRef = useRef<Set<string>>(new Set());
  const lastSignalPollAtRef = useRef(new Date(Date.now() - 5000).toISOString());

  const pusherKey = process.env.NEXT_PUBLIC_PUSHER_KEY;
  const pusherCluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER;
  const isRealtimeReady = Boolean(pusherKey && pusherCluster);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    seenSignalIdsRef.current.clear();
    lastSignalPollAtRef.current = new Date(Date.now() - 5000).toISOString();
  }, [sender]);

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
    async (type: CallSignalType, nextCallId: string, payload?: CallSignal["payload"]) => {
      const response = await fetch("/api/call", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          type,
          callId: nextCallId,
          from: sender,
          to: recipient,
          payload
        })
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, "通話訊號傳送失敗。"));
      }
    },
    [recipient, sender]
  );

  const cleanupCall = useCallback(() => {
    stopRingtone();
    peerConnectionRef.current?.close();
    peerConnectionRef.current = null;

    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;

    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }

    pendingCandidatesRef.current = [];
    callIdRef.current = null;
    setStatus("idle");
    setIsMuted(false);
  }, [stopRingtone]);

  const closePanel = useCallback(() => {
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

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: false
    });

    localStreamRef.current = stream;
    return stream;
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
        if (event.candidate) {
          void sendSignal("ice-candidate", nextCallId, {
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
        if (["failed", "closed"].includes(peerConnection.connectionState)) {
          cleanupCall();
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
      const existingTrackIds = new Set(peerConnection.getSenders().map((sender) => sender.track?.id));

      localStream.getTracks().forEach((track) => {
        if (!existingTrackIds.has(track.id)) {
          peerConnection.addTrack(track, localStream);
        }
      });
    },
    [getLocalStream]
  );

  const startCall = useCallback(async () => {
    setError(null);
    setIsPanelOpen(true);

    if (!isRealtimeReady) {
      setError("Pusher 尚未設定，無法使用語音通話。");
      return;
    }

    const nextCallId = createCallId();
    callIdRef.current = nextCallId;
    setStatus("calling");

    try {
      await getLocalStream();
      await sendSignal("call-request", nextCallId);
    } catch (callError) {
      cleanupCall();
      setIsPanelOpen(true);
      setError(callError instanceof Error ? callError.message : "無法開始語音通話。");
    }
  }, [cleanupCall, getLocalStream, isRealtimeReady, sendSignal]);

  const acceptCall = useCallback(async () => {
    const activeCallId = callIdRef.current;

    if (!activeCallId) {
      return;
    }

    setError(null);
    setStatus("connecting");

    try {
      const peerConnection = createPeerConnection(activeCallId);
      await addLocalTracks(peerConnection);
      await sendSignal("call-accept", activeCallId);
    } catch (callError) {
      await sendSignal("hangup", activeCallId).catch(() => undefined);
      cleanupCall();
      setError(callError instanceof Error ? callError.message : "無法接聽語音通話。");
    }
  }, [addLocalTracks, cleanupCall, createPeerConnection, sendSignal]);

  const rejectCall = useCallback(async () => {
    const activeCallId = callIdRef.current;

    if (activeCallId) {
      await sendSignal("call-reject", activeCallId).catch(() => undefined);
    }

    cleanupCall();
    setIsPanelOpen(false);
  }, [cleanupCall, sendSignal]);

  const hangUp = useCallback(async () => {
    const activeCallId = callIdRef.current;

    if (activeCallId) {
      await sendSignal("hangup", activeCallId).catch(() => undefined);
    }

    cleanupCall();
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
      if (signal.to !== sender || signal.from !== recipient) {
        return;
      }

      if (signal.type === "call-request") {
        if (statusRef.current !== "idle") {
          await sendSignal("call-reject", signal.callId).catch(() => undefined);
          return;
        }

        callIdRef.current = signal.callId;
        setIsPanelOpen(true);
        setError(null);
        setStatus("ringing");
        return;
      }

      if (signal.callId !== callIdRef.current) {
        return;
      }

      if (signal.type === "call-reject") {
        cleanupCall();
        setIsPanelOpen(true);
        setError(`${SENDER_LABEL[recipient]} 沒有接聽。`);
        return;
      }

      if (signal.type === "hangup") {
        cleanupCall();
        setIsPanelOpen(true);
        setError(`${SENDER_LABEL[recipient]} 已掛斷。`);
        return;
      }

      if (signal.type === "call-accept") {
        setStatus("connecting");

        try {
          const peerConnection = createPeerConnection(signal.callId);
          await addLocalTracks(peerConnection);
          const offer = await peerConnection.createOffer();
          await peerConnection.setLocalDescription(offer);
          await sendSignal("offer", signal.callId, { offer });
        } catch (callError) {
          await sendSignal("hangup", signal.callId).catch(() => undefined);
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
          await sendSignal("answer", signal.callId, { answer });
          setStatus("connecting");
        } catch (callError) {
          await sendSignal("hangup", signal.callId).catch(() => undefined);
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
      createPeerConnection,
      recipient,
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
    if (!pusherKey || !pusherCluster) {
      return;
    }

    const pusher = new Pusher(pusherKey, {
      cluster: pusherCluster
    });
    const channel = pusher.subscribe(PUSHER_CHANNEL);

    channel.bind(PUSHER_EVENT_CALL_SIGNAL, (signal: CallSignal) => {
      void receiveSignal(signal);
    });

    return () => {
      channel.unbind(PUSHER_EVENT_CALL_SIGNAL);
      pusher.unsubscribe(PUSHER_CHANNEL);
      pusher.disconnect();
    };
  }, [pusherCluster, pusherKey, receiveSignal]);

  useEffect(() => {
    let isStopped = false;

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

        if (Number.isFinite(latestSignalTime)) {
          lastSignalPollAtRef.current = new Date(latestSignalTime).toISOString();
        }
      } catch {
        // Pusher is still the primary path; polling errors are retried on the next tick.
      }
    }

    void pollSignals();
    const intervalId = window.setInterval(() => void pollSignals(), SIGNAL_POLLING_INTERVAL_MS);

    return () => {
      isStopped = true;
      window.clearInterval(intervalId);
    };
  }, [receiveSignal, sender]);

  useEffect(() => {
    return () => {
      stopRingtone();
      cleanupCall();
    };
  }, [cleanupCall, stopRingtone]);

  const showCallPanel = isPanelOpen || status !== "idle" || Boolean(error);
  const statusText =
    status === "calling"
      ? `正在撥打 ${SENDER_LABEL[recipient]}`
      : status === "ringing"
        ? `${SENDER_LABEL[recipient]} 來電`
        : status === "connecting"
          ? "語音連線中"
          : status === "active"
            ? `與 ${SENDER_LABEL[recipient]} 通話中`
            : error;

  return (
    <>
      <button
        type="button"
        onClick={() => void startCall()}
        disabled={status !== "idle"}
        className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-line text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-4 focus:ring-brand/20"
        aria-label="語音通話"
        title="語音通話"
      >
        <Phone size={17} />
      </button>

      <audio ref={remoteAudioRef} autoPlay playsInline />

      {showCallPanel ? (
        <div className="fixed right-4 top-20 z-[1000] w-[min(calc(100vw-2rem),380px)] rounded-lg border border-line bg-white p-3 shadow-soft">
          <div className="flex items-center gap-3">
            <div
              className={clsx(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-md",
                status === "active" ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-700"
              )}
            >
              <PhoneCall size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink">{statusText}</p>
              {error ? <p className="mt-0.5 text-xs text-red-600">{error}</p> : null}
            </div>
            {status === "idle" ? (
              <button
                type="button"
                onClick={closePanel}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                aria-label="關閉"
              >
                <X size={18} />
              </button>
            ) : null}
          </div>

          {status !== "idle" ? (
            <div className="mt-3 flex justify-end gap-2">
              {status === "ringing" ? (
                <>
                  <button
                    type="button"
                    onClick={() => void rejectCall()}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-red-600 text-white hover:bg-red-700"
                    aria-label="拒接"
                  >
                    <PhoneOff size={18} />
                  </button>
                  <button
                    type="button"
                    onClick={() => void acceptCall()}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-green-600 text-white hover:bg-green-700"
                    aria-label="接聽"
                  >
                    <PhoneCall size={18} />
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={toggleMute}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-line text-slate-700 hover:bg-slate-50"
                    aria-label={isMuted ? "取消靜音" : "靜音"}
                  >
                    {isMuted ? <MicOff size={18} /> : <Mic size={18} />}
                  </button>
                  <button
                    type="button"
                    onClick={() => void hangUp()}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-red-600 text-white hover:bg-red-700"
                    aria-label="掛斷"
                  >
                    <PhoneOff size={18} />
                  </button>
                </>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
