import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { notifyMessagesChanged } from "@/lib/pusher-server";

export const runtime = "nodejs";

const createMessageSchema = z
  .object({
    sender: z.enum(["CHEN", "ZUO"]),
    text: z.string().trim().max(4000).optional(),
    imageUrl: z.string().url().optional(),
    replyToMessageId: z.string().cuid().optional()
  })
  .refine((data) => Boolean(data.text?.trim() || data.imageUrl), {
    message: "Message needs text or image."
  });

const messageInclude = {
  replyTo: {
    select: {
      id: true,
      sender: true,
      text: true,
      imageUrl: true,
      createdAt: true,
      editedAt: true,
      recalledAt: true
    }
  }
} as const;

export async function GET() {
  const messages = await prisma.message.findMany({
    orderBy: {
      createdAt: "asc"
    },
    include: messageInclude
  });

  return NextResponse.json({ messages });
}

export async function POST(request: Request) {
  const parsed = createMessageSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { sender, text, imageUrl, replyToMessageId } = parsed.data;

  if (replyToMessageId) {
    const repliedMessage = await prisma.message.findUnique({
      where: { id: replyToMessageId },
      select: { id: true }
    });

    if (!repliedMessage) {
      return NextResponse.json({ error: "Reply target does not exist." }, { status: 400 });
    }
  }

  const message = await prisma.message.create({
    data: {
      sender,
      text: text?.trim() || null,
      imageUrl: imageUrl ?? null,
      replyToMessageId: replyToMessageId ?? null
    },
    include: messageInclude
  });

  await notifyMessagesChanged({ type: "created", id: message.id });

  return NextResponse.json({ message }, { status: 201 });
}
