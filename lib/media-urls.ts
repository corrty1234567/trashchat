export function getBlobPathname(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !/^[a-z0-9-]+\.(?:public\.)?blob\.vercel-storage\.com$/i.test(url.hostname)) return null;
    const pathname = url.pathname.slice(1);
    return isMediaPathname(pathname) ? pathname : null;
  } catch {
    return null;
  }
}

export function isMediaPathname(pathname: string) {
  return /^(?:trashchat|chorchat)\/[a-zA-Z0-9_./-]{1,240}$/.test(pathname) &&
    !pathname.split("/").some((part) => part === "." || part === ".." || part === "");
}

export function protectMediaUrl(value: string | null) {
  if (!value) return value;
  const pathname = getBlobPathname(value);
  return pathname ? `/api/media/${Buffer.from(pathname).toString("base64url")}` : value;
}

type MediaFields = { imageUrl: string | null; imageUrls: string[]; thumbnailUrls: string[] };

export function protectMessageMedia<T extends MediaFields>(message: T): T {
  return {
    ...message,
    imageUrl: protectMediaUrl(message.imageUrl),
    imageUrls: message.imageUrls.map((url) => protectMediaUrl(url)!),
    thumbnailUrls: message.thumbnailUrls.map((url) => protectMediaUrl(url)!)
  };
}
