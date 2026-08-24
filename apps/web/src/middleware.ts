import { NextResponse, type NextRequest } from "next/server";

// Same default as the API's CODESAGE_SESSION_COOKIE_NAME (apps/api/.env.example).
// The cookie is httpOnly, so this can only check that it EXISTS, never whether
// it is still valid — that check happens once per request at the API (SEC-10).
// This is a UX redirect for the common case, not the security boundary.
const SESSION_COOKIE =
  process.env.NEXT_PUBLIC_SESSION_COOKIE_NAME ?? "codesage_session";

export function middleware(request: NextRequest) {
  if (!request.cookies.has(SESSION_COOKIE)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  // Everything except: Next's own build/image assets, anything that looks like
  // a static file (has a "." in its last segment — favicon.ico, the MSW worker
  // script, etc.), and /login itself — protecting the destination would loop.
  matcher: ["/((?!_next/static|_next/image|login|.*\\..*).*)"],
};
