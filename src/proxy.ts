import { NextResponse, type NextRequest } from "next/server";

/**
 * Send signed-out visitors of app pages to /login. This only checks that a session cookie exists;
 * the API route handlers are the real security boundary and verify the session on every request.
 * (A stale cookie passes here, then the first API call gets 401 and the client redirects to /login.)
 */
export function proxy(request: NextRequest) {
  if (request.cookies.has("ff_session")) return NextResponse.next();
  const login = new URL("/login", request.url);
  login.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(login);
}

export const config = {
  // App pages only: not the auth pages, the API, the headless render target, or static files.
  matcher: ["/", "/editor/:path*"],
};
