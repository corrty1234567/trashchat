import { NextResponse } from "next/server";
import { z } from "zod";
import { PUSHER_EVENT_TYPING_CHANGED } from "@/lib/realtime";
import { triggerRealtimeEvent } from "@/lib/pusher-server";

export const runtime = "nodejs";

const typingSchema = z.object({
  sender: z.enum(["CHEN", "ZUO"]),
  isTyping: z.boolean()
});

export async function POST(request: Request) {
  const parsed = typingSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  await triggerRealtimeEvent(PUSHER_EVENT_TYPING_CHANGED, parsed.data);

  return NextResponse.json({ ok: true });
}
