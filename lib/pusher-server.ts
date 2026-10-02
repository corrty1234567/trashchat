import { Agent } from "node:https";
import Pusher from "pusher";
import { PUSHER_CHANNEL, PUSHER_EVENT_MESSAGES_CHANGED, type MessageChangedEvent } from "@/lib/realtime";

let pusherServer: Pusher | null = null;
const MAX_MESSAGE_EVENT_BYTES = 9500;

function getPusherServer() {
  const appId = process.env.PUSHER_APP_ID;
  const key = process.env.NEXT_PUBLIC_PUSHER_KEY;
  const secret = process.env.PUSHER_SECRET;
  const cluster = process.env.PUSHER_CLUSTER ?? process.env.NEXT_PUBLIC_PUSHER_CLUSTER;

  if (!appId || !key || !secret || !cluster) {
    return null;
  }

  pusherServer ??= new Pusher({
    appId,
    key,
    secret,
    cluster,
    useTLS: true,
    agent: new Agent({ keepAlive: true }),
    timeout: 5000
  });

  return pusherServer;
}

export function hasRealtimeMessaging() {
  return getPusherServer() !== null;
}

export async function notifyMessagesChanged(payload: MessageChangedEvent) {
  try {
    // Pusher limits event data to 10 KB; large messages use a targeted HTTP fetch.
    const eventPayload = { ...payload };
    if (Buffer.byteLength(JSON.stringify(payload), "utf8") > MAX_MESSAGE_EVENT_BYTES) {
      delete eventPayload.message;
    }
    await triggerRealtimeEvent(PUSHER_EVENT_MESSAGES_CHANGED, eventPayload);
  } catch (error) {
    console.error("Message realtime notification failed", error);
  }
}

export async function triggerRealtimeEvent(eventName: string, payload: Record<string, unknown>) {
  const pusher = getPusherServer();

  if (!pusher) {
    return false;
  }

  await pusher.trigger(PUSHER_CHANNEL, eventName, {
    ...payload,
    at: new Date().toISOString()
  });

  return true;
}
