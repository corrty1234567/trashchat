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
  type: CallSignalType;
  callId: string;
  from: Sender;
  to: Sender;
  payload?: {
    offer?: RTCSessionDescriptionInit;
    answer?: RTCSessionDescriptionInit;
    candidate?: RTCIceCandidateInit;
  };
};
