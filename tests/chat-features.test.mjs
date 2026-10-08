import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma } from "@prisma/client";
import { unzipSync } from "fflate";
import { loadModule } from "./helpers/load-typescript.mjs";

const { findUnreadBoundary } = loadModule("lib/unread-boundary.ts");
const { recordCallSignal, serializeCallRecord } = loadModule("lib/call-history.ts");
const { formatCallDuration } = loadModule("lib/call.ts");
const { getChatImages } = loadModule("lib/chat-images.ts");

const message = (id, options = {}) => ({ id, sender: "ZUO", createdAt: `2026-10-08T00:00:${id.padStart(2, "0")}.000Z`, reads: [], ...options });
test("unread boundaries exclude own, read, recalled, and optimistic messages", () => {
  const messages = [message("01", { sender: "CHEN" }), message("02", { reads: [{ sender: "CHEN" }] }),
    message("03", { recalledAt: "now" }), message("04", { clientStatus: "sending" }), message("05"), message("06")];
  assert.deepEqual(findUnreadBoundary(messages, "CHEN"), { id: "05", createdAt: messages[4].createdAt });
  assert.equal(findUnreadBoundary(messages.slice(0, 4), "CHEN"), null);
});

test("unread boundaries stay stable after read receipts but extend to older unread pages", () => {
  const current = { id: "10", createdAt: message("10").createdAt };
  assert.equal(findUnreadBoundary([message("10", { reads: [{ sender: "CHEN" }] }), message("12")], "CHEN", current), current);
  assert.equal(findUnreadBoundary([message("02"), message("05")], "CHEN", current).id, "02");
});

function callDb() {
  let record = null;
  const db = { callRecord: {
    upsert: async ({ create }) => {
      record ||= { ...create, acceptedAt: null, connectedAt: null, endedAt: null, endReason: null };
      return structuredClone(record);
    },
    findUnique: async () => structuredClone(record),
    updateMany: async ({ where, data }) => {
      for (const [key, value] of Object.entries(where)) {
        if (typeof value === "object" && value !== null && "not" in value) {
          if (record[key] === value.not) return { count: 0 };
        } else if (record[key] !== value) return { count: 0 };
      }
      Object.assign(record, data);
      return { count: 1 };
    }
  } };
  return { db, get: () => structuredClone(record) };
}
const signal = (type, options = {}) => ({ type, callId: "call-test-123", from: "CHEN", to: "ZUO", ...options });
const start = new Date("2026-10-08T10:00:00.000Z");
const at = seconds => new Date(start.getTime() + seconds * 1000);

test("call history measures connected audio time, not time spent ringing", async () => {
  const { db, get } = callDb();
  await recordCallSignal(db, signal("call-request"), start);
  await recordCallSignal(db, signal("call-accept", { from: "ZUO", to: "CHEN" }), at(5));
  await recordCallSignal(db, signal("call-connected"), at(8));
  await recordCallSignal(db, signal("hangup"), at(78));
  const history = serializeCallRecord(get(), at(90).getTime());
  assert.equal(history.status, "completed");
  assert.equal(history.durationSeconds, 70);
  assert.equal(formatCallDuration(history.durationSeconds), "1:10");
  assert.equal(formatCallDuration(3661), "1:01:01");
});

test("duplicate accept/connect/end events do not overwrite original timestamps or revive ended calls", async () => {
  const { db, get } = callDb();
  await recordCallSignal(db, signal("call-request"), start);
  const accept = signal("call-accept", { from: "ZUO", to: "CHEN" });
  await recordCallSignal(db, accept, at(2));
  await recordCallSignal(db, accept, at(4));
  await recordCallSignal(db, signal("call-connected"), at(6));
  await recordCallSignal(db, signal("call-connected", { from: "ZUO", to: "CHEN" }), at(7));
  await recordCallSignal(db, signal("hangup"), at(12));
  await recordCallSignal(db, signal("call-connected"), at(15));
  await recordCallSignal(db, signal("hangup"), at(20));
  assert.equal(get().acceptedAt.getTime(), at(2).getTime());
  assert.equal(get().connectedAt.getTime(), at(6).getTime());
  assert.equal(get().endedAt.getTime(), at(12).getTime());
});

test("an interrupted connected call retains its actual duration and failure status", async () => {
  const { db, get } = callDb();
  await recordCallSignal(db, signal("call-request"), start);
  await recordCallSignal(db, signal("call-accept", { from: "ZUO", to: "CHEN" }), at(1));
  await recordCallSignal(db, signal("call-connected"), at(2));
  await recordCallSignal(db, signal("hangup", { payload: { reason: "failed" } }), at(32));
  const entry = serializeCallRecord(get());
  assert.equal(entry.status, "failed");
  assert.equal(entry.durationSeconds, 30);
});

test("call history distinguishes declined, busy, cancelled, missed, and failed calls", async () => {
  const cases = [
    [signal("call-reject", { from: "ZUO", to: "CHEN" }), "declined"],
    [signal("call-reject", { from: "ZUO", to: "CHEN", payload: { reason: "busy" } }), "busy"],
    [signal("hangup"), "cancelled"],
    [signal("hangup", { payload: { reason: "missed" } }), "missed"],
    [signal("hangup", { payload: { reason: "failed" } }), "failed"]
  ];
  for (const [event, expected] of cases) {
    const { db, get } = callDb();
    await recordCallSignal(db, signal("call-request"), start);
    await recordCallSignal(db, event, at(10));
    const history = serializeCallRecord(get());
    assert.equal(history.status, expected);
    assert.equal(history.durationSeconds, 0);
  }
});

test("heartbeats preserve long active calls, while abandoned calls expire without hanging forever", async () => {
  const { db, get } = callDb();
  await recordCallSignal(db, signal("call-request"), start);
  assert.equal(serializeCallRecord(get(), at(61).getTime()).status, "missed");
  await recordCallSignal(db, signal("call-accept", { from: "ZUO", to: "CHEN" }), at(1));
  assert.equal(serializeCallRecord(get(), at(92).getTime()).status, "failed");
  await recordCallSignal(db, signal("call-connected"), at(2));
  await recordCallSignal(db, signal("call-heartbeat"), at(300));
  assert.equal(serializeCallRecord(get(), at(320).getTime()).status, "active");
  const stale = serializeCallRecord(get(), at(391).getTime());
  assert.equal(stale.status, "failed");
  assert.equal(stale.durationSeconds, 298);
});

test("only matching call participants can change records and only the recipient can accept or reject", async () => {
  const { db, get } = callDb();
  await assert.rejects(recordCallSignal(db, signal("call-connected")), /does not exist/);
  await recordCallSignal(db, signal("call-request"), start);
  await assert.rejects(recordCallSignal(db, signal("call-accept")), /Only the recipient/);
  await assert.rejects(recordCallSignal(db, signal("call-reject")), /Only the recipient/);
  await assert.rejects(recordCallSignal(db, signal("hangup", { from: "SEVENTEEN" })), /participants/);
  await recordCallSignal(db, signal("call-connected"), at(1));
  assert.equal(get().connectedAt, null, "connection before acceptance must not start the duration");
});

function callRouteHarness(conflicts = 0) {
  const { db, get } = callDb();
  const events = [];
  const creates = [];
  const transactions = [];
  const create = async ({ data }) => {
    creates.push(data);
    return { ...data, id: `signal-${creates.length}`, payload: data.payload ?? null, createdAt: start };
  };
  db.callSignal = { create };
  const route = loadModule("app/api/call/route.ts", {
    "@/lib/chat-auth": { requireChatAccess: () => null },
    "@/lib/members": { getMembers: async () => [{ id: "CHEN" }, { id: "ZUO" }, { id: "SEVENTEEN" }] },
    "@/lib/pusher-server": { triggerRealtimeEvent: async (name, event) => { events.push({ name, event }); return true; } },
    "@/lib/prisma": { prisma: {
      callSignal: { create, deleteMany: async () => ({ count: 0 }) },
      $transaction: async (work, options) => {
        transactions.push(options);
        if (conflicts-- > 0) throw new Prisma.PrismaClientKnownRequestError("Write conflict", { code: "P2034", clientVersion: "test" });
        return work(db);
      }
    } }
  });
  const post = event => route.POST(new Request("https://trashchat.example/api/call", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(event)
  }));
  return { post, get, events, creates, transactions };
}

test("call lifecycle commits durable history and its signal together before broadcasting", async () => {
  const harness = callRouteHarness();
  const response = await harness.post(signal("call-request"));
  assert.equal(response.status, 200);
  assert.equal(harness.get().caller, "CHEN");
  assert.equal(harness.creates.length, 1);
  assert.equal(harness.events.length, 1);
  assert.equal(harness.transactions[0].isolationLevel, "Serializable");
  assert.equal(harness.events[0].event.id, "signal-1");
});

test("call lifecycle retries serialization conflicts without duplicate signals", async () => {
  const harness = callRouteHarness(2);
  assert.equal((await harness.post(signal("call-request"))).status, 200);
  assert.equal(harness.transactions.length, 3);
  assert.equal(harness.creates.length, 1);
  assert.equal(harness.events.length, 1);
});

test("call heartbeats update history without creating signalling rows or Pusher traffic", async () => {
  const harness = callRouteHarness();
  await harness.post(signal("call-request"));
  await harness.post(signal("call-accept", { from: "ZUO", to: "CHEN" }));
  await harness.post(signal("call-connected"));
  const before = { creates: harness.creates.length, events: harness.events.length };
  assert.equal((await harness.post(signal("call-heartbeat"))).status, 200);
  assert.equal(harness.creates.length, before.creates);
  assert.equal(harness.events.length, before.events);
  assert.ok(harness.get().connectedAt);
});

test("ICE signalling stays on its fast path and invalid lifecycle events never broadcast", async () => {
  const harness = callRouteHarness();
  assert.equal((await harness.post(signal("ice-candidate", { payload: { candidate: { candidate: "fixture" } } }))).status, 200);
  assert.equal(harness.transactions.length, 0);
  assert.equal(harness.get(), null);
  assert.equal((await harness.post(signal("call-accept", { from: "ZUO", to: "CHEN" }))).status, 400);
  assert.equal(harness.events.length, 1);
});

test("image entries expose protected full-resolution links, not public Blob URLs or arbitrary external images", () => {
  const image = { id: "message-1", sender: "ZUO", createdAt: start, imageUrl: null,
    imageUrls: ["https://store.public.blob.vercel-storage.com/trashchat/sealed/full.bin", "https://evil.example/private.png"],
    thumbnailUrls: ["https://store.public.blob.vercel-storage.com/trashchat/sealed/thumb.bin"] };
  const entries = getChatImages(image);
  assert.equal(entries.length, 1);
  assert.match(entries[0].url, /^\/api\/media\//);
  assert.notEqual(entries[0].url, entries[0].thumbnailUrl);
  assert.ok(!JSON.stringify(entries).includes("vercel-storage"));
  assert.equal(getChatImages({ ...image, imageUrls: [], imageUrl: image.imageUrls[0], thumbnailUrls: [] })[0].url, entries[0].url);
});

test("image API uses bounded keyset pagination, excludes recalled images, and does not mark messages read", async () => {
  let query;
  const route = loadModule("app/api/images/route.ts", {
    "@/lib/chat-auth": { requireChatAccess: () => null },
    "@/lib/prisma": { prisma: { message: { findMany: async options => {
      query = options;
      return Array.from({ length: 31 }, (_, index) => ({ id: `id-${index}`, sender: "CHEN", createdAt: start,
        imageUrl: "https://store.blob.vercel-storage.com/chorchat/old.png", imageUrls: [], thumbnailUrls: [] }));
    } } } }
  });
  assert.equal((await route.GET(new Request("https://trashchat.example/api/images?beforeId=partial"))).status, 400);
  const response = await route.GET(new Request(`https://trashchat.example/api/images?beforeCreatedAt=${start.toISOString()}&beforeId=id-40`));
  const data = await response.json();
  assert.equal(data.images.length, 30);
  assert.equal(data.hasMore, true);
  assert.equal(data.nextCursor.beforeId, "id-29");
  assert.equal(query.where.recalledAt, null);
  assert.equal(query.take, 31);
  assert.deepEqual(query.orderBy, [{ createdAt: "desc" }, { id: "desc" }]);
  assert.deepEqual(query.where.AND[1].OR[1].id, { lt: "id-40" });
  assert.match(response.headers.get("cache-control"), /private.*no-store/);
});

test("call history API limits results to the selected participant and uses deterministic pagination", async () => {
  let query;
  const route = loadModule("app/api/call/history/route.ts", {
    "@/lib/chat-auth": { requireChatAccess: () => null },
    "@/lib/prisma": { prisma: { callRecord: { findMany: async options => { query = options; return []; } } } }
  });
  assert.equal((await route.GET(new Request("https://trashchat.example/api/call/history"))).status, 400);
  const response = await route.GET(new Request("https://trashchat.example/api/call/history?sender=CHEN"));
  assert.equal(response.status, 200);
  assert.deepEqual(query.where.AND[0], { OR: [{ caller: "CHEN" }, { callee: "CHEN" }] });
  assert.equal(query.take, 31);
  assert.deepEqual(query.orderBy, [{ startedAt: "desc" }, { id: "desc" }]);
  assert.deepEqual(await response.json(), { calls: [], hasMore: false, nextCursor: null });
});

async function withDownloadBrowser(run) {
  const original = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch,
    create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  const blobs = new Map();
  const saved = [];
  globalThis.window = { location: { origin: "https://trashchat.example" }, setTimeout: () => 0 };
  globalThis.document = { body: { append() {} }, createElement: () => ({ click() { saved.push({ filename: this.download, blob: blobs.get(this.href) }); }, remove() {} }) };
  URL.createObjectURL = blob => { const id = `blob:test-${blobs.size}`; blobs.set(id, blob); return id; };
  URL.revokeObjectURL = id => blobs.delete(id);
  try { await run({ saved }); }
  finally {
    if (original.window === undefined) delete globalThis.window; else globalThis.window = original.window;
    if (original.document === undefined) delete globalThis.document; else globalThis.document = original.document;
    globalThis.fetch = original.fetch;
    URL.createObjectURL = original.create;
    URL.revokeObjectURL = original.revoke;
  }
}

test("single image downloads preserve original bytes and extension without exposing cookies off-site", async () => {
  await withDownloadBrowser(async ({ saved }) => {
    const downloads = loadModule("lib/image-download.ts");
    let fetched = 0;
    globalThis.fetch = async (url, options) => {
      fetched++;
      assert.equal(new URL(url).origin, window.location.origin);
      assert.equal(options.credentials, "same-origin");
      assert.equal(options.redirect, "error");
      return new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "image/png" } });
    };
    await downloads.downloadSingleImage({ url: "/api/media/image_1", id: "../dangerous", createdAt: start.toISOString() }, new AbortController().signal);
    assert.equal(saved.length, 1);
    assert.match(saved[0].filename, /\.png$/);
    assert.ok(!saved[0].filename.includes("/"));
    assert.deepEqual(new Uint8Array(await saved[0].blob.arrayBuffer()), new Uint8Array([1, 2, 3]));
    await assert.rejects(downloads.downloadSingleImage({ url: "https://evil.example/api/media/test" }, new AbortController().signal), /安全下載/);
    assert.equal(fetched, 1);
  });
});

test("batch downloads deduplicate images, fetch at most three concurrently, and generate a valid lossless ZIP", async () => {
  await withDownloadBrowser(async ({ saved }) => {
    const downloads = loadModule("lib/image-download.ts");
    let active = 0;
    let maximum = 0;
    let fetched = 0;
    globalThis.fetch = async url => {
      fetched++;
      active++;
      maximum = Math.max(maximum, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active--;
      return new Response(new URL(url).pathname, { headers: { "Content-Type": "image/webp" } });
    };
    const images = Array.from({ length: 7 }, (_, index) => ({ url: `/api/media/image_${index}`, id: String(index) }));
    const progress = [];
    await downloads.downloadImageArchive([...images, images[0]], new AbortController().signal, value => progress.push(value));
    assert.equal(fetched, 7);
    assert.equal(maximum, 3);
    assert.equal(saved.length, 1);
    assert.match(saved[0].filename, /\.zip$/);
    const files = unzipSync(new Uint8Array(await saved[0].blob.arrayBuffer()));
    assert.equal(Object.keys(files).length, 7);
    Object.entries(files).forEach(([name, bytes], index) => {
      assert.match(name, /\.webp$/);
      assert.equal(new TextDecoder().decode(bytes), images[index].url);
    });
    assert.equal(progress.at(-1).phase, "packing");
    assert.equal(progress.at(-1).completed, 7);
  });
});

test("failed or cancelled batches never produce partial archives and reject unsafe or oversized selections", async () => {
  await withDownloadBrowser(async ({ saved }) => {
    const downloads = loadModule("lib/image-download.ts");
    globalThis.fetch = async () => new Response("login", { status: 401 });
    await assert.rejects(downloads.downloadImageArchive([{ url: "/api/media/image" }], new AbortController().signal, () => {}), /下載失敗/);
    const aborted = new AbortController();
    aborted.abort();
    globalThis.fetch = async (_url, { signal }) => { signal.throwIfAborted(); throw new Error("unreachable"); };
    await assert.rejects(downloads.downloadImageArchive([{ url: "/api/media/image" }], aborted.signal, () => {}), { name: "AbortError" });
    await assert.rejects(downloads.downloadImageArchive(Array.from({ length: 31 }, (_, index) => ({ url: `/api/media/${index}` })), new AbortController().signal, () => {}), /1 至 30/);
    globalThis.fetch = async () => new Response("", { headers: { "Content-Type": "image/png" } });
    await assert.rejects(downloads.downloadSingleImage({ url: "/api/media/image" }, new AbortController().signal), /空的/);
    globalThis.fetch = async () => new Response("data", { headers: { "Content-Type": "text/html" } });
    await assert.rejects(downloads.downloadSingleImage({ url: "/api/media/image" }, new AbortController().signal), /失效/);
    globalThis.fetch = async () => new Response("data", { headers: { "Content-Type": "image/png", "Content-Length": 9 * 1024 * 1024 } });
    await assert.rejects(downloads.downloadSingleImage({ url: "/api/media/image" }, new AbortController().signal), /大小限制/);
    assert.deepEqual(saved, []);
  });
});
