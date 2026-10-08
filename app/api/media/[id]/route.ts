import { get } from "@vercel/blob";
import { verifyChatRequest } from "@/lib/chat-auth";
import { decryptMedia, MAX_MEDIA_BYTES } from "@/lib/media-crypto";
import { isMediaPathname } from "@/lib/media-urls";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!verifyChatRequest(request)) return new Response("Website session required.", { status: 401 });
  const { id } = await context.params;
  if (!/^[a-zA-Z0-9_-]{1,400}$/.test(id)) return new Response("Not found.", { status: 404 });
  const pathname = Buffer.from(id, "base64url").toString("utf8");
  if (!isMediaPathname(pathname)) return new Response("Not found.", { status: 404 });

  try {
    // Resolve only within our own store, never a client-supplied remote host.
    const blob = await get(pathname, { access: "public" });
    if (!blob || blob.statusCode !== 200 || blob.blob.size > MAX_MEDIA_BYTES + 128) {
      return new Response("Not found.", { status: 404 });
    }
    const headers = {
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Security-Policy": "sandbox; default-src 'none'",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Referrer-Policy": "no-referrer"
    };
    if (pathname.startsWith("trashchat/sealed/")) {
      const encrypted = await new Response(blob.stream).arrayBuffer();
      const image = decryptMedia(new Uint8Array(encrypted));
      let offset = 0;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (offset >= image.content.length) {
            controller.close();
            return;
          }
          controller.enqueue(image.content.subarray(offset, offset + 64 * 1024));
          offset += 64 * 1024;
        }
      });
      return new Response(stream, {
        headers: { ...headers, "Content-Type": image.contentType }
      });
    }
    // Existing images remain viewable while the one-time migration is running.
    if (!/^image\/[a-z0-9.+-]+$/i.test(blob.blob.contentType)) return new Response("Not found.", { status: 404 });
    return new Response(blob.stream, { headers: { ...headers, "Content-Type": blob.blob.contentType } });
  } catch {
    return new Response("Image unavailable.", { status: 404 });
  }
}
