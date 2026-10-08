import type { Sender } from "@/lib/types";

export type CallSignalType =
  | "call-request"
  | "call-accept"
  | "call-reject"
  | "call-connected"
  | "call-heartbeat"
  | "offer"
  | "answer"
  | "ice-candidate"
  | "hangup";

export type CallSignal = {
  id?: string;
  type: CallSignalType;
  callId: string;
  from: Sender;
  to: Sender;
  createdAt?: string;
  payload?: {
    reason?: "missed" | "cancelled" | "failed" | "busy";
    offer?: RTCSessionDescriptionInit;
    answer?: RTCSessionDescriptionInit;
    candidate?: RTCIceCandidateInit;
  };
};

export type CallHistoryStatus = "ringing" | "connecting" | "active" | "completed" | "missed" | "declined" | "cancelled" | "failed" | "busy";

export type CallHistoryEntry = {
  id: string;
  caller: Sender;
  callee: Sender;
  startedAt: string;
  connectedAt: string | null;
  endedAt: string | null;
  status: CallHistoryStatus;
  durationSeconds: number;
};

export function formatCallDuration(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = String(total % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${remainder}` : `${minutes}:${remainder}`;
}
