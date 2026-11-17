import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Optimistic gate only: bounces visitors with no session cookie to /login.
 * Real authorization happens in getCtx()/requirePermission() next to the data.
 */
export function proxy(request: NextRequest) {
  if (getSessionCookie(request)) return NextResponse.next();
  const url = new URL("/login", request.url);
  const path = request.nextUrl.pathname;
  if (path !== "/") url.searchParams.set("next", path);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!api|_next|login|signup|invite|favicon.ico|.*\\..*).*)"],
};
