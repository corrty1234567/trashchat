import { NextResponse } from "next/server";
import { z } from "zod";
import { canEditMessage } from "@/lib/time";
import { deleteBlobUrls, getMessageBlobUrls } from "@/lib/blob-storage";
import { prisma } from "@/lib/prisma";
import { notifyMessagesChanged } from "@/lib/pusher-server";

export const runtime = "nodejs";

const updateMessageSchema = z.object({
  sender: z.string().trim().min(1).max(120),
  text: z.string().trim().min(1).max(4000)
});

const recallMessageSchema = z.object({
  sender: z.string().trim().min(1).max(120)
});

const messageInclude = {
  replyTo: {
    select: {
      id: true,
      sender: true,
      text: true,
      imageUrl: true,
      imageUrls: true,
      thumbnailUrls: true,
      createdAt: true,
      editedAt: true,
      recalledAt: true
    }
  },
  reads: {
    select: {
      id: true,
      messageId: true,
      sender: true,
      readAt: true
    },
    orderBy: {
      readAt: "asc"
    }
  }
} as const;

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const parsed = updateMessageSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const existing = await prisma.message.findUnique({
    where: { id }
  });

  if (!existing) {
    return NextResponse.json({ error: "Message not found." }, { status: 404 });
  }

  if (existing.sender !== parsed.data.sender) {
    return NextResponse.json({ error: "You can only edit your own messages." }, { status: 403 });
  }

  if (!canEditMessage(existing.createdAt, existing.recalledAt)) {
    return NextResponse.json({ error: "Message can only be edited within 15 minutes." }, { status: 403 });
  }

  const message = await prisma.message.update({
    where: { id },
    data: {
      text: parsed.data.text,
      editedAt: new Date()
    },
    include: messageInclude
  });

  void notifyMessagesChanged({ type: "edited", id: message.id });

  return NextResponse.json({ message });
}

export async function DELETE(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const parsed = recallMessageSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const existing = await prisma.message.findUnique({
    where: { id }
  });

  if (!existing) {
    return NextResponse.json({ error: "Message not found." }, { status: 404 });
  }

  if (existing.sender !== parsed.data.sender) {
    return NextResponse.json({ error: "You can only recall your own messages." }, { status: 403 });
  }

  if (existing.recalledAt) {
    const message = await prisma.message.findUnique({
      where: { id },
      include: messageInclude
    });

    return NextResponse.json({ message });
  }

  const message = await prisma.message.update({
    where: { id },
    data: {
      text: null,
      imageUrl: null,
      imageUrls: [],
      thumbnailUrls: [],
      recalledAt: new Date()
    },
    include: messageInclude
  });

  void deleteBlobUrls(getMessageBlobUrls(existing));
  void notifyMessagesChanged({ type: "recalled", id: message.id });

  return NextResponse.json({ message });
}
