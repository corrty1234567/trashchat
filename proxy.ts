import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

function unauthorized() {
  return new NextResponse("Authentication required.", {
    status: 401,
    headers: {
      "Cache-Control": "no-store",
      "WWW-Authenticate": 'Basic realm="trashchat", charset="UTF-8"'
    }
  });
}

function parseBasicAuth(value: string | null) {
  if (!value?.startsWith("Basic ")) {
    return null;
  }

  try {
    const decoded = atob(value.slice("Basic ".length));
    const separatorIndex = decoded.indexOf(":");

    if (separatorIndex < 0) {
      return null;
    }

    return {
      password: decoded.slice(separatorIndex + 1),
      user: decoded.slice(0, separatorIndex)
    };
  } catch {
    return null;
  }
}

export function proxy(request: NextRequest) {
  const expectedPassword = process.env.TRASHCHAT_AUTH_PASSWORD;

  if (!expectedPassword) {
    return NextResponse.next();
  }

  const expectedUser = process.env.TRASHCHAT_AUTH_USER ?? "trashchat";
  const credentials = parseBasicAuth(request.headers.get("authorization"));

  if (credentials?.user !== expectedUser || credentials.password !== expectedPassword) {
    return unauthorized();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
