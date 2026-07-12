import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const searchMessagesSchema = z.object({
  q: z.string().trim().min(1).max(120),
  limit: z.coerce.number().int().min(1).max(50).default(20)
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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const parsed = searchMessagesSchema.safeParse({
    q: searchParams.get("q") ?? undefined,
    limit: searchParams.get("limit") ?? undefined
  });

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const messages = await prisma.message.findMany({
    where: {
      recalledAt: null,
      text: {
        contains: parsed.data.q,
        mode: "insensitive"
      }
    },
    orderBy: [
      {
        createdAt: "desc"
      },
      {
        id: "desc"
      }
    ],
    take: parsed.data.limit,
    include: messageInclude
  });

  return NextResponse.json({ messages });
}
