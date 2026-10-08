import assert from "node:assert/strict";
import { after, test } from "node:test";
import { NextRequest, NextResponse } from "next/server.js";
import nacl from "tweetnacl";
import { loadModule } from "./helpers/load-typescript.mjs";

const envNames = ["TRASHCHAT_AUTH_PASSWORD", "TRASHCHAT_AUTH_USER", "TRASHCHAT_DATA_KEY", "NODE_ENV"];
const previousEnv = Object.fromEntries(envNames.map((key) => [key, process.env[key]]));
after(() => {
  for (const key of envNames) {
    if (previousEnv[key] === undefined) delete process.env[key];
    else process.env[key] = previousEnv[key];
  }
});
process.env.TRASHCHAT_AUTH_USER = "trashchat";
process.env.TRASHCHAT_AUTH_PASSWORD = "test-only-long-random-password";
process.env.TRASHCHAT_DATA_KEY = "01".repeat(32);

const auth = loadModule("lib/chat-auth.ts");
const { proxy } = loadModule("proxy.ts");
const media = loadModule("lib/media-crypto.ts");
const urls = loadModule("lib/media-urls.ts");
const realtime = loadModule("lib/realtime.ts");
const origin = "https://trashchat.example";
const basic = `Basic ${Buffer.from("trashchat:test-only-long-random-password").toString("base64")}`;
const cookie = () => `${auth.CHAT_SESSION_COOKIE}=${auth.createChatSession()}`;
const request = (path = "/api/messages", options = {}) => new NextRequest(`${origin}${path}`, options);
const authorized = (path = "/api/messages", options = {}) => request(path, {
  ...options, headers: { cookie: cookie(), "sec-fetch-site": "same-origin", ...options.headers }
});

test("missing and example passwords fail closed for both the website and every API", () => {
  for (const password of ["", "short-password", "change-this-password"]) {
    process.env.TRASHCHAT_AUTH_PASSWORD = password;
    assert.equal(auth.isChatAuthConfigured(), false);
    assert.equal(proxy(request("/")).status, 503);
    assert.equal(proxy(request()).status, 503);
  }
  process.env.TRASHCHAT_AUTH_PASSWORD = "test-only-long-random-password";
});

test("configuration errors identify the failed check without exposing credentials", async () => {
  const password = process.env.TRASHCHAT_AUTH_PASSWORD;
  try {
    const cases = [
      [undefined, "missing or empty"],
      ["", "missing or empty"],
      ["   ", "missing or empty"],
      ["change-this-password", "example password"],
      ["private-short", "too short"],
      ["       private-short       ", "too short"]
    ];
    for (const [value, expected] of cases) {
      if (value === undefined) delete process.env.TRASHCHAT_AUTH_PASSWORD;
      else process.env.TRASHCHAT_AUTH_PASSWORD = value;
      assert.ok(auth.getChatAuthConfigurationError().includes(expected));
      for (const path of ["/", "/api/messages"]) {
        const response = proxy(request(path));
        assert.equal(response.status, 503);
        const body = await response.text();
        assert.ok(body.includes("TRASHCHAT_AUTH_PASSWORD"));
        assert.ok(body.includes(expected));
        if (value?.trim()) assert.ok(!body.includes(value.trim()));
        assert.match(response.headers.get("cache-control"), /private.*no-store/);
        assert.equal(response.headers.get("set-cookie"), null);
      }
    }
    process.env.TRASHCHAT_AUTH_PASSWORD = "test-only-long-random-password";
    assert.equal(auth.getChatAuthConfigurationError(), null);
    assert.equal(proxy(request("/")).status, 200);
  } finally {
    if (password === undefined) delete process.env.TRASHCHAT_AUTH_PASSWORD;
    else process.env.TRASHCHAT_AUTH_PASSWORD = password;
  }
});

test("public website entry automatically issues a session without any login challenge", () => {
  process.env.NODE_ENV = "production";
  for (const headers of [{}, { authorization: "Basic invalid" }, { authorization: basic }]) {
    const response = proxy(request("/", { headers }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("www-authenticate"), null);
    const issuedCookie = response.cookies.get(auth.CHAT_SESSION_COOKIE);
    assert.ok(auth.verifyChatSession(issuedCookie.value));
    const header = response.headers.get("set-cookie");
    for (const flag of ["HttpOnly", "Secure", "SameSite=strict"]) assert.ok(header.includes(flag));
    assert.match(response.headers.get("cache-control"), /private.*no-store/);
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.ok(!header.includes(process.env.TRASHCHAT_AUTH_PASSWORD));
  }
});

test("only homepage entry issues a session and direct API failures never challenge for a password", () => {
  for (const path of ["/missing-page", "/_next/webpack-hmr"]) {
    const response = proxy(request(path));
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(response.headers.get("www-authenticate"), null);
  }
  assert.equal(proxy(request("/", { method: "POST" })).headers.get("set-cookie"), null);
  const response = proxy(request("/api/messages"));
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("www-authenticate"), null);
  assert.equal(response.headers.get("set-cookie"), null);
});

test("automatic website sessions work for APIs and revisits keep the existing session", () => {
  const entry = proxy(request("/"));
  const value = entry.cookies.get(auth.CHAT_SESSION_COOKIE).value;
  const headers = { cookie: `${auth.CHAT_SESSION_COOKIE}=${value}`, "sec-fetch-site": "same-origin" };
  for (const path of ["/", "/api/messages", "/api/realtime/auth", "/api/media/example"]) {
    const response = proxy(request(path, { headers }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(response.headers.get("www-authenticate"), null);
  }
});

test("expired website sessions are replaced on homepage entry without prompting for credentials", () => {
  const value = auth.createChatSession(Date.now() - (auth.CHAT_SESSION_MAX_AGE_SECONDS + 1) * 1000);
  const headers = { cookie: `${auth.CHAT_SESSION_COOKIE}=${value}` };
  const api = proxy(request("/api/messages", { headers }));
  assert.equal(api.status, 401);
  assert.equal(api.headers.get("set-cookie"), null);
  const entry = proxy(request("/", { headers }));
  assert.equal(entry.status, 200);
  assert.equal(entry.headers.get("www-authenticate"), null);
  const replacement = entry.cookies.get(auth.CHAT_SESSION_COOKIE).value;
  assert.notEqual(replacement, value);
  assert.ok(auth.verifyChatSession(replacement));
});

test("all API paths reject direct access, including valid Basic credentials without website entry", () => {
  const paths = ["/api/messages", "/api/messages/search?q=hello", "/api/messages/example",
    "/api/messages/read", "/api/members", "/api/upload", "/api/media/example",
    "/api/call", "/api/call/history?sender=CHEN", "/api/images", "/api/typing", "/api/realtime/auth", "/api/admin/messages",
    "/api/admin/database-usage", "/api/admin/blob-usage", "/api/link-preview"];
  for (const path of paths) {
    assert.equal(proxy(request(path)).status, 401, path);
    assert.equal(proxy(request(path, { headers: { authorization: basic } })).status, 401, path);
    assert.equal(proxy(authorized(path)).status, 200, path);
  }
});

test("forged, expired, future, and password-revoked sessions cannot read data", () => {
  const now = 1700000000000;
  const value = auth.createChatSession(now);
  assert.ok(auth.verifyChatSession(value, now));
  assert.equal(auth.verifyChatSession(`${value}x`, now), null);
  assert.equal(auth.verifyChatSession(value.replace(/.$/, "!"), now), null);
  assert.equal(auth.verifyChatSession(value, now - 1000), null);
  assert.equal(auth.verifyChatSession(value, now + auth.CHAT_SESSION_MAX_AGE_SECONDS * 1000), null);
  assert.equal(auth.verifyChatSession("admin.signature", now), null);
  process.env.TRASHCHAT_AUTH_PASSWORD = "a-different-password";
  assert.equal(auth.verifyChatSession(value, now), null);
  process.env.TRASHCHAT_AUTH_PASSWORD = "test-only-long-random-password";
  assert.deepEqual(auth.verifyChatSession(value, now + 86400000), { renew: true });
});

test("cross-origin reads and writes are denied even with a valid session", () => {
  for (const method of ["GET", "POST", "DELETE"]) {
    assert.equal(proxy(authorized("/api/messages", { method, headers: { origin: "https://other.example" } })).status, 403);
    assert.equal(proxy(authorized("/api/messages", { method, headers: { "sec-fetch-site": "same-site" } })).status, 403);
    assert.equal(proxy(authorized("/api/messages", { method, headers: { "sec-fetch-site": "cross-site" } })).status, 403);
  }
  assert.equal(proxy(request("/api/messages", { headers: { origin, "sec-fetch-site": "same-origin" } })).status, 401);
});

test("reverse proxy internal URLs do not block genuine same-origin browser requests", () => {
  const headers = { cookie: cookie(), host: "trashchat.example", origin,
    "x-forwarded-proto": "https", "sec-fetch-site": "same-origin" };
  const internal = new Request("http://localhost:3000/api/messages", { method: "POST", headers });
  assert.equal(auth.verifyChatRequest(internal), true);
  const external = new Request("http://localhost:3000/api/messages", {
    method: "POST", headers: { ...headers, origin: "https://attacker.example", "x-forwarded-host": "attacker.example" }
  });
  assert.equal(auth.verifyChatRequest(external), false);
});

test("API handlers independently reject unauthenticated requests before reading the database or body", async () => {
  const forbidden = () => { throw new Error("Unauthenticated request reached protected data."); };
  const mocks = {
    "@/lib/prisma": { prisma: new Proxy({}, { get: forbidden }) },
    "@/lib/members": { memberExists: forbidden, getMembers: forbidden, createMember: forbidden },
    "@/lib/pusher-server": { notifyMessagesChanged: forbidden, triggerRealtimeEvent: forbidden, getPusherServer: forbidden },
    "@/lib/blob-storage": { deleteBlobUrls: forbidden, getMessageBlobUrls: forbidden },
    "@vercel/blob": { get: forbidden, put: forbidden, list: forbidden, del: forbidden }
  };
  const routes = ["messages", "messages/[id]", "messages/search", "messages/read", "members",
    "members/[id]", "typing", "call", "call/history", "images", "upload", "media/[id]", "link-preview", "realtime/auth",
    "admin/session", "admin/messages", "admin/messages/[id]/recall", "admin/database-usage", "admin/blob-usage", "admin/cleanup"];
  for (const path of routes) {
    const route = loadModule(`app/api/${path}/route.ts`, mocks);
    for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
      if (!route[method]) continue;
      const response = await route[method](request(`/api/${path}`, { method }), { params: Promise.resolve({ id: "example" }) });
      assert.ok([401, 403].includes(response.status), `${method} ${path}`);
    }
  }
});

test("private channel authorization requires the website session and allows only the exact channel", async () => {
  const calls = [];
  const route = loadModule("app/api/realtime/auth/route.ts", {
    "@/lib/pusher-server": { getPusherServer: () => ({ authorizeChannel: (...args) => {
      calls.push(args); return { auth: "test-signed-authorization" };
    } }) }
  });
  const body = (channel = realtime.PUSHER_CHANNEL, socket = "1234.5678") => new URLSearchParams({
    socket_id: socket, channel_name: channel
  }).toString();
  assert.equal((await route.POST(request("/api/realtime/auth", { method: "POST", body: body() }))).status, 401);
  for (const channel of ["trashchat-main", "private-other", "private-trashchat-main-other"]) {
    assert.equal((await route.POST(authorized("/api/realtime/auth", { method: "POST", body: body(channel) }))).status, 403);
  }
  assert.equal((await route.POST(authorized("/api/realtime/auth", { method: "POST", body: body(undefined, "bad:socket") }))).status, 403);
  assert.equal(calls.length, 0);
  const response = await route.POST(authorized("/api/realtime/auth", { method: "POST", body: body() }));
  assert.equal(response.status, 200);
  assert.deepEqual(calls, [["1234.5678", "private-encrypted-trashchat-main"]]);
});

test("new message, typing and call events all use only the private channel", async () => {
  const names = ["PUSHER_APP_ID", "NEXT_PUBLIC_PUSHER_KEY", "PUSHER_SECRET", "PUSHER_CLUSTER"];
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  names.forEach((name) => { process.env[name] = "test-value"; });
  try {
    const calls = [];
    const server = loadModule("lib/pusher-server.ts", { pusher: class {
      trigger(...args) { calls.push(args); return Promise.resolve(); }
    } });
    await server.notifyMessagesChanged({ type: "created", message: { text: "private text" } });
    await server.triggerRealtimeEvent(realtime.PUSHER_EVENT_TYPING_CHANGED, { sender: "CHEN" });
    await server.triggerRealtimeEvent(realtime.PUSHER_EVENT_CALL_SIGNAL, { type: "offer" });
    assert.equal(calls.length, 3);
    assert.ok(calls.every(([channel]) => channel === "private-encrypted-trashchat-main"));
  } finally {
    for (const name of names) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  }
});

test("encrypted browser SDK loads only after mount and is cleaned up without stale connections", async () => {
  const calls = [];
  const client = loadModule("lib/pusher-client.ts", { "pusher-js/with-encryption": class {
    constructor(key, options) { calls.push(["connect", key, options]); }
    subscribe(channel) { calls.push(["subscribe", channel]); return {}; }
    unsubscribe(channel) { calls.push(["unsubscribe", channel]); }
    disconnect() { calls.push(["disconnect"]); }
  } });
  assert.deepEqual(calls, []);
  const cancel = client.connectPrivateRealtime("test-key", "ap3", () => () => {});
  cancel();
  await new Promise(setImmediate);
  assert.deepEqual(calls, []);
  const disconnect = client.connectPrivateRealtime("test-key", "ap3", () => () => calls.push(["unbind"]));
  await new Promise(setImmediate);
  assert.deepEqual(calls[0], ["connect", "test-key", { cluster: "ap3",
    channelAuthorization: { endpoint: "/api/realtime/auth", transport: "ajax" } }]);
  assert.deepEqual(calls[1], ["subscribe", "private-encrypted-trashchat-main"]);
  disconnect();
  assert.deepEqual(calls.slice(2), [["unbind"], ["unsubscribe", "private-encrypted-trashchat-main"], ["disconnect"]]);
});

test("images use authenticated randomized encryption and reject tampering or a wrong key", () => {
  const content = Buffer.from("private-image-test-content");
  const encrypted = media.encryptMedia(content, "image/png");
  assert.equal(encrypted.includes(content), false);
  assert.notDeepEqual(encrypted, media.encryptMedia(content, "image/png"));
  assert.deepEqual(media.decryptMedia(encrypted), { contentType: "image/png", content });
  for (const offset of [0, 8, 20, encrypted.length - 1]) {
    const altered = Buffer.from(encrypted);
    altered[offset] ^= 1;
    assert.throws(() => media.decryptMedia(altered));
  }
  process.env.TRASHCHAT_DATA_KEY = "02".repeat(32);
  assert.throws(() => media.decryptMedia(encrypted));
  process.env.TRASHCHAT_DATA_KEY = "";
  assert.throws(() => media.encryptMedia(content, "image/png"));
  process.env.TRASHCHAT_DATA_KEY = "01".repeat(32);
});

test("the real Pusher SDK encrypts event bodies and keeps large UTF-8 events within its wire limit", async () => {
  const keys = ["PUSHER_APP_ID", "NEXT_PUBLIC_PUSHER_KEY", "PUSHER_SECRET", "PUSHER_CLUSTER"];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  keys.forEach((key) => { process.env[key] = "test-value"; });
  try {
    const server = loadModule("lib/pusher-server.ts");
    const pusher = server.getPusherServer();
    const packets = [];
    pusher.post = async ({ body }) => { packets.push(body); };
    const channelAuth = pusher.authorizeChannel("1234.5678", realtime.PUSHER_CHANNEL);
    const sharedSecret = Buffer.from(channelAuth.shared_secret, "base64");
    for (const length of [50, 2000, 2200, 4000]) {
      const text = "\u4e2d".repeat(length);
      await server.notifyMessagesChanged({ type: "created", id: "message", message: { text } });
      const packet = packets.at(-1);
      const encrypted = JSON.parse(packet.data);
      assert.equal(packet.channels[0], "private-encrypted-trashchat-main");
      assert.ok(Buffer.byteLength(packet.data, "utf8") < 10000);
      assert.equal(packet.data.includes(text), false);
      const decrypted = nacl.secretbox.open(Buffer.from(encrypted.ciphertext, "base64"),
        Buffer.from(encrypted.nonce, "base64"), sharedSecret);
      assert.ok(decrypted);
      assert.equal(JSON.parse(Buffer.from(decrypted).toString()).id, "message");
    }
  } finally {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
});

test("changing the website password revokes old realtime decryption keys without breaking stored images", async () => {
  const keys = ["PUSHER_APP_ID", "NEXT_PUBLIC_PUSHER_KEY", "PUSHER_SECRET", "PUSHER_CLUSTER"];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  keys.forEach((key) => { process.env[key] = "test-value"; });
  try {
    const content = Buffer.from("retained private image");
    const image = media.encryptMedia(content, "image/png");
    const before = loadModule("lib/pusher-server.ts").getPusherServer();
    const previousSecret = Buffer.from(before.authorizeChannel("1234.5678", realtime.PUSHER_CHANNEL).shared_secret, "base64");
    process.env.TRASHCHAT_AUTH_PASSWORD = "a-new-long-random-password";
    const afterRotation = loadModule("lib/pusher-server.ts");
    const pusher = afterRotation.getPusherServer();
    let packet;
    pusher.post = async ({ body }) => { packet = JSON.parse(body.data); };
    await afterRotation.notifyMessagesChanged({ type: "created", id: "message", message: { text: "new private text" } });
    const ciphertext = Buffer.from(packet.ciphertext, "base64");
    const nonce = Buffer.from(packet.nonce, "base64");
    assert.equal(nacl.secretbox.open(ciphertext, nonce, previousSecret), null);
    const currentSecret = Buffer.from(pusher.authorizeChannel("1234.5678", realtime.PUSHER_CHANNEL).shared_secret, "base64");
    assert.ok(nacl.secretbox.open(ciphertext, nonce, currentSecret));
    assert.ok(media.decryptMedia(image).content.equals(content));
  } finally {
    process.env.TRASHCHAT_AUTH_PASSWORD = "test-only-long-random-password";
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
});

test("image uploads never send image plaintext to Blob", async () => {
  let uploaded;
  const route = loadModule("app/api/upload/route.ts", {
    "@vercel/blob": { put: async (pathname, content, options) => {
      uploaded = { pathname, content, options };
      return { url: `https://test.public.blob.vercel-storage.com/${pathname}` };
    } }
  });
  const originalToken = process.env.BLOB_READ_WRITE_TOKEN;
  process.env.BLOB_READ_WRITE_TOKEN = "test-token";
  try {
    const content = Buffer.from("private image bytes");
    const form = new FormData();
    form.set("file", new File([content], "photo.png", { type: "image/png" }));
    const response = await route.POST(authorized("/api/upload", { method: "POST", body: form }));
    assert.equal(response.status, 200);
    assert.match(uploaded.pathname, /^trashchat\/sealed\//);
    assert.equal(uploaded.options.contentType, "application/octet-stream");
    assert.equal(uploaded.content.includes(content), false);
    assert.ok(media.decryptMedia(uploaded.content).content.equals(content));
  } finally {
    if (originalToken === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
    else process.env.BLOB_READ_WRITE_TOKEN = originalToken;
  }
});

test("all message and reply image URLs are replaced with protected same-origin paths", () => {
  const original = "https://test.public.blob.vercel-storage.com/trashchat/sealed/test.bin";
  const { serializeMessage } = loadModule("lib/message-data.ts");
  const base = { imageUrl: original, imageUrls: [original], thumbnailUrls: [original],
    createdAt: new Date(), updatedAt: new Date(), editedAt: null, recalledAt: null, readAt: null, reads: [] };
  const message = serializeMessage({ ...base, replyTo: { ...base } });
  for (const item of [message, message.replyTo]) {
    assert.match(item.imageUrl, /^\/api\/media\//);
    assert.ok(item.imageUrls.every((url) => url.startsWith("/api/media/")));
    assert.ok(item.thumbnailUrls.every((url) => url.startsWith("/api/media/")));
  }
  assert.equal(JSON.stringify(message).includes("blob.vercel-storage.com"), false);
});

test("image delivery requires a session, decrypts only our store paths, and disables caching and scripts", async () => {
  const content = Buffer.from("protected image");
  let gets = 0;
  const route = loadModule("app/api/media/[id]/route.ts", { "@vercel/blob": {
    get: async (pathname) => {
      gets++;
      assert.equal(pathname, "trashchat/sealed/test.bin");
      const encrypted = media.encryptMedia(content, "image/png");
      return { statusCode: 200, stream: new Response(encrypted).body, blob: { size: encrypted.length } };
    }
  } });
  const id = Buffer.from("trashchat/sealed/test.bin").toString("base64url");
  const context = { params: Promise.resolve({ id }) };
  assert.equal((await route.GET(request(`/api/media/${id}`), context)).status, 401);
  assert.equal(gets, 0);
  const response = await route.GET(authorized(`/api/media/${id}`), context);
  assert.equal(response.status, 200);
  assert.ok(Buffer.from(await response.arrayBuffer()).equals(content));
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.match(response.headers.get("content-security-policy"), /sandbox/);
  for (const path of ["../secret", "trashchat/../secret", "trashchat/%2e%2e/secret", "https://other.example/a", "other/file"]) {
    const badId = Buffer.from(path).toString("base64url");
    assert.equal((await route.GET(authorized(), { params: Promise.resolve({ id: badId }) })).status, 404);
  }
  assert.equal(gets, 1);
  assert.equal(urls.getBlobPathname("http://localhost/trashchat/file"), null);
  assert.equal(urls.getBlobPathname("https://blob.vercel-storage.com.evil.example/trashchat/file"), null);
});

function migrationHarness({ existingCopy = false, updateConflict = false, corruptCopy = false, prefix = "trashchat", legacyAlias = false } = {}) {
  const events = [];
  const content = Buffer.from("legacy image contents");
  const url = `https://test.public.blob.vercel-storage.com/${prefix}/old.png`;
  const storedUrl = legacyAlias ? url.replace(".public.blob.", ".blob.") : url;
  let message = { id: "message", updatedAt: new Date(), imageUrl: storedUrl, imageUrls: [storedUrl], thumbnailUrls: [storedUrl] };
  let encrypted = existingCopy ? media.encryptMedia(content, "image/png") : null;
  let deleted = false;
  const hasOld = () => message.imageUrl === storedUrl || message.imageUrls.includes(storedUrl) || message.thumbnailUrls.includes(storedUrl);
  const blob = {
    list: async (options) => ({ blobs: deleted || options.prefix !== `${prefix}/` ? [] : [{ url, pathname: `${prefix}/old.png` }], cursor: undefined }),
    get: async (pathname) => {
      events.push(`get:${pathname.startsWith("trashchat/sealed/") ? "copy" : "original"}`);
      if (pathname === `${prefix}/old.png`) {
        return { statusCode: 200, stream: new Response(content).body, blob: { contentType: "image/png", size: content.length } };
      }
      if (!encrypted) return null;
      const value = Buffer.from(encrypted);
      if (corruptCopy) value[value.length - 1] ^= 1;
      return { statusCode: 200, stream: new Response(value).body, blob: { url: `https://test.public.blob.vercel-storage.com/${pathname}`, size: value.length } };
    },
    put: async (_path, value) => { events.push("put"); encrypted = value; },
    del: async () => { assert.equal(hasOld(), false); events.push("delete"); deleted = true; }
  };
  const prisma = { message: {
    findMany: async () => hasOld() ? [{ ...message }] : [],
    updateMany: async ({ data }) => {
      events.push("update");
      if (!updateConflict) message = { ...message, ...data };
      return { count: updateConflict ? 0 : 1 };
    },
    count: async () => hasOld() ? 1 : 0
  } };
  return { blob, prisma, events, hasOld };
}

test("migration is dry-run by default and makes no storage/database changes", async () => {
  const { migrateLegacyMedia } = loadModule("lib/media-migration.ts");
  const harness = migrationHarness();
  assert.deepEqual(await migrateLegacyMedia(harness), { legacy: 1, migrated: 0 });
  assert.deepEqual(harness.events, []);
  assert.equal(harness.hasOld(), true);
});

test("migration verifies the durable encrypted copy and updates every reference before deleting originals", async () => {
  const { migrateLegacyMedia } = loadModule("lib/media-migration.ts");
  const harness = migrationHarness();
  assert.deepEqual(await migrateLegacyMedia({ ...harness, apply: true }), { legacy: 1, migrated: 1 });
  assert.deepEqual(harness.events, ["get:original", "get:copy", "put", "get:copy", "update", "delete"]);
  assert.equal(harness.hasOld(), false);
  assert.deepEqual(await migrateLegacyMedia({ ...harness, apply: true }), { legacy: 0, migrated: 0 });
});

test("an interrupted migration reuses its verified copy instead of overwriting encrypted files", async () => {
  const { migrateLegacyMedia } = loadModule("lib/media-migration.ts");
  const harness = migrationHarness({ existingCopy: true });
  await migrateLegacyMedia({ ...harness, apply: true });
  assert.equal(harness.events.includes("put"), false);
  assert.equal(harness.events.at(-1), "delete");
});

test("early chorchat uploads are also protected and included in migration", async () => {
  const { migrateLegacyMedia } = loadModule("lib/media-migration.ts");
  const harness = migrationHarness({ prefix: "chorchat" });
  assert.deepEqual(await migrateLegacyMedia({ ...harness, apply: true }), { legacy: 1, migrated: 1 });
  assert.equal(harness.hasOld(), false);
  assert.equal(harness.events.at(-1), "delete");
  assert.match(urls.protectMediaUrl("https://test.public.blob.vercel-storage.com/chorchat/old.png"), /^\/api\/media\//);
});

test("migration updates older Blob hostname aliases before removing the same underlying public file", async () => {
  const { migrateLegacyMedia } = loadModule("lib/media-migration.ts");
  const harness = migrationHarness({ prefix: "chorchat", legacyAlias: true });
  assert.deepEqual(await migrateLegacyMedia({ ...harness, apply: true }), { legacy: 1, migrated: 1 });
  assert.equal(harness.hasOld(), false);
  assert.equal(harness.events.at(-1), "delete");
});

test("legacy 8 MB images can still be encrypted and delivered as verified streams", async () => {
  const content = Buffer.alloc(8 * 1024 * 1024, 42);
  const encrypted = media.encryptMedia(content, "image/png");
  const route = loadModule("app/api/media/[id]/route.ts", { "@vercel/blob": {
    get: async () => ({ statusCode: 200, stream: new Response(encrypted).body, blob: { size: encrypted.length } })
  } });
  const id = Buffer.from("trashchat/sealed/large.bin").toString("base64url");
  const response = await route.GET(authorized(), { params: Promise.resolve({ id }) });
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    assert.ok(value.length <= 64 * 1024);
    assert.ok(value.every((byte) => byte === 42));
    total += value.length;
  }
  assert.equal(total, content.length);
});

test("migration retains original files if verification fails or database changes conflict", async () => {
  const { migrateLegacyMedia } = loadModule("lib/media-migration.ts");
  for (const options of [{ corruptCopy: true }, { updateConflict: true }]) {
    const harness = migrationHarness(options);
    await assert.rejects(migrateLegacyMedia({ ...harness, apply: true }));
    assert.equal(harness.events.includes("delete"), false);
    assert.equal(harness.hasOld(), true);
  }
});

test("admin sessions require an authenticated website session and expire server-side", (t) => {
  const admin = loadModule("lib/admin-auth.ts");
  assert.equal(admin.verifyAdminRequest(request("/api/admin/messages")), false);
  const legacy = authorized("/api/admin/messages", { headers: { cookie: `${cookie()}; trashchat_admin=admin.invalid` } });
  assert.equal(admin.verifyAdminRequest(legacy), false);
  const response = admin.setAdminSessionCookie(NextResponse.json({ ok: true }));
  const adminCookie = response.cookies.get("trashchat_admin").value;
  const headers = { cookie: `${cookie()}; trashchat_admin=${adminCookie}` };
  assert.equal(admin.verifyAdminRequest(request("/api/admin/messages", { headers })), true);
  assert.equal(admin.verifyAdminRequest(request("/api/admin/messages", { headers: { cookie: `trashchat_admin=${adminCookie}` } })), false);
  const now = Date.now();
  t.mock.method(Date, "now", () => now + 6 * 60 * 60 * 1000 + 1000);
  assert.equal(admin.verifyAdminRequest(request("/api/admin/messages", { headers })), false);
});
