import { NextResponse } from "next/server";
import { requireChatAccess } from "@/lib/chat-auth";
import { z } from "zod";
import { isValidAdminCode, setAdminSessionCookie } from "@/lib/admin-auth";

export const runtime = "nodejs";

const adminSessionSchema = z.object({
  code: z.string().trim().min(1)
});

export async function POST(request: Request) {
  const accessError = requireChatAccess(request);
  if (accessError) return accessError;
  const parsed = adminSessionSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success || !isValidAdminCode(parsed.data.code)) {
    return NextResponse.json({ error: "Invalid admin code." }, { status: 403 });
  }

  return setAdminSessionCookie(NextResponse.json({ ok: true }));
}
