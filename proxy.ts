import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CHAT_SESSION_COOKIE, CHAT_SESSION_MAX_AGE_SECONDS, createChatSession,
  getChatAuthConfigurationError, isSameOriginRequest, verifyChatCredentials, verifyChatSession
} from "@/lib/chat-auth";

function protectResponse(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Vary", "Cookie, Authorization");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("Cross-Origin-Resource-Policy", "same-origin");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  return response;
}

export function proxy(request: NextRequest) {
  const configurationError = getChatAuthConfigurationError();
  if (configurationError) {
    return protectResponse(new NextResponse(configurationError, { status: 503 }));
  }

  const isApi = request.nextUrl.pathname.startsWith("/api/");
  const session = verifyChatSession(request.cookies.get(CHAT_SESSION_COOKIE)?.value);
  if (isApi && !isSameOriginRequest(request)) {
    return protectResponse(NextResponse.json({ error: "Cross-origin access denied." }, { status: 403 }));
  }

  // API credentials are issued only after authenticated entry through the website.
  if (!session && (isApi || !verifyChatCredentials(request.headers.get("authorization")))) {
    const response = isApi
      ? NextResponse.json({ error: "Website session required." }, { status: 401 })
      : new NextResponse("Authentication required.", {
          status: 401,
          headers: { "WWW-Authenticate": 'Basic realm="trashchat", charset="UTF-8"' }
        });
    return protectResponse(response);
  }

  const response = protectResponse(NextResponse.next());
  if (!session || session.renew) {
    response.cookies.set({
      name: CHAT_SESSION_COOKIE,
      value: createChatSession(),
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: CHAT_SESSION_MAX_AGE_SECONDS
    });
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"]
};
