import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_HTML_BYTES = 256 * 1024;
const FETCH_TIMEOUT_MS = 6000;
const PREVIEW_CACHE_CONTROL = "public, s-maxage=86400, stale-while-revalidate=604800";

function isBlockedHost(hostname: string) {
  const normalized = hostname.toLowerCase();

  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "0.0.0.0" ||
    normalized === "::1" ||
    normalized.endsWith(".local")
  );
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getAttribute(tag: string, attribute: string) {
  const pattern = new RegExp(`${escapeRegExp(attribute)}\\s*=\\s*["']([^"']+)["']`, "i");
  return tag.match(pattern)?.[1] ?? null;
}

function findMetaContent(html: string, key: string) {
  const metaTags = html.match(/<meta\b[^>]*>/gi) ?? [];

  for (const tag of metaTags) {
    const property = getAttribute(tag, "property");
    const name = getAttribute(tag, "name");

    if (property?.toLowerCase() === key.toLowerCase() || name?.toLowerCase() === key.toLowerCase()) {
      const content = getAttribute(tag, "content");

      if (content) {
        return decodeHtml(content);
      }
    }
  }

  return null;
}

function findTitle(html: string) {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return title ? decodeHtml(title.replace(/\s+/g, " ")) : null;
}

async function readLimitedText(response: Response) {
  const reader = response.body?.getReader();

  if (!reader) {
    return response.text();
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (totalBytes < MAX_HTML_BYTES) {
    const { done, value } = await reader.read();

    if (done || !value) {
      break;
    }

    const nextChunk = value.slice(0, Math.max(0, MAX_HTML_BYTES - totalBytes));
    chunks.push(nextChunk);
    totalBytes += nextChunk.byteLength;

    if (value.byteLength > nextChunk.byteLength) {
      break;
    }
  }

  return new TextDecoder().decode(Buffer.concat(chunks));
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const target = requestUrl.searchParams.get("url");

  if (!target) {
    return NextResponse.json({ error: "Missing url." }, { status: 400 });
  }

  let url: URL;

  try {
    url = new URL(target);
  } catch {
    return NextResponse.json({ error: "Invalid url." }, { status: 400 });
  }

  if (!["http:", "https:"].includes(url.protocol) || isBlockedHost(url.hostname)) {
    return NextResponse.json({ error: "Unsupported url." }, { status: 400 });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "chorchat-link-preview/1.0",
        Accept: "text/html,application/xhtml+xml"
      },
      redirect: "follow",
      signal: controller.signal
    });

    if (!response.ok) {
      return NextResponse.json({ error: "Preview unavailable." }, { status: 404 });
    }

    const contentType = response.headers.get("content-type") ?? "";

    if (!contentType.includes("text/html")) {
      return NextResponse.json({ error: "Preview unavailable." }, { status: 404 });
    }

    const html = await readLimitedText(response);
    const title = findMetaContent(html, "og:title") ?? findMetaContent(html, "twitter:title") ?? findTitle(html);
    const description = findMetaContent(html, "og:description") ?? findMetaContent(html, "description");
    const rawImage = findMetaContent(html, "og:image") ?? findMetaContent(html, "twitter:image");
    const siteName = findMetaContent(html, "og:site_name") ?? url.hostname.replace(/^www\./, "");
    const image = rawImage ? new URL(rawImage, url).href : null;

    if (!title && !description && !image) {
      return NextResponse.json({ error: "Preview unavailable." }, { status: 404 });
    }

    return NextResponse.json(
      {
        url: url.href,
        title,
        description,
        image,
        siteName
      },
      {
        headers: {
          "Cache-Control": PREVIEW_CACHE_CONTROL
        }
      }
    );
  } catch (error) {
    console.error("Link preview failed", error);
    return NextResponse.json({ error: "Preview unavailable." }, { status: 404 });
  } finally {
    clearTimeout(timeoutId);
  }
}
