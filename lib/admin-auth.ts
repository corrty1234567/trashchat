import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

const ADMIN_SESSION_COOKIE = "trashchat_admin";
const ADMIN_SESSION_PAYLOAD = "admin";
const ADMIN_SESSION_MAX_AGE_SECONDS = 6 * 60 * 60;

function getAdminCode() {
  return process.env.TRASHCHAT_ADMIN_CODE?.trim() || "chashtrat";
}

function getAdminSecret() {
  return (
    process.env.TRASHCHAT_ADMIN_SECRET?.trim() ||
    process.env.TRASHCHAT_AUTH_PASSWORD?.trim() ||
    process.env.DATABASE_URL?.trim() ||
    "trashchat-admin-dev-secret"
  );
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
      return decodeURIComponent(valueParts.join("="));
    }
  }

  return null;
}

function createAdminSessionValue() {
  const signature = sign(ADMIN_SESSION_PAYLOAD);
  return `${ADMIN_SESSION_PAYLOAD}.${signature}`;
}

export function isValidAdminCode(code: string) {
  return code.trim().toLowerCase() === getAdminCode().toLowerCase();
}

export function verifyAdminRequest(request: Request) {
  const sessionValue = getCookie(request, ADMIN_SESSION_COOKIE);

  if (!sessionValue) {
    return false;
  }

  const [payload, signature] = sessionValue.split(".");

  if (payload !== ADMIN_SESSION_PAYLOAD || !signature) {
    return false;
  }

  return safeEqual(signature, sign(payload));
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
