import { NextResponse, type NextRequest } from "next/server"

// Must match the session cookie name the API sets. The cookie is httpOnly, so
// this can only check that it exists, never that it is still valid — the API
// re-checks on every request. A redirect for the common case, not the security
// boundary.
const SESSION_COOKIE =
  process.env.NEXT_PUBLIC_SESSION_COOKIE_NAME ?? "codesage_session"

// The invitation page is public so a signed-out visitor can land on it and have
// the token kept before sign-in; it asks for sign-in itself.
const PUBLIC_PATHS = new Set(["/login", "/invitations/accept"])

export function middleware(request: NextRequest) {
  const signedIn = request.cookies.has(SESSION_COOKIE)

  // `/` is only an address: send it to the one screen that fits. `/login` is
  // never redirected here — a cookie is not proof of a live session, and a
  // stale one would loop /login → /projects → 401 → /login. The login page asks
  // the API instead.
  if (request.nextUrl.pathname === "/") {
    return NextResponse.redirect(
      new URL(signedIn ? "/projects" : "/login", request.url),
    )
  }

  if (PUBLIC_PATHS.has(request.nextUrl.pathname)) {
    return NextResponse.next()
  }

  if (!signedIn) {
    return NextResponse.redirect(new URL("/login", request.url))
  }
  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|login|.*\\..*).*)"],
}
