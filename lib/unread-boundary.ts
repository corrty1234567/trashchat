import type { Message, Sender } from "@/lib/types";

export type UnreadBoundary = { id: string; createdAt: string };

export function findUnreadBoundary(messages: readonly Message[], sender: Sender, current: UnreadBoundary | null = null): UnreadBoundary | null {
  let boundary = current;
  for (const message of messages) {
    if (message.sender === sender || message.clientStatus || message.recalledAt || (message.reads ?? []).some(read => read.sender === sender)) continue;
    if (!boundary || message.createdAt < boundary.createdAt || (message.createdAt === boundary.createdAt && message.id < boundary.id)) {
      boundary = { id: message.id, createdAt: message.createdAt };
    }
  }
  return boundary;
}
