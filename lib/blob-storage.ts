import { del } from "@vercel/blob";

type MessageWithBlobUrls = {
  imageUrl?: string | null;
  imageUrls?: string[] | null;
  thumbnailUrls?: string[] | null;
};

function isVercelBlobUrl(url: string) {
  try {
    return new URL(url).hostname.endsWith(".blob.vercel-storage.com");
  } catch {
    return false;
  }
}

export function getMessageBlobUrls(message: MessageWithBlobUrls) {
  return [
    message.imageUrl,
    ...(message.imageUrls ?? []),
    ...(message.thumbnailUrls ?? [])
  ].filter((url): url is string => Boolean(url && isVercelBlobUrl(url)));
}

export async function deleteBlobUrls(urls: string[]) {
  const uniqueUrls = [...new Set(urls)].filter(isVercelBlobUrl);

  if (uniqueUrls.length === 0 || (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.VERCEL_OIDC_TOKEN)) {
    return 0;
  }

  try {
    await del(uniqueUrls);
    return uniqueUrls.length;
  } catch (error) {
    console.warn("Blob cleanup failed", error);
    return 0;
  }
}
