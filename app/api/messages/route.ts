import { after, NextResponse } from "next/server";
import { requireChatAccess } from "@/lib/chat-auth";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { messageInclude, messageReplySelect, serializeMessage } from "@/lib/message-data";
import { hasRealtimeMessaging, notifyMessagesChanged } from "@/lib/pusher-server";

export const runtime = "nodejs";

const messageInputSchema = z
  .object({
    sender: z.string().trim().min(1).max(120),
    clientRequestId: z.string().min(1).max(120).optional(),
    text: z.string().trim().max(4000).optional(),
    imageUrl: z.string().url().optional(),
    imageUrls: z.array(z.string().url()).max(10).optional(),
    thumbnailUrls: z.array(z.string().url()).max(10).optional(),
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

type MessageInput = z.infer<typeof messageInputSchema>;

function getMessageInputs(data: z.infer<typeof createMessageSchema>) {
  return "messages" in data ? data.messages : [data];
}

function getImageUrls(message: MessageInput) {
  const urls = message.imageUrls?.length ? message.imageUrls : message.imageUrl ? [message.imageUrl] : [];
  return urls.slice(0, 10);
}

function getThumbnailUrls(message: MessageInput) {
  return (message.thumbnailUrls ?? []).slice(0, 10);
}

function createMessage(message: MessageInput) {
  const imageUrls = getImageUrls(message);

  return prisma.message.create({
    data: {
      imageUrls,
      thumbnailUrls: getThumbnailUrls(message),
      sender: message.sender,
      text: message.text?.trim() || null,
      imageUrl: imageUrls[0] ?? null,
      replyToMessageId: message.replyToMessageId ?? null
    }
  });
}

export async function GET(request: Request) {
  const accessError = requireChatAccess(request);
  if (accessError) return accessError;
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

  return NextResponse.json({ messages: messages.map(serializeMessage), hasMore, realtimeAvailable: hasRealtimeMessaging() });
}

export async function POST(request: Request) {
  const accessError = requireChatAccess(request);
  if (accessError) return accessError;
  const parsed = createMessageSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const messageInputs = getMessageInputs(parsed.data);
  const senderIds = [...new Set(messageInputs.map((message) => message.sender))];
  const replyTargetIds = [
    ...new Set(
      messageInputs
        .map((message) => message.replyToMessageId)
        .filter((replyToMessageId): replyToMessageId is string => Boolean(replyToMessageId))
    )
  ];

  const [memberCount, repliedMessages] = await Promise.all([
    prisma.member.count({ where: { id: { in: senderIds } } }),
    replyTargetIds.length > 0
      ? prisma.message.findMany({ where: { id: { in: replyTargetIds } }, select: messageReplySelect })
      : Promise.resolve([])
  ]);

  if (memberCount !== senderIds.length) {
    return NextResponse.json({ error: "Sender does not exist." }, { status: 400 });
  }

  if (repliedMessages.length !== replyTargetIds.length) {
    return NextResponse.json({ error: "Reply target does not exist." }, { status: 400 });
  }

  const createdMessages =
    messageInputs.length === 1 ? [await createMessage(messageInputs[0])] : await prisma.$transaction(messageInputs.map(createMessage));
  const repliesById = new Map(repliedMessages.map((message) => [message.id, message]));
  const messages = createdMessages.map((message) =>
    serializeMessage({ ...message, reads: [], replyTo: repliesById.get(message.replyToMessageId ?? "") ?? null })
  );

  // Start publishing now and keep Vercel alive until delivery finishes.
  after(Promise.all(messages.map((message, index) => notifyMessagesChanged({
    type: "created",
    id: message.id,
    message,
    clientRequestId: messageInputs[index].clientRequestId
  }))));

  if ("messages" in parsed.data) {
    return NextResponse.json({ messages }, { status: 201 });
  }

  return NextResponse.json({ message: messages[0] }, { status: 201 });
}
