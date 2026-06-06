import { NextResponse } from "next/server";
import { put } from "@vercel/blob";

export const runtime = "nodejs";

const MAX_IMAGE_SIZE = 4 * 1024 * 1024;

function safeFileName(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export async function POST(request: Request) {
  try {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return NextResponse.json(
        { error: "Vercel Blob 尚未設定 BLOB_READ_WRITE_TOKEN，請到 Vercel Storage 建立並連結 Blob store。" },
        { status: 500 }
      );
    }

    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "缺少圖片檔案。" }, { status: 400 });
    }

    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ error: "只能上傳圖片檔案。" }, { status: 400 });
    }

    if (file.size > MAX_IMAGE_SIZE) {
      return NextResponse.json({ error: "圖片太大，請上傳 4MB 以下的圖片。" }, { status: 413 });
    }

    const fileName = safeFileName(file.name) || "image";
    const blob = await put(`trashchat/${crypto.randomUUID()}-${fileName}`, file, {
      access: "public",
      addRandomSuffix: true
    });

    return NextResponse.json({
      url: blob.url
    });
  } catch (error) {
    console.error("Image upload failed", error);

    return NextResponse.json(
      {
        error: error instanceof Error ? `圖片上傳失敗：${error.message}` : "圖片上傳失敗。"
      },
      { status: 500 }
    );
  }
}
