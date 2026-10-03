import type { Message } from "@/lib/types";

export const AUTO_FOLLOW_MESSAGE_LIMIT = 6;
const VIRTUAL_OVERSCAN_PX = 900;

export type VirtualViewport = { scrollTop: number; height: number };
export type MessageLayout = { offsets: number[]; heights: number[]; totalHeight: number };

export function getEstimatedMessageHeight(message: Message) {
  let height = 72;
  if (message.replyTo && !message.recalledAt) height += 52;
  if (message.recalledAt) {
    height += 34;
  } else {
    if (message.text?.trim()) height += Math.min(180, Math.ceil(message.text.trim().length / 42) * 22);
    if ((message.imageUrls?.length ?? 0) > 0 || message.imageUrl) height += 276;
  }
  if ((message.reads?.length ?? 0) > 0) height += 20;
  return height + 16;
}

export function buildMessageLayout(messages: Message[], measuredHeights: ReadonlyMap<string, number>): MessageLayout {
  const offsets: number[] = [];
  const heights: number[] = [];
  let totalHeight = 0;
  for (const message of messages) {
    const height = measuredHeights.get(message.id) ?? getEstimatedMessageHeight(message);
    offsets.push(totalHeight);
    heights.push(height);
    totalHeight += height;
  }
  return { offsets, heights, totalHeight };
}

function findFirstIndex(length: number, matches: (index: number) => boolean) {
  let low = 0;
  let high = length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (matches(middle)) high = middle;
    else low = middle + 1;
  }
  return low;
}

export function getMessagesBelowViewport(layout: MessageLayout, viewportBottom: number) {
  const firstBelow = findFirstIndex(layout.offsets.length, (index) => layout.offsets[index] >= viewportBottom);
  return layout.offsets.length - firstBelow;
}

export function shouldFollowLatest(layout: MessageLayout, viewportBottom: number) {
  return getMessagesBelowViewport(layout, viewportBottom) < AUTO_FOLLOW_MESSAGE_LIMIT;
}

export function buildVirtualMetrics(messages: Message[], layout: MessageLayout, viewport: VirtualViewport, alignToBottom = false) {
  const viewportHeight = viewport.height || 720;
  const scrollTop = alignToBottom ? Math.max(0, layout.totalHeight - viewportHeight) : viewport.scrollTop;
  const startBoundary = Math.max(0, scrollTop - VIRTUAL_OVERSCAN_PX);
  const endBoundary = scrollTop + viewportHeight + VIRTUAL_OVERSCAN_PX;
  const startIndex = Math.min(
    Math.max(0, messages.length - 1),
    findFirstIndex(messages.length, (index) => layout.offsets[index] + layout.heights[index] > startBoundary)
  );
  const endIndex = Math.min(messages.length, findFirstIndex(messages.length, (index) => layout.offsets[index] > endBoundary));
  const rows = messages.slice(startIndex, endIndex).map((message, rowOffset) => ({ message, index: startIndex + rowOffset }));
  const topSpacerHeight = layout.offsets[startIndex] ?? 0;
  const afterVisibleOffset = layout.offsets[endIndex] ?? layout.totalHeight;
  return { rows, topSpacerHeight, bottomSpacerHeight: Math.max(0, layout.totalHeight - afterVisibleOffset) };
}
