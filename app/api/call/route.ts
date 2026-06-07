import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { PUSHER_EVENT_CALL_SIGNAL } from "@/lib/realtime";
import { triggerRealtimeEvent } from "@/lib/pusher-server";
import { SENDER_VALUES, type Sender } from "@/lib/types";

export const runtime = "nodejs";

const callSignalSchema = z.object({
  type: z.enum(["call-request", "call-accept", "call-reject", "offer", "answer", "ice-candidate", "hangup"]),
  callId: z.string().min(8).max(120),
  from: z.enum(SENDER_VALUES),
  to: z.enum(SENDER_VALUES),
  payload: z.unknown().optional()
});

const getCallSignalsSchema = z.object({
  to: z.enum(SENDER_VALUES),
  since: z.string().datetime().optional()
});

function toJsonPayload(payload: unknown) {
  if (payload === undefined) {
    return undefined;
  }

  return JSON.parse(JSON.stringify(payload)) as Prisma.InputJsonValue;
}

function serializeSignal(signal: {
  id: string;
  type: string;
  callId: string;
  from: Sender;
  to: Sender;
  payload: Prisma.JsonValue | null;
  createdAt: Date;
}) {
  return {
    id: signal.id,
    type: signal.type,
    callId: signal.callId,
    from: signal.from,
    to: signal.to,
    payload: signal.payload ?? undefined,
    createdAt: signal.createdAt.toISOString()
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const parsed = getCallSignalsSchema.safeParse({
    to: searchParams.get("to"),
    since: searchParams.get("since") ?? undefined
  });

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const since = parsed.data.since ? new Date(parsed.data.since) : new Date(Date.now() - 10_000);
  const signals = await prisma.callSignal.findMany({
    where: {
      to: parsed.data.to,
      createdAt: {
        gt: since
      }
    },
    orderBy: {
      createdAt: "asc"
    },
    take: 100
  });

  return NextResponse.json({
    signals: signals.map(serializeSignal)
  });
}

export async function POST(request: Request) {
  const parsed = callSignalSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  if (parsed.data.from === parsed.data.to) {
    return NextResponse.json({ error: "Caller and recipient must be different." }, { status: 400 });
  }

  const payload = toJsonPayload(parsed.data.payload);
  const signal = await prisma.callSignal.create({
    data: {
      type: parsed.data.type,
      callId: parsed.data.callId,
      from: parsed.data.from,
      to: parsed.data.to,
      ...(payload === undefined ? {} : { payload })
    }
  });
  const serializedSignal = serializeSignal(signal);
  let didTrigger = false;

  try {
    didTrigger = await triggerRealtimeEvent(PUSHER_EVENT_CALL_SIGNAL, serializedSignal);
  } catch (error) {
    console.error("Call signal failed", error);
  }

  if (Math.random() < 0.03) {
    void prisma.callSignal
      .deleteMany({
        where: {
          createdAt: {
            lt: new Date(Date.now() - 60 * 60 * 1000)
          }
        }
      })
      .catch((error) => console.error("Old call signal cleanup failed", error));
  }

  return NextResponse.json({ ok: true, realtime: didTrigger, signal: serializedSignal });
}
