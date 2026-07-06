import { NextResponse } from "next/server";
import { z } from "zod";
import { PUSHER_EVENT_TYPING_CHANGED } from "@/lib/realtime";
import { memberExists } from "@/lib/members";
import { triggerRealtimeEvent } from "@/lib/pusher-server";

export const runtime = "nodejs";

const typingSchema = z.object({
  sender: z.string().trim().min(1).max(120),
  isTyping: z.boolean()
});

export async function POST(request: Request) {
  const parsed = typingSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  if (!(await memberExists(parsed.data.sender))) {
    return NextResponse.json({ error: "Sender does not exist." }, { status: 400 });
  }

  await triggerRealtimeEvent(PUSHER_EVENT_TYPING_CHANGED, parsed.data);

  return NextResponse.json({ ok: true });
}
