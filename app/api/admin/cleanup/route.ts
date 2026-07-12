import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const CALL_SIGNAL_RETENTION_MS = 60 * 60 * 1000;

export async function POST(request: Request) {
  const adminError = requireAdmin(request);

  if (adminError) {
    return adminError;
  }

  const callSignalCutoff = new Date(Date.now() - CALL_SIGNAL_RETENTION_MS);
  const callSignals = await prisma.callSignal.deleteMany({
    where: {
      createdAt: {
        lt: callSignalCutoff
      }
    }
  });

  return NextResponse.json({
    callSignalsDeleted: callSignals.count
  });
}
