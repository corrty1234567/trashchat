import { NextResponse } from "next/server";
import { list } from "@vercel/blob";
import { requireAdmin } from "@/lib/admin-auth";
import { formatBytes } from "@/lib/format-bytes";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const adminError = requireAdmin(request);

  if (adminError) {
    return adminError;
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.VERCEL_OIDC_TOKEN) {
    return NextResponse.json({ error: "Blob storage is not configured." }, { status: 500 });
  }

  let cursor: string | undefined;
  let bytes = 0;
  let count = 0;

  do {
    const page = await list({
      prefix: "trashchat/",
      limit: 1000,
      cursor
    });

    for (const blob of page.blobs) {
      bytes += Number(blob.size ?? 0);
    }

    count += page.blobs.length;
    cursor = page.cursor;
  } while (cursor);

  return NextResponse.json(
    {
      bytes,
      formatted: formatBytes(bytes),
      count
    },
    {
      headers: {
        "Cache-Control": "no-store"
      }
    }
  );
}
