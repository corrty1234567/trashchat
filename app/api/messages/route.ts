import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getMembers } from "@/lib/members";
import { notifyMessagesChanged } from "@/lib/pusher-server";

export const runtime = "nodejs";

const messageInputSchema = z
  .object({
    sender: z.string().trim().min(1).max(120),
    text: z.string().trim().max(4000).optional(),
    imageUrl: z.string().url().optional(),
    imageUrls: z.array(z.string().url()).max(10).optional(),
    replyToMessageId: z.string().cuid().optional()
  })
  .refine((data) => Boolean(data.text?.trim() || data.imageUrl || data.imageUrls?.length), {
    message: "Message needs text or image."
  });

const createMessageSchema = z.union([
  messageInputSchema,
  z.object({
    messages: z.array(messageInputSchema).min(1).max(10)
  })
]);

const getMessagesSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(80),
  beforeCreatedAt: z.string().datetime().optional(),
  beforeId: z.string().optional()
});

const messageInclude = {
  replyTo: {
    select: {
      id: true,
      sender: true,
      text: true,
      imageUrl: true,
      imageUrls: true,
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

type MessageInput = z.infer<typeof messageInputSchema>;

function getMessageInputs(data: z.infer<typeof createMessageSchema>) {
  return "messages" in data ? data.messages : [data];
}

function getImageUrls(message: MessageInput) {
  const urls = message.imageUrls?.length ? message.imageUrls : message.imageUrl ? [message.imageUrl] : [];
  return urls.slice(0, 10);
}

function createMessage(message: MessageInput) {
  return prisma.message.create({
    data: {
      imageUrls: getImageUrls(message),
      sender: message.sender,
      text: message.text?.trim() || null,
      imageUrl: getImageUrls(message)[0] ?? null,
      replyToMessageId: message.replyToMessageId ?? null
    },
    include: messageInclude
  });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const parsed = getMessagesSchema.safeParse({
    limit: searchParams.get("limit") ?? undefined,
    beforeCreatedAt: searchParams.get("beforeCreatedAt") ?? undefined,
    beforeId: searchParams.get("beforeId") ?? undefined
  });

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const beforeCreatedAt = parsed.data.beforeCreatedAt ? new Date(parsed.data.beforeCreatedAt) : null;
  const messagesDesc = await prisma.message.findMany({
    where:
      beforeCreatedAt && parsed.data.beforeId
        ? {
            OR: [
              {
                createdAt: {
                  lt: beforeCreatedAt
                }
              },
              {
                createdAt: beforeCreatedAt,
                id: {
                  lt: parsed.data.beforeId
                }
              }
            ]
          }
        : undefined,
    orderBy: [
      {
        createdAt: "desc"
      },
      {
        id: "desc"
      }
    ],
    take: parsed.data.limit + 1,
    include: messageInclude
  });
  const hasMore = messagesDesc.length > parsed.data.limit;
  const messages = messagesDesc.slice(0, parsed.data.limit).reverse();

  return NextResponse.json({ messages, hasMore });
}

export async function POST(request: Request) {
  const parsed = createMessageSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const messageInputs = getMessageInputs(parsed.data);
  const memberIds = new Set((await getMembers()).map((member) => member.id));
  const invalidSender = messageInputs.find((message) => !memberIds.has(message.sender));

  if (invalidSender) {
    return NextResponse.json({ error: "Sender does not exist." }, { status: 400 });
  }

  const replyTargetIds = [
    ...new Set(
      messageInputs
        .map((message) => message.replyToMessageId)
        .filter((replyToMessageId): replyToMessageId is string => Boolean(replyToMessageId))
    )
  ];

  if (replyTargetIds.length > 0) {
    const repliedMessages = await prisma.message.findMany({
      where: {
        id: {
          in: replyTargetIds
        }
      },
      select: { id: true }
    });

    if (repliedMessages.length !== replyTargetIds.length) {
      return NextResponse.json({ error: "Reply target does not exist." }, { status: 400 });
    }
  }

  const messages =
    messageInputs.length === 1 ? [await createMessage(messageInputs[0])] : await prisma.$transaction(messageInputs.map(createMessage));

  void notifyMessagesChanged({ type: "created", id: messages[0]?.id });

  if ("messages" in parsed.data) {
    return NextResponse.json({ messages }, { status: 201 });
  }

  return NextResponse.json({ message: messages[0] }, { status: 201 });
}
