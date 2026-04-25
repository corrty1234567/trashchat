import type { Sender } from "@/lib/types";

export type CallSignalType =
  | "call-request"
  | "call-accept"
  | "call-reject"
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
    offer?: RTCSessionDescriptionInit;
    answer?: RTCSessionDescriptionInit;
    candidate?: RTCIceCandidateInit;
  };
};
