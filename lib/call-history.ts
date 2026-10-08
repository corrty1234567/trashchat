import type { CallRecord, Prisma } from "@prisma/client";
import type { CallHistoryEntry, CallHistoryStatus, CallSignal } from "@/lib/call";

const RING_EXPIRY_MS = 60_000;
const CONNECTION_EXPIRY_MS = 90_000;
const HISTORY_TYPES = new Set(["call-request", "call-accept", "call-connected", "call-heartbeat", "call-reject", "hangup"]);

export class CallHistoryError extends Error {}

export function isCallHistorySignal(type: string) { return HISTORY_TYPES.has(type); }

export async function recordCallSignal(db: Prisma.TransactionClient, signal: CallSignal, now = new Date()) {
  if (!HISTORY_TYPES.has(signal.type)) return;
  const record = signal.type === "call-request"
    ? await db.callRecord.upsert({
        where: { id: signal.callId }, update: {},
        create: { id: signal.callId, caller: signal.from, callee: signal.to, startedAt: now, lastSeenAt: now }
      })
    : await db.callRecord.findUnique({ where: { id: signal.callId } });
  if (!record) throw new CallHistoryError("Call does not exist.");
  const isCaller = signal.from === record.caller && signal.to === record.callee;
  const isCallee = signal.from === record.callee && signal.to === record.caller;
  if (!isCaller && !isCallee) throw new CallHistoryError("Call participants do not match.");
  if (record.endedAt || signal.type === "call-request") return;

  if (signal.type === "call-accept") {
    if (!isCallee) throw new CallHistoryError("Only the recipient can accept a call.");
    await db.callRecord.updateMany({
      where: { id: record.id, endedAt: null, acceptedAt: null },
      data: { acceptedAt: now, lastSeenAt: now }
    });
  } else if (signal.type === "call-connected") {
    await db.callRecord.updateMany({
      where: { id: record.id, endedAt: null, connectedAt: null, acceptedAt: { not: null } },
      data: { connectedAt: now, lastSeenAt: now }
    });
  } else if (signal.type === "call-heartbeat") {
    await db.callRecord.updateMany({
      where: { id: record.id, endedAt: null, connectedAt: { not: null } }, data: { lastSeenAt: now }
    });
  } else {
    if (signal.type === "call-reject" && !isCallee) throw new CallHistoryError("Only the recipient can reject a call.");
    const reason = signal.payload?.reason;
    const endReason = signal.type === "call-reject"
      ? reason === "busy" ? "busy" : "declined"
      : reason === "failed" ? "failed" : record.connectedAt ? "completed"
        : record.acceptedAt ? "failed"
          : reason === "missed" ? "missed" : isCaller ? "cancelled" : "missed";
    await db.callRecord.updateMany({ where: { id: record.id, endedAt: null }, data: { endedAt: now, endReason, lastSeenAt: now } });
  }
}

export function serializeCallRecord(record: CallRecord, now = Date.now()): CallHistoryEntry {
  let endedAt = record.endedAt;
  let status: CallHistoryStatus = record.endReason as CallHistoryStatus ||
    (record.connectedAt ? "active" : record.acceptedAt ? "connecting" : "ringing");
  const expiry = record.acceptedAt || record.connectedAt ? CONNECTION_EXPIRY_MS : RING_EXPIRY_MS;
  if (!endedAt && now - record.lastSeenAt.getTime() > expiry) {
    endedAt = record.connectedAt ? record.lastSeenAt : new Date(record.lastSeenAt.getTime() + expiry);
    status = record.acceptedAt || record.connectedAt ? "failed" : "missed";
  }
  return {
    id: record.id, caller: record.caller, callee: record.callee,
    startedAt: record.startedAt.toISOString(), connectedAt: record.connectedAt?.toISOString() ?? null,
    endedAt: endedAt?.toISOString() ?? null, status,
    durationSeconds: record.connectedAt ? Math.max(0, Math.floor(((endedAt?.getTime() ?? now) - record.connectedAt.getTime()) / 1000)) : 0
  };
}
