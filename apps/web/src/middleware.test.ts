import { describe, expect, test } from "vitest"
import { NextRequest } from "next/server"

import { middleware } from "./middleware"

function requestFor(path: string, cookie?: string): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    headers: cookie ? { cookie } : {},
  })
}

describe("middleware", () => {
  test("signed out, the root goes straight to sign-in", () => {
    const response = middleware(requestFor("/"))

    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe("http://localhost:3000/login")
  })

  test("signed in, the root goes straight into the app", () => {
    const response = middleware(requestFor("/", "codesage_session=abc123"))

    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/projects",
    )
  })

  test("/login is never redirected, even with a cookie — it may be stale", () => {
    const response = middleware(
      requestFor("/login?error=session", "codesage_session=stale"),
    )

    expect(response.headers.get("location")).toBeNull()
  })

  test("the login path is public", () => {
    const response = middleware(requestFor("/login"))

    expect(response.headers.get("location")).toBeNull()
  })

  test("the invitation page is public, so the token survives until sign-in", () => {
    const response = middleware(requestFor("/invitations/accept?token=abc"))

    expect(response.headers.get("location")).toBeNull()
  })

  test("redirects to /login when the session cookie is missing", () => {
    const response = middleware(requestFor("/projects"))

    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe("http://localhost:3000/login")
  })

  test("passes the request through when the session cookie is present", () => {
    const response = middleware(
      requestFor("/projects", "codesage_session=abc123"),
    )

    expect(response.headers.get("location")).toBeNull()
  })

  test("an unrelated cookie does not count as a session", () => {
    const response = middleware(
      requestFor("/dashboard/demo-repo", "sidebar_state=expanded"),
    )

    expect(response.headers.get("location")).toBe("http://localhost:3000/login")
  })
})
