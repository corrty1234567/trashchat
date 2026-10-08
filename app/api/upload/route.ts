import { NextResponse } from "next/server";
import { requireChatAccess } from "@/lib/chat-auth";
import { put } from "@vercel/blob";
import { encryptMedia } from "@/lib/media-crypto";

export const runtime = "nodejs";

const MAX_IMAGE_SIZE = 4 * 1024 * 1024;

export async function POST(request: Request) {
  const accessError = requireChatAccess(request);
  if (accessError) return accessError;
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

    const encrypted = encryptMedia(new Uint8Array(await file.arrayBuffer()), file.type);
    const blob = await put(`trashchat/sealed/${crypto.randomUUID()}.bin`, encrypted, {
      access: "public",
      addRandomSuffix: true,
      contentType: "application/octet-stream",
      cacheControlMaxAge: 60
    });

    return NextResponse.json({
      url: blob.url
    });
  } catch (error) {
    console.error("Image upload failed", error);

    return NextResponse.json(
      {
        error: "圖片上傳失敗，請確認伺服器的圖片儲存設定。"
      },
      { status: 500 }
    );
  }
}
