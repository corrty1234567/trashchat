import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type DatabaseUsageRow = {
  bytes: bigint | number | string;
};

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "未知";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const decimals = unitIndex === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(decimals)} ${units[unitIndex]}`;
}

export async function GET(request: Request) {
  const adminError = requireAdmin(request);

  if (adminError) {
    return adminError;
  }

  const [usage] = await prisma.$queryRaw<DatabaseUsageRow[]>`
    SELECT pg_database_size(current_database()) AS bytes
  `;
  const bytes = Number(usage?.bytes ?? 0);

  return NextResponse.json(
    {
      bytes,
      formatted: formatBytes(bytes)
    },
    {
      headers: {
        "Cache-Control": "no-store"
      }
    }
  );
}
