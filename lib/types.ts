export const SENDER_VALUES = ["CHEN", "ZUO", "SEVENTEEN"] as const;

export type Sender = (typeof SENDER_VALUES)[number];

export type Message = {
  id: string;
  sender: Sender;
  text: string | null;
  imageUrl: string | null;
  imageUrls: string[];
  createdAt: string;
  updatedAt: string;
  editedAt: string | null;
  recalledAt: string | null;
  readAt: string | null;
  replyToMessageId: string | null;
  reads: MessageRead[];
  replyTo?: ReplyMessage | null;
  clientStatus?: "sending" | "failed";
};

export type MessageRead = {
  id: string;
  messageId: string;
  sender: Sender;
  readAt: string;
};

export type ReplyMessage = {
  id: string;
  sender: Sender;
  text: string | null;
  imageUrl: string | null;
  imageUrls: string[];
  createdAt: string;
  editedAt: string | null;
  recalledAt: string | null;
};

export const SENDER_LABEL: Record<Sender, string> = {
  CHEN: "10",
  ZUO: "27",
  SEVENTEEN: "17"
};

export function isSender(value: unknown): value is Sender {
  return SENDER_VALUES.includes(value as Sender);
}
