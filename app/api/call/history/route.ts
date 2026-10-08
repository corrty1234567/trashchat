import { NextResponse } from "next/server";
import { z } from "zod";
import { requireChatAccess } from "@/lib/chat-auth";
import { serializeCallRecord } from "@/lib/call-history";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
const schema = z.object({
  sender: z.string().trim().min(1).max(120),
  beforeStartedAt: z.string().datetime().optional(), beforeId: z.string().min(1).max(120).optional()
}).refine(value => Boolean(value.beforeStartedAt) === Boolean(value.beforeId));

export async function GET(request: Request) {
  const denied = requireChatAccess(request);
  if (denied) return denied;
  const params = new URL(request.url).searchParams;
  const parsed = schema.safeParse({ sender: params.get("sender"),
    beforeStartedAt: params.get("beforeStartedAt") ?? undefined, beforeId: params.get("beforeId") ?? undefined });
  if (!parsed.success) return NextResponse.json({ error: "Invalid history query." }, { status: 400 });
  const { sender, beforeStartedAt, beforeId } = parsed.data;
  try {
    const records = await prisma.callRecord.findMany({
      where: { AND: [
        { OR: [{ caller: sender }, { callee: sender }] },
        ...(beforeStartedAt && beforeId ? [{ OR: [
          { startedAt: { lt: new Date(beforeStartedAt) } },
          { startedAt: new Date(beforeStartedAt), id: { lt: beforeId } }
        ] }] : [])
      ] }, orderBy: [{ startedAt: "desc" }, { id: "desc" }], take: 31
    });
    const calls = records.slice(0, 30).map(record => serializeCallRecord(record));
    const last = calls.at(-1);
    return NextResponse.json({ calls, hasMore: records.length > 30,
      nextCursor: last ? { beforeStartedAt: last.startedAt, beforeId: last.id } : null },
      { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Call history unavailable", error);
    return NextResponse.json({ error: "通話紀錄暫時無法載入，請確認資料庫已更新。" }, { status: 503 });
  }
}
