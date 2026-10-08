import type { Prisma } from "@prisma/client";
import type { Message } from "@/lib/types";
import { protectMessageMedia } from "@/lib/media-urls";

export const messageReplySelect = {
  id: true,
  sender: true,
  text: true,
  imageUrl: true,
  imageUrls: true,
  thumbnailUrls: true,
  createdAt: true,
  editedAt: true,
  recalledAt: true
} as const;

export const messageInclude = {
  replyTo: { select: messageReplySelect },
  reads: {
    select: {
      id: true,
      messageId: true,
      sender: true,
      readAt: true
    },
    orderBy: { readAt: "asc" }
  }
} as const;

type StoredMessage = Prisma.MessageGetPayload<{ include: typeof messageInclude }>;

export function serializeMessage(message: StoredMessage): Message {
  return {
    ...protectMessageMedia(message),
    createdAt: message.createdAt.toISOString(),
    updatedAt: message.updatedAt.toISOString(),
    editedAt: message.editedAt?.toISOString() ?? null,
    recalledAt: message.recalledAt?.toISOString() ?? null,
    readAt: message.readAt?.toISOString() ?? null,
    reads: message.reads.map((read) => ({ ...read, readAt: read.readAt.toISOString() })),
    replyTo: message.replyTo
      ? {
          ...protectMessageMedia(message.replyTo),
          createdAt: message.replyTo.createdAt.toISOString(),
          editedAt: message.replyTo.editedAt?.toISOString() ?? null,
          recalledAt: message.replyTo.recalledAt?.toISOString() ?? null
        }
      : null
  };
}
