import { Agent } from "node:https";
import { createHmac } from "node:crypto";
import Pusher from "pusher";
import { isChatAuthConfigured } from "@/lib/chat-auth";
import { getServerDataKey } from "@/lib/server-data-key";
import { PUSHER_CHANNEL, PUSHER_EVENT_MESSAGES_CHANGED, type MessageChangedEvent } from "@/lib/realtime";

let pusherServer: Pusher | null = null;
const MAX_MESSAGE_EVENT_BYTES = 7000;

export function getPusherServer() {
  const appId = process.env.PUSHER_APP_ID;
  const key = process.env.NEXT_PUBLIC_PUSHER_KEY;
  const secret = process.env.PUSHER_SECRET;
  const cluster = process.env.PUSHER_CLUSTER ?? process.env.NEXT_PUBLIC_PUSHER_CLUSTER;

  if (!appId || !key || !secret || !cluster || !isChatAuthConfigured()) {
    return null;
  }

  let encryptionMasterKeyBase64: string;
  try {
    // A password change also revokes the ability of already-connected clients to decrypt new events.
    encryptionMasterKeyBase64 = createHmac("sha256", getServerDataKey())
      .update(`trashchat-realtime-v1:${process.env.TRASHCHAT_AUTH_USER || "trashchat"}:${process.env.TRASHCHAT_AUTH_PASSWORD}`)
      .digest("base64");
  } catch {
    return null;
  }

  pusherServer ??= new Pusher({
    appId,
    key,
    secret,
    cluster,
    useTLS: true,
    encryptionMasterKeyBase64,
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
    // Reserve space for encryption's base64 overhead within Pusher's 10 KB limit.
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
