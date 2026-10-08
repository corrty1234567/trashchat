import { NextResponse } from "next/server";
import { z } from "zod";
import { requireChatAccess } from "@/lib/chat-auth";
import { getChatImages } from "@/lib/chat-images";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
const schema = z.object({ beforeCreatedAt: z.string().datetime().optional(), beforeId: z.string().min(1).max(120).optional() })
  .refine(value => Boolean(value.beforeCreatedAt) === Boolean(value.beforeId));

export async function GET(request: Request) {
  const denied = requireChatAccess(request);
  if (denied) return denied;
  const params = new URL(request.url).searchParams;
  const parsed = schema.safeParse({ beforeCreatedAt: params.get("beforeCreatedAt") ?? undefined, beforeId: params.get("beforeId") ?? undefined });
  if (!parsed.success) return NextResponse.json({ error: "Invalid image query." }, { status: 400 });
  const { beforeCreatedAt, beforeId } = parsed.data;
  const messages = await prisma.message.findMany({
    where: { recalledAt: null, AND: [
      { OR: [{ imageUrl: { not: null } }, { imageUrls: { isEmpty: false } }] },
      ...(beforeCreatedAt && beforeId ? [{ OR: [
        { createdAt: { lt: new Date(beforeCreatedAt) } }, { createdAt: new Date(beforeCreatedAt), id: { lt: beforeId } }
      ] }] : [])
    ] }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 31,
    select: { id: true, sender: true, createdAt: true, imageUrl: true, imageUrls: true, thumbnailUrls: true }
  });
  const page = messages.slice(0, 30);
  const last = page.at(-1);
  return NextResponse.json({ images: page.flatMap(getChatImages), hasMore: messages.length > 30,
    nextCursor: last ? { beforeCreatedAt: last.createdAt.toISOString(), beforeId: last.id } : null },
    { headers: { "Cache-Control": "private, no-store" } });
}
