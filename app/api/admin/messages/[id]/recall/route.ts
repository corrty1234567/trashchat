import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { deleteBlobUrls, getMessageBlobUrls } from "@/lib/blob-storage";
import { prisma } from "@/lib/prisma";
import { notifyMessagesChanged } from "@/lib/pusher-server";

export const runtime = "nodejs";

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

export async function POST(request: Request, context: RouteContext) {
  const adminError = requireAdmin(request);

  if (adminError) {
    return adminError;
  }

  const { id } = await context.params;
  const existing = await prisma.message.findUnique({
    where: { id }
  });

  if (!existing) {
    return NextResponse.json({ error: "Message not found." }, { status: 404 });
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
