import { NextResponse } from "next/server";
import { verifyChatRequest } from "@/lib/chat-auth";
import { getPusherServer } from "@/lib/pusher-server";
import { PUSHER_CHANNEL } from "@/lib/realtime";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!verifyChatRequest(request)) {
    return NextResponse.json({ error: "Website session required." }, { status: 401 });
  }
  const form = new URLSearchParams(await request.text());
  const socketId = form.get("socket_id") ?? "";
  const channel = form.get("channel_name");
  if (!/^\d{1,20}\.\d{1,20}$/.test(socketId) || channel !== PUSHER_CHANNEL) {
    return NextResponse.json({ error: "Channel access denied." }, { status: 403 });
  }
  const pusher = getPusherServer();
  if (!pusher) return NextResponse.json({ error: "Realtime unavailable." }, { status: 503 });
  return NextResponse.json(pusher.authorizeChannel(socketId, channel), {
    headers: { "Cache-Control": "private, no-store" }
  });
}
