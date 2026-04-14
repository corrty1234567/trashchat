import type { Message } from "@/lib/types";
import { truncateText } from "@/lib/time";

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

  if (message.imageUrl) {
    return "圖片";
  }

  return "訊息";
}
