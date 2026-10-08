import type { Message, Sender } from "@/lib/types";

export const PUSHER_CHANNEL = "private-encrypted-trashchat-main";
export const PUSHER_AUTH_ENDPOINT = "/api/realtime/auth";
export const PUSHER_EVENT_MESSAGES_CHANGED = "messages:changed";
export const PUSHER_EVENT_TYPING_CHANGED = "typing:changed";
export const PUSHER_EVENT_CALL_SIGNAL = "call:signal";

export type MessageChangedEvent = {
  type: "created" | "edited" | "recalled" | "read";
  id?: string;
  sender?: Sender;
  message?: Message;
  clientRequestId?: string;
  messageIds?: string[];
  readAt?: string;
};
