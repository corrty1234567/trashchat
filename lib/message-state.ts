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

function sameUrls(first: readonly string[], second: readonly string[]) {
  return first.length === second.length && first.every((url, index) => url === second[index]);
}

function sameReply(first: Message["replyTo"], second: Message["replyTo"]) {
  if (first === second) return true;
  if (!first || !second) return !first && !second;
  return first.id === second.id && first.sender === second.sender && first.text === second.text &&
    first.createdAt === second.createdAt && first.editedAt === second.editedAt && first.recalledAt === second.recalledAt &&
    first.imageUrl === second.imageUrl && sameUrls(first.imageUrls ?? [], second.imageUrls ?? []) &&
    sameUrls(first.thumbnailUrls ?? [], second.thumbnailUrls ?? []);
}

function sameMessage(first: Message, second: Message) {
  return first.id === second.id && first.sender === second.sender && first.text === second.text &&
    first.createdAt === second.createdAt && first.updatedAt === second.updatedAt && first.editedAt === second.editedAt &&
    first.recalledAt === second.recalledAt && first.readAt === second.readAt && first.clientStatus === second.clientStatus &&
    first.replyToMessageId === second.replyToMessageId && sameReply(first.replyTo, second.replyTo) &&
    first.imageUrl === second.imageUrl && sameUrls(first.imageUrls ?? [], second.imageUrls ?? []) &&
    sameUrls(first.thumbnailUrls ?? [], second.thumbnailUrls ?? []) && first.reads.length === second.reads.length &&
    first.reads.every((read, index) => {
      const other = second.reads[index];
      return read.id === other.id && read.sender === other.sender && read.readAt === other.readAt;
    });
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
    const merged = {
      ...newest,
      readAt: newest.readAt ?? current.readAt ?? message.readAt,
      reads: [...readsBySender.values()]
    };
    messagesById.set(message.id, sameMessage(current, merged) ? current : merged);
  });

  const messages = [...messagesById.values()].map((message) => {
    const reply = message.replyTo;
    const target = reply ? messagesById.get(reply.id) : undefined;
    const replyChangedAt = reply
      ? Math.max(Date.parse(reply.createdAt), Date.parse(reply.editedAt ?? reply.createdAt), Date.parse(reply.recalledAt ?? reply.createdAt))
      : 0;

    if (target && Date.parse(target.updatedAt) >= replyChangedAt) {
      const replyTo = toReplyMessage(target);
      if (!sameReply(reply, replyTo)) return { ...message, replyTo };
    }
    return message;
  });
  // Unchanged health checks should not rerender or remeasure the entire history.
  if (messages.length === currentMessages.length && messages.every((message, index) => message === currentMessages[index])) {
    return currentMessages;
  }
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
