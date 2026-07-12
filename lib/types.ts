export const SENDER_VALUES = ["CHEN", "ZUO", "SEVENTEEN"] as const;

export const DEFAULT_MEMBERS = [
  { id: "CHEN", name: "10", isProtected: true },
  { id: "ZUO", name: "27", isProtected: true },
  { id: "SEVENTEEN", name: "17", isProtected: true }
] as const;

export type Sender = string;

export type Member = {
  id: Sender;
  name: string;
  isProtected: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type Message = {
  id: string;
  sender: Sender;
  text: string | null;
  imageUrl: string | null;
  imageUrls: string[];
  thumbnailUrls: string[];
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
  thumbnailUrls: string[];
  createdAt: string;
  editedAt: string | null;
  recalledAt: string | null;
};

export const SENDER_LABEL: Record<string, string> = DEFAULT_MEMBERS.reduce(
  (labels, member) => ({
    ...labels,
    [member.id]: member.name
  }),
  {} as Record<string, string>
);

export function getSenderLabel(sender: Sender, members: readonly Member[] = DEFAULT_MEMBERS): string {
  return members.find((member) => member.id === sender)?.name ?? SENDER_LABEL[sender] ?? sender;
}

export function isProtectedSender(sender: Sender) {
  return DEFAULT_MEMBERS.some((member) => member.id === sender);
}

export function isSender(value: unknown): value is Sender {
  return typeof value === "string" && value.trim().length > 0;
}
