export const MAX_DOWNLOAD_IMAGES = 30;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 80 * 1024 * 1024;
export type DownloadImage = { url: string; id?: string; createdAt?: string };
export type DownloadProgress = { completed: number; total: number; phase: "fetching" | "packing" };

export function imageExtension(contentType: string) {
  const mime = contentType.toLowerCase().split(";")[0].trim();
  const extensions: Record<string, string> = { "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png",
    "image/webp": "webp", "image/gif": "gif", "image/avif": "avif", "image/svg+xml": "svg",
    "image/bmp": "bmp", "image/tiff": "tiff", "image/heic": "heic", "image/heif": "heif" };
  if (!mime.startsWith("image/")) throw new Error("圖片已失效或無法下載。");
  return extensions[mime] || "img";
}

export function imageFilename(image: DownloadImage, extension: string, index = 0) {
  const stamp = image.createdAt && Number.isFinite(Date.parse(image.createdAt))
    ? new Date(image.createdAt).toISOString().slice(0, 19).replace(/[:T]/g, "-") : "image";
  const id = (image.id || String(index + 1)).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
  return `trashchat-${stamp}-${id}.${extension}`;
}

async function fetchImage(image: DownloadImage, signal: AbortSignal, onBytes: (bytes: number) => void) {
  const url = new URL(image.url, window.location.origin);
  if (url.origin !== window.location.origin || !/^\/api\/media\/[a-zA-Z0-9_-]+$/.test(url.pathname)) {
    throw new Error("這張圖片沒有可用的安全下載連結。");
  }
  const response = await fetch(url, { credentials: "same-origin", cache: "no-store", signal, redirect: "error" });
  if (!response.ok) throw new Error("圖片下載失敗，請重新整理後再試。");
  const type = response.headers.get("content-type") || "";
  const extension = imageExtension(type);
  if (Number(response.headers.get("content-length")) > MAX_IMAGE_BYTES) throw new Error("單張圖片超過下載大小限制。");
  const reader = response.body?.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    if (reader) {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > MAX_IMAGE_BYTES) throw new Error("單張圖片超過下載大小限制。");
        onBytes(chunk.value.byteLength);
        chunks.push(new Uint8Array(chunk.value));
      }
    } else {
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > MAX_IMAGE_BYTES) throw new Error("單張圖片超過下載大小限制。");
      onBytes(buffer.byteLength);
      chunks.push(new Uint8Array(buffer));
    }
  } catch (error) {
    await reader?.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader?.releaseLock();
  }
  const blob = new Blob(chunks, { type });
  if (!blob.size) throw new Error("圖片檔案是空的。");
  return { blob, extension };
}

export function saveDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function downloadSingleImage(image: DownloadImage, signal: AbortSignal) {
  const { blob, extension } = await fetchImage(image, signal, () => undefined);
  signal.throwIfAborted();
  saveDownload(blob, imageFilename(image, extension));
}

export async function downloadImageArchive(images: readonly DownloadImage[], signal: AbortSignal, onProgress: (progress: DownloadProgress) => void) {
  const unique = [...new Map(images.map(image => [image.url, image])).values()];
  if (!unique.length || unique.length > MAX_DOWNLOAD_IMAGES) throw new Error(`每次請選擇 1 至 ${MAX_DOWNLOAD_IMAGES} 張圖片。`);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) controller.abort();
  const files: Record<string, Uint8Array<ArrayBuffer>> = {};
  let nextIndex = 0;
  let completed = 0;
  let totalBytes = 0;
  onProgress({ completed, total: unique.length, phase: "fetching" });
  try {
    const worker = async () => {
      while (nextIndex < unique.length) {
        const index = nextIndex++;
        const image = unique[index];
        const { blob, extension } = await fetchImage(image, controller.signal, bytes => {
          totalBytes += bytes;
          if (totalBytes > MAX_ARCHIVE_BYTES) throw new Error("圖片總大小超過 80 MB，請減少選取數量。");
        });
        files[`${String(index + 1).padStart(2, "0")}-${imageFilename(image, extension, index)}`] = new Uint8Array(await blob.arrayBuffer());
        onProgress({ completed: ++completed, total: unique.length, phase: "fetching" });
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, unique.length) }, worker));
    controller.signal.throwIfAborted();
    onProgress({ completed, total: unique.length, phase: "packing" });
    const { zip } = await import("fflate");
    const zipped = await new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => {
      let terminate = () => undefined as void;
      const stop = () => { terminate(); reject(new DOMException("Cancelled", "AbortError")); };
      if (controller.signal.aborted) return stop();
      controller.signal.addEventListener("abort", stop, { once: true });
      // Images are already compressed; store them losslessly without recompression.
      terminate = zip(files, { level: 0 }, (error, data) => {
        controller.signal.removeEventListener("abort", stop);
        if (error) reject(error);
        else resolve(new Uint8Array(data));
      });
    });
    controller.signal.throwIfAborted();
    saveDownload(new Blob([zipped], { type: "application/zip" }), `trashchat-photos-${new Date().toISOString().slice(0, 10)}.zip`);
  } catch (error) {
    controller.abort();
    throw error;
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
