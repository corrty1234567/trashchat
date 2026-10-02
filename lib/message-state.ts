import type { Message, Sender } from "@/lib/types";

export function sortMessagesByCreatedAt(messages: Message[]) {
  return [...messages].sort((first, second) => {
    const timeDifference = Date.parse(first.createdAt) - Date.parse(second.createdAt);
    return timeDifference || first.id.localeCompare(second.id);
  });
}

export function toReplyMessage(message: Message): Message["replyTo"] {
  return {
    id: message.id,
    sender: message.sender,
    text: message.text,
    imageUrl: message.imageUrl,
    imageUrls: message.imageUrls ?? [],
    thumbnailUrls: message.thumbnailUrls ?? [],
    createdAt: message.createdAt,
    editedAt: message.editedAt,
    recalledAt: message.recalledAt
  };
}

export function mergeLoadedMessages(currentMessages: Message[], loadedMessages: Message[], optimisticId?: string) {
  const messagesById = new Map(
    currentMessages.filter((message) => message.id !== optimisticId).map((message) => [message.id, message])
  );

  loadedMessages.forEach((message) => {
    const current = messagesById.get(message.id);

    if (!current) {
      messagesById.set(message.id, message);
      return;
    }

    // HTTP snapshots can finish after a newer WebSocket update or read receipt.
    const newest = Date.parse(current.updatedAt) > Date.parse(message.updatedAt) ? current : message;
    const readsBySender = new Map((current.reads ?? []).map((read) => [read.sender, read]));
    (message.reads ?? []).forEach((read) => readsBySender.set(read.sender, read));
    messagesById.set(message.id, {
      ...newest,
      readAt: newest.readAt ?? current.readAt ?? message.readAt,
      reads: [...readsBySender.values()]
    });
  });

  const messages = [...messagesById.values()].map((message) => {
    const reply = message.replyTo;
    const target = reply ? messagesById.get(reply.id) : undefined;
    const replyChangedAt = reply
      ? Math.max(Date.parse(reply.createdAt), Date.parse(reply.editedAt ?? reply.createdAt), Date.parse(reply.recalledAt ?? reply.createdAt))
      : 0;

    return target && Date.parse(target.updatedAt) >= replyChangedAt
      ? { ...message, replyTo: toReplyMessage(target) }
      : message;
  });
  return sortMessagesByCreatedAt(messages);
}

export function applyReadReceipts(messages: Message[], messageIds: readonly string[], sender: Sender, readAt: string) {
  const readMessageIds = new Set(messageIds);

  return messages.map((message) => {
    if (!readMessageIds.has(message.id) || (message.reads ?? []).some((read) => read.sender === sender)) {
      return message;
    }

    return {
      ...message,
      readAt: message.readAt ?? readAt,
      reads: [...(message.reads ?? []), { id: `realtime-read-${message.id}-${sender}`, messageId: message.id, sender, readAt }]
    };
  });
}
