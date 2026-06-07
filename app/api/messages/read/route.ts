import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { notifyMessagesChanged } from "@/lib/pusher-server";
import { SENDER_VALUES } from "@/lib/types";

export const runtime = "nodejs";

const markReadSchema = z.object({
  sender: z.enum(SENDER_VALUES),
  messageIds: z.array(z.string().cuid()).max(500).optional()
});

export async function POST(request: Request) {
  const parsed = markReadSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const messages = await prisma.message.findMany({
    where: {
      sender: {
        not: parsed.data.sender
      },
      recalledAt: null,
      ...(parsed.data.messageIds?.length
        ? {
            id: {
              in: parsed.data.messageIds
            }
          }
        : {})
    },
    select: {
      id: true
    },
    take: 500
  });

  if (messages.length === 0) {
    return NextResponse.json({ marked: 0 });
  }

  const readAt = new Date();
  const result = await prisma.messageRead.createMany({
    data: messages.map((message) => ({
      messageId: message.id,
      sender: parsed.data.sender,
      readAt
    })),
    skipDuplicates: true
  });

  if (result.count > 0) {
    await prisma.message.updateMany({
      where: {
        id: {
          in: messages.map((message) => message.id)
        },
        readAt: null
      },
      data: {
        readAt
      }
    });
    await notifyMessagesChanged({ type: "read" });
  }

  return NextResponse.json({
    marked: result.count
  });
}
