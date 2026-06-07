import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { notifyMessagesChanged } from "@/lib/pusher-server";
import { SENDER_VALUES } from "@/lib/types";

export const runtime = "nodejs";

const markReadSchema = z.object({
  sender: z.enum(SENDER_VALUES)
});

export async function POST(request: Request) {
  const parsed = markReadSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const result = await prisma.message.updateMany({
    where: {
      sender: {
        not: parsed.data.sender
      },
      readAt: null
    },
    data: {
      readAt: new Date()
    }
  });

  if (result.count > 0) {
    await notifyMessagesChanged({ type: "read" });
  }

  return NextResponse.json({
    marked: result.count
  });
}
