import { NextResponse } from "next/server";
import { z } from "zod";
import { PUSHER_EVENT_CALL_SIGNAL } from "@/lib/realtime";
import { triggerRealtimeEvent } from "@/lib/pusher-server";

export const runtime = "nodejs";

const callSignalSchema = z.object({
  type: z.enum(["call-request", "call-accept", "call-reject", "offer", "answer", "ice-candidate", "hangup"]),
  callId: z.string().min(8).max(120),
  from: z.enum(["CHEN", "ZUO"]),
  to: z.enum(["CHEN", "ZUO"]),
  payload: z.unknown().optional()
});

export async function POST(request: Request) {
  const parsed = callSignalSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  if (parsed.data.from === parsed.data.to) {
    return NextResponse.json({ error: "Caller and recipient must be different." }, { status: 400 });
  }

  await triggerRealtimeEvent(PUSHER_EVENT_CALL_SIGNAL, parsed.data);

  return NextResponse.json({ ok: true });
}
