import { NextResponse, type NextRequest } from "next/server"

// Must match the session cookie name the API sets.
const SESSION_COOKIE =
  process.env.NEXT_PUBLIC_SESSION_COOKIE_NAME ?? "codesage_session"

const PUBLIC_PATHS = new Set([
  "/login",
  "/guide",
  "/invitations/accept",
  "/privacy",
])

export function middleware(request: NextRequest) {
  const signedIn = request.cookies.has(SESSION_COOKIE)

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
