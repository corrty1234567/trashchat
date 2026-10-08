import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { verifyChatRequest } from "@/lib/chat-auth";

const ADMIN_SESSION_COOKIE = "trashchat_admin";
const ADMIN_SESSION_MAX_AGE_SECONDS = 6 * 60 * 60;

function getAdminCode() {
  return process.env.TRASHCHAT_ADMIN_CODE?.trim() || "chashtrat";
}

function getAdminSecret() {
  const password = process.env.TRASHCHAT_AUTH_PASSWORD;
  if (!password) throw new Error("Chat authentication is not configured.");
  return `${process.env.TRASHCHAT_ADMIN_SECRET || password}:${password}`;
}

function sign(value: string) {
  return createHmac("sha256", getAdminSecret()).update(value).digest("base64url");
}

function safeEqual(first: string, second: string) {
  const firstBuffer = Buffer.from(first);
  const secondBuffer = Buffer.from(second);

  return firstBuffer.length === secondBuffer.length && timingSafeEqual(firstBuffer, secondBuffer);
}

function getCookie(request: Request, name: string) {
  const cookieHeader = request.headers.get("cookie");

  if (!cookieHeader) {
    return null;
  }

  for (const cookie of cookieHeader.split(";")) {
    const [cookieName, ...valueParts] = cookie.trim().split("=");

    if (cookieName === name) {
      return valueParts.join("=");
    }
  }

  return null;
}

function createAdminSessionValue() {
  const expires = Math.floor(Date.now() / 1000) + ADMIN_SESSION_MAX_AGE_SECONDS;
  const payload = `admin.${expires}.${randomUUID()}`;
  return `${payload}.${sign(payload)}`;
}

export function isValidAdminCode(code: string) {
  return code.trim().toLowerCase() === getAdminCode().toLowerCase();
}

export function verifyAdminRequest(request: Request) {
  if (!verifyChatRequest(request)) return false;
  const sessionValue = getCookie(request, ADMIN_SESSION_COOKIE);

  if (!sessionValue) {
    return false;
  }

  const [role, expires, nonce, signature, extra] = sessionValue.split(".");
  const expiresAt = Number(expires);
  const now = Math.floor(Date.now() / 1000);

  if (role !== "admin" || !signature || extra !== undefined || !/^[a-f0-9-]{36}$/.test(nonce ?? "") ||
      !Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + ADMIN_SESSION_MAX_AGE_SECONDS) {
    return false;
  }

  return safeEqual(signature, sign(`${role}.${expires}.${nonce}`));
}

export function requireAdmin(request: Request) {
  if (verifyAdminRequest(request)) {
    return null;
  }

  return NextResponse.json({ error: "Admin access required." }, { status: 403 });
}

export function setAdminSessionCookie(response: NextResponse) {
  response.cookies.set({
    name: ADMIN_SESSION_COOKIE,
    value: createAdminSessionValue(),
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ADMIN_SESSION_MAX_AGE_SECONDS
  });

  return response;
}
