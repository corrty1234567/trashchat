import { after, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { deleteBlobUrls, getMessageBlobUrls } from "@/lib/blob-storage";
import { prisma } from "@/lib/prisma";
import { messageInclude, serializeMessage } from "@/lib/message-data";
import { notifyMessagesChanged } from "@/lib/pusher-server";

export const runtime = "nodejs";

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

    return NextResponse.json({ message: message ? serializeMessage(message) : null });
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

  after(deleteBlobUrls(getMessageBlobUrls(existing)));
  after(notifyMessagesChanged({ type: "recalled", id: message.id, message: serializeMessage(message) }));

  return NextResponse.json({ message: serializeMessage(message) });
}
