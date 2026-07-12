import type { Message } from "@/lib/types";
import { truncateText } from "@/lib/time";

export function getMessageImageUrls(message: Pick<Message, "imageUrl" | "imageUrls"> | Message["replyTo"]) {
  if (!message) {
    return [];
  }

  if (message.imageUrls?.length) {
    return message.imageUrls;
  }

  return message.imageUrl ? [message.imageUrl] : [];
}

export function getMessageThumbnailUrls(
  message: Pick<Message, "imageUrl" | "imageUrls" | "thumbnailUrls"> | Message["replyTo"]
) {
  if (!message) {
    return [];
  }

  if (message.thumbnailUrls?.length) {
    return message.thumbnailUrls;
  }

  return getMessageImageUrls(message);
}

export function getReplyPreview(message: Message["replyTo"]) {
  if (!message) {
    return "原訊息不存在";
  }

  if (message.recalledAt) {
    return "已收回的訊息";
  }

  if (message.text?.trim()) {
    return truncateText(message.text.trim(), 20);
  }

  const imageCount = getMessageImageUrls(message).length;

  if (imageCount > 1) {
    return `${imageCount} 張圖片`;
  }

  if (imageCount === 1) {
    return "圖片";
  }

  return "訊息";
}
