import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export const CHAT_SESSION_COOKIE = "trashchat_session";
export const CHAT_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const SESSION_RENEW_AFTER_SECONDS = 24 * 60 * 60;

export function getChatAuthConfigurationError() {
  const password = process.env.TRASHCHAT_AUTH_PASSWORD;
  if (!password || !password.trim()) {
    return "TRASHCHAT_AUTH_PASSWORD is missing or empty in this deployment. Set it in the project's Production environment and redeploy.";
  }
  if (password === "change-this-password") {
    return "TRASHCHAT_AUTH_PASSWORD still uses the example password. Set a private password of at least 16 characters and redeploy.";
  }
  if (password.trim().length < 16) {
    return "TRASHCHAT_AUTH_PASSWORD is too short. Use at least 16 characters, excluding leading and trailing spaces, and redeploy.";
  }
  return null;
}

function getCredentials() {
  const password = process.env.TRASHCHAT_AUTH_PASSWORD;
  if (!password || getChatAuthConfigurationError()) return null;
  return { user: process.env.TRASHCHAT_AUTH_USER || "trashchat", password };
}

export function isChatAuthConfigured() {
  return getCredentials() !== null;
}

function safeEqual(first: string, second: string) {
  const a = Buffer.from(first);
  const b = Buffer.from(second);
  return a.length === b.length && timingSafeEqual(a, b);
}

function sign(payload: string) {
  const credentials = getCredentials();
  if (!credentials) throw new Error("Chat authentication is not configured.");
  return createHmac("sha256", credentials.password)
    .update(`trashchat-session-v1:${credentials.user}:${payload}`).digest("base64url");
}

export function createChatSession(now = Date.now()) {
  const issuedAt = Math.floor(now / 1000);
  const payload = `${issuedAt}.${issuedAt + CHAT_SESSION_MAX_AGE_SECONDS}.${randomUUID()}`;
  return `${payload}.${sign(payload)}`;
}

export function verifyChatSession(value: string | undefined | null, now = Date.now()) {
  if (!value || value.length > 256 || !isChatAuthConfigured()) return null;
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const [issued, expires, nonce, signature] = parts;
  const issuedAt = Number(issued);
  const expiresAt = Number(expires);
  const current = Math.floor(now / 1000);
  if (!Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(expiresAt) ||
      issuedAt > current || expiresAt <= current ||
      expiresAt - issuedAt !== CHAT_SESSION_MAX_AGE_SECONDS ||
      !/^[a-f0-9-]{36}$/.test(nonce) || !safeEqual(signature, sign(`${issued}.${expires}.${nonce}`))) return null;
  return { renew: current - issuedAt >= SESSION_RENEW_AFTER_SECONDS };
}

export function getChatSession(request: Request) {
  const cookies = request.headers.get("cookie")?.split(";") ?? [];
  const cookie = cookies.find((part) => part.trim().startsWith(`${CHAT_SESSION_COOKIE}=`));
  return cookie?.trim().slice(CHAT_SESSION_COOKIE.length + 1) ?? null;
}

export function isSameOriginRequest(request: Request) {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const url = new URL(request.url);
    // Next may expose an internal localhost URL behind its reverse proxy.
    const host = request.headers.get("host") || url.host;
    const protocol = request.headers.get("x-forwarded-proto") || url.protocol.slice(0, -1);
    if (protocol !== "http" && protocol !== "https") return false;
    return origin === new URL(`${protocol}://${host}`).origin;
  } catch {
    return false;
  }
}

export function verifyChatRequest(request: Request) {
  return isSameOriginRequest(request) && verifyChatSession(getChatSession(request)) !== null;
}

export function requireChatAccess(request: Request) {
  return verifyChatRequest(request) ? null : Response.json(
    { error: "Website session required." },
    { status: 401, headers: { "Cache-Control": "private, no-store" } }
  );
}
