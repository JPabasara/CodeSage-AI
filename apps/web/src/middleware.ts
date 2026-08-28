import { NextResponse, type NextRequest } from "next/server"

// Must match the session cookie name the API sets. The cookie is httpOnly, so
// this can only check that it exists, never that it is still valid — the API
// re-checks on every request. A redirect for the common case, not the security
// boundary.
const SESSION_COOKIE =
  process.env.NEXT_PUBLIC_SESSION_COOKIE_NAME ?? "codesage_session"

export function middleware(request: NextRequest) {
  if (!request.cookies.has(SESSION_COOKIE)) {
    return NextResponse.redirect(new URL("/login", request.url))
  }
  return NextResponse.next()
}

export const config = {
  // Everything except: Next's own build/image assets, anything that looks like
  // a static file (has a "." in its last segment — favicon.ico, the MSW worker
  // script, etc.), and /login itself — protecting the destination would loop.
  matcher: ["/((?!_next/static|_next/image|login|.*\\..*).*)"],
}
