import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/modules/auth/client";

/**
 * A quick first check: a page needs a session cookie, or the visitor is sent
 * to /login. Only whether the cookie exists is looked at (no database here);
 * the real check is `requireUser()` next to the data, which also catches an
 * expired or forged cookie. The API routes have their own key.
 */
export function proxy(request: NextRequest) {
  if (!request.cookies.has(SESSION_COOKIE)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|login|signup|_next/static|_next/image|favicon.ico).*)"],
};
