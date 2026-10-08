import { protectMediaUrl } from "@/lib/media-urls";

export type ChatImage = { id: string; messageId: string; sender: string; createdAt: string; url: string; thumbnailUrl: string };
export type ImagePage = { images: ChatImage[]; hasMore: boolean; nextCursor: { beforeCreatedAt: string; beforeId: string } | null };

export function getChatImages(message: { id: string; sender: string; createdAt: Date; imageUrl: string | null; imageUrls: string[]; thumbnailUrls: string[] }): ChatImage[] {
  const urls = message.imageUrls.length ? message.imageUrls : message.imageUrl ? [message.imageUrl] : [];
  return urls.flatMap((url, index) => {
    const protectedUrl = protectMediaUrl(url);
    if (!protectedUrl?.startsWith("/api/media/")) return [];
    const thumbnail = protectMediaUrl(message.thumbnailUrls[index] || url);
    return [{ id: `${message.id}-${index}`, messageId: message.id, sender: message.sender,
      createdAt: message.createdAt.toISOString(), url: protectedUrl,
      thumbnailUrl: thumbnail?.startsWith("/api/media/") ? thumbnail : protectedUrl }];
  });
}
