import assert from "node:assert/strict";
import { test } from "node:test";
import { loadModule } from "./helpers/load-typescript.mjs";

function storedMessage(overrides = {}) {
  return {
    id: "cm000000000000000000000001", sender: "CHEN", text: "hello", imageUrl: null,
    imageUrls: [], thumbnailUrls: [], createdAt: new Date("2026-10-02T00:00:00Z"),
    updatedAt: new Date("2026-10-02T00:00:00Z"), editedAt: null, recalledAt: null,
    readAt: null, replyToMessageId: null, reads: [], replyTo: null, ...overrides
  };
}

function request(body) {
  return new Request("http://localhost/api/messages", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  });
}

function routeHarness({ membersExist = true, replies = [], realtimeAvailable = true, notify = async () => {} } = {}) {
  const events = [];
  const afterTasks = [];
  const creates = [];
  const validations = [];
  const route = loadModule("app/api/messages/route.ts", {
    "@/lib/chat-auth": { requireChatAccess: () => null },
    "next/server": { NextResponse: { json: (body, options) => Response.json(body, options) }, after: (task) => afterTasks.push(task) },
    "@/lib/prisma": { prisma: {
      member: { count: async ({ where }) => { validations.push(where); return membersExist ? where.id.in.length : 0; } },
      message: {
        findMany: async ({ select }) => select ? replies.map((reply) =>
          Object.fromEntries(Object.keys(select).map((key) => [key, reply[key]]))
        ) : [],
        create: async (args) => {
          creates.push(args);
          return storedMessage({ ...args.data, id: `cm${String(creates.length).padStart(23, "0")}` });
        }
      },
      $transaction: async (operations) => Promise.all(operations)
    } },
    "@/lib/pusher-server": {
      hasRealtimeMessaging: () => realtimeAvailable,
      notifyMessagesChanged: (event) => { events.push(event); return notify(event); }
    }
  });
  return { route, events, afterTasks, creates, validations };
}

test("send publishes the saved message immediately without waiting for Pusher or querying its empty relations", async () => {
  let finishNotification;
  const notification = new Promise((resolveNotification) => { finishNotification = resolveNotification; });
  const harness = routeHarness({ notify: () => notification });
  const response = await harness.route.POST(request({ sender: "CHEN", text: "hello", clientRequestId: "optimistic-test" }));
  const { message } = await response.json();
  assert.equal(response.status, 201);
  assert.equal(harness.events.length, 1);
  assert.deepEqual(harness.events[0].message, message);
  assert.equal(harness.events[0].clientRequestId, "optimistic-test");
  assert.equal("include" in harness.creates[0], false);
  assert.equal(harness.afterTasks.length, 1);
  let notificationFinished = false;
  harness.afterTasks[0].then(() => { notificationFinished = true; });
  await Promise.resolve();
  assert.equal(notificationFinished, false);
  finishNotification();
  await harness.afterTasks[0];
});

test("a batch publishes every saved message with its own client request ID", async () => {
  const harness = routeHarness();
  const response = await harness.route.POST(request({ messages: [
    { sender: "CHEN", text: "one", clientRequestId: "optimistic-one" },
    { sender: "ZUO", text: "two", clientRequestId: "optimistic-two" }
  ] }));
  assert.equal(response.status, 201);
  const { messages } = await response.json();
  assert.deepEqual(harness.events.map((event) => event.message), messages);
  assert.deepEqual(harness.events.map((event) => event.clientRequestId), ["optimistic-one", "optimistic-two"]);
  await Promise.all(harness.afterTasks);
});

test("unknown senders and missing replies cannot create or broadcast messages", async () => {
  for (const options of [{ membersExist: false }, { replies: [] }]) {
    const harness = routeHarness(options);
    const body = { sender: "CHEN", text: "hello" };
    if (options.replies) body.replyToMessageId = "cm000000000000000000000099";
    const response = await harness.route.POST(request(body));
    assert.equal(response.status, 400);
    assert.equal(harness.creates.length, 0);
    assert.equal(harness.events.length, 0);
  }
});

test("reply and image data are included in the direct delivery", async () => {
  const reply = storedMessage({ id: "cm000000000000000000000099", sender: "ZUO", text: "question" });
  const harness = routeHarness({ replies: [reply] });
  const imageUrl = "https://example.com/image.jpg";
  const response = await harness.route.POST(request({
    sender: "CHEN", text: "answer", replyToMessageId: reply.id, imageUrls: [imageUrl], thumbnailUrls: [imageUrl]
  }));
  assert.equal(response.status, 201);
  const { message } = await response.json();
  assert.equal(message.replyTo.text, "question");
  assert.equal(message.replyTo.createdAt, reply.createdAt.toISOString());
  assert.deepEqual(message.imageUrls, [imageUrl]);
  assert.deepEqual(harness.events[0].message, message);
  await Promise.all(harness.afterTasks);
});

test("UTF-8 messages over Pusher's size limit retain their ID for targeted retrieval", async () => {
  const events = [];
  const env = { PUSHER_APP_ID: "test", NEXT_PUBLIC_PUSHER_KEY: "test", PUSHER_SECRET: "test", PUSHER_CLUSTER: "ap3",
    TRASHCHAT_AUTH_PASSWORD: "test-only-long-random-password", TRASHCHAT_DATA_KEY: "01".repeat(32) };
  const originalEnv = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  try {
    const server = loadModule("lib/pusher-server.ts", {
      pusher: class { async trigger(_channel, _name, event) { events.push(event); } }
    });
    const { serializeMessage } = loadModule("lib/message-data.ts");
    const short = serializeMessage(storedMessage());
    await server.notifyMessagesChanged({ type: "created", id: short.id, message: short });
    const large = serializeMessage(storedMessage({ text: "\u4e2d".repeat(4000) }));
    await server.notifyMessagesChanged({ type: "created", id: large.id, message: large, clientRequestId: "optimistic-large" });
    assert.deepEqual(events[0].message, short);
    assert.equal(events[1].message, undefined);
    assert.equal(events[1].id, large.id);
    assert.equal(events[1].clientRequestId, "optimistic-large");
    assert.ok(Buffer.byteLength(JSON.stringify(events[1])) < 10000);
  } finally {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

const { serializeMessage } = loadModule("lib/message-data.ts");
const { mergeLoadedMessages, applyReadReceipts } = loadModule("lib/message-state.ts");

test("WebSocket delivery before the POST response replaces the optimistic message without duplicates or losing reads", () => {
  const saved = serializeMessage(storedMessage());
  const optimistic = { ...saved, id: "optimistic-test", clientStatus: "sending" };
  let messages = mergeLoadedMessages([optimistic], [saved], optimistic.id);
  messages = applyReadReceipts(messages, [saved.id], "ZUO", "2026-10-02T00:00:01Z");
  messages = mergeLoadedMessages(messages, [saved], optimistic.id);
  messages = mergeLoadedMessages(messages, [saved]);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].clientStatus, undefined);
  assert.equal(messages[0].reads[0].sender, "ZUO");
});

test("a delayed history response cannot undo a newer recall or edit", () => {
  const original = serializeMessage(storedMessage());
  for (const update of [
    { text: "edited", editedAt: new Date("2026-10-02T00:00:02Z") },
    { text: null, recalledAt: new Date("2026-10-02T00:00:02Z") }
  ]) {
    const changed = serializeMessage(storedMessage({ ...update, updatedAt: new Date("2026-10-02T00:00:02Z") }));
    const messages = mergeLoadedMessages([changed], [original]);
    assert.equal(messages[0].text, changed.text);
    assert.equal(messages[0].recalledAt, changed.recalledAt);
  }
});

test("read receipts apply only to the supplied messages and deduplicate repeated events", () => {
  const first = serializeMessage(storedMessage());
  const second = serializeMessage(storedMessage({ id: "cm000000000000000000000002" }));
  const readAt = "2026-10-02T00:00:01Z";
  let messages = applyReadReceipts([first, second], [first.id], "ZUO", readAt);
  messages = applyReadReceipts(messages, [first.id], "ZUO", readAt);
  assert.equal(messages[0].reads.length, 1);
  assert.equal(messages[1].reads.length, 0);
});

test("history reports missing server realtime configuration so a connected client can use fast fallback polling", async () => {
  const harness = routeHarness({ realtimeAvailable: false });
  const response = await harness.route.GET(new Request("http://localhost/api/messages?limit=40"));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).realtimeAvailable, false);
});

test("direct edit and recall delivery updates existing reply previews", () => {
  const original = serializeMessage(storedMessage());
  const reply = serializeMessage(storedMessage({
    id: "cm000000000000000000000002", replyToMessageId: original.id,
    replyTo: storedMessage(), createdAt: new Date("2026-10-02T00:00:01Z")
  }));
  const recalled = serializeMessage(storedMessage({
    text: null, recalledAt: new Date("2026-10-02T00:00:02Z"), updatedAt: new Date("2026-10-02T00:00:02Z")
  }));
  const messages = mergeLoadedMessages([original, reply], [recalled]);
  assert.equal(messages[1].replyTo.text, null);
  assert.equal(messages[1].replyTo.recalledAt, recalled.recalledAt);
});

test("large read batches publish small receipt events without delaying the response", async () => {
  const events = [];
  const tasks = [];
  const messageIds = Array.from({ length: 500 }, (_, index) => `cm${String(index).padStart(23, "0")}`);
  let finishNotifications;
  const notification = new Promise((finish) => { finishNotifications = finish; });
  const route = loadModule("app/api/messages/read/route.ts", {
    "@/lib/chat-auth": { requireChatAccess: () => null },
    "next/server": { NextResponse: { json: (body, options) => Response.json(body, options) }, after: (task) => tasks.push(task) },
    "@/lib/members": { memberExists: async () => true },
    "@/lib/prisma": { prisma: {
      message: { findMany: async () => messageIds.map((id) => ({ id })), updateMany: async () => ({ count: 500 }) },
      messageRead: { createMany: async () => ({ count: 500 }) }
    } },
    "@/lib/pusher-server": { notifyMessagesChanged: (event) => { events.push(event); return notification; } }
  });
  const response = await route.POST(request({ sender: "ZUO", messageIds }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).marked, 500);
  assert.equal(events.length, 5);
  assert.deepEqual(events.flatMap((event) => event.messageIds), messageIds);
  assert.ok(events.every((event) => Buffer.byteLength(JSON.stringify(event)) < 9500));
  finishNotifications();
  await Promise.all(tasks);
});

test("targeted retrieval returns the full message and a 404 for missing IDs", async () => {
  let message = storedMessage();
  const route = loadModule("app/api/messages/[id]/route.ts", {
    "@/lib/chat-auth": { requireChatAccess: () => null },
    "@/lib/prisma": { prisma: { message: { findUnique: async () => message } } },
    "@/lib/blob-storage": {},
    "@/lib/pusher-server": {}
  });
  const context = { params: Promise.resolve({ id: message.id }) };
  const found = await route.GET(new Request("http://localhost/api/messages/example"), context);
  assert.equal(found.status, 200);
  assert.deepEqual((await found.json()).message, serializeMessage(message));
  message = null;
  const missing = await route.GET(new Request("http://localhost/api/messages/example"), context);
  assert.equal(missing.status, 404);
});

const { buildMessageLayout, buildVirtualMetrics, getMessagesBelowViewport, shouldFollowLatest } = loadModule("lib/chat-scroll.ts");

test("auto-follow stops at six messages, regardless of individual message heights", () => {
  const messages = Array.from({ length: 12 }, (_, index) => serializeMessage(storedMessage({ id: `message-${index}` })));
  const heights = new Map(messages.map((message, index) => [message.id, index % 2 === 0 ? 40 : 320]));
  const layout = buildMessageLayout(messages, heights);
  assert.equal(getMessagesBelowViewport(layout, layout.offsets[6]), 6);
  assert.equal(shouldFollowLatest(layout, layout.offsets[6]), false);
  assert.equal(shouldFollowLatest(layout, layout.offsets[7]), true);
  assert.equal(shouldFollowLatest(layout, layout.totalHeight + 20), true);
});

test("initial virtual rendering includes the newest message before scrolling", () => {
  const messages = Array.from({ length: 100 }, (_, index) => serializeMessage(storedMessage({ id: `message-${index}` })));
  const layout = buildMessageLayout(messages, new Map());
  const metrics = buildVirtualMetrics(messages, layout, { scrollTop: 0, height: 600 }, true);
  assert.equal(metrics.rows.at(-1).message.id, messages.at(-1).id);
  assert.ok(metrics.topSpacerHeight > 0);
  assert.equal(metrics.bottomSpacerHeight, 0);
  assert.equal(metrics.rows.length < messages.length, true);
});

test("virtual windows preserve the complete scroll height and handle an empty room", () => {
  const messages = Array.from({ length: 100 }, (_, index) => serializeMessage(storedMessage({ id: `message-${index}` })));
  const layout = buildMessageLayout(messages, new Map());
  const metrics = buildVirtualMetrics(messages, layout, { scrollTop: 4500, height: 600 });
  const renderedHeight = metrics.rows.reduce((sum, row) => sum + layout.heights[row.index], 0);
  assert.equal(metrics.topSpacerHeight + renderedHeight + metrics.bottomSpacerHeight, layout.totalHeight);
  const emptyLayout = buildMessageLayout([], new Map());
  assert.equal(buildVirtualMetrics([], emptyLayout, { scrollTop: 0, height: 600 }).rows.length, 0);
  assert.equal(getMessagesBelowViewport(emptyLayout, 600), 0);
});

test("unchanged polling preserves the history and message references", () => {
  const original = serializeMessage(storedMessage());
  const reply = serializeMessage(storedMessage({
    id: "cm000000000000000000000002", replyToMessageId: original.id, replyTo: storedMessage()
  }));
  const current = [original, reply];
  const loaded = JSON.parse(JSON.stringify(current));
  assert.equal(mergeLoadedMessages(current, loaded), current);
  const edited = { ...loaded[0], text: "changed", updatedAt: "2026-10-02T00:00:02Z" };
  assert.notEqual(mergeLoadedMessages(current, [edited]), current);
});
