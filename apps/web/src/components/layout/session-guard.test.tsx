import { render, waitFor } from "@testing-library/react"
import { expect, test, vi, beforeEach } from "vitest"

import { SessionGuard } from "./session-guard"
import { ApiRequestError } from "@/lib/api/client"
import { mockSession, mockSessionOnboarding } from "@/lib/mocks/fixtures"
import type { Session } from "@/lib/types"

const nav = vi.hoisted(() => ({ pathname: "/projects", replace: vi.fn() }))
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ replace: nav.replace, push: vi.fn() }),
}))

const session = vi.hoisted(() => ({
  data: null as Session | null,
  error: undefined as Error | undefined,
}))
vi.mock("@/hooks/use-session", () => ({
  useSession: () => ({ data: session.data, error: session.error }),
}))

beforeEach(() => {
  nav.pathname = "/projects"
  nav.replace.mockClear()
  session.data = null
  session.error = undefined
})

test("a signed-in user with no workspace goes to onboarding, not to sign-in", async () => {
  // The difference the middleware cannot see: the session cookie is httpOnly, so
  // at the edge this user looks exactly like any other signed-in one. Sending
  // them to /login would have them sign in again and land straight back here.
  session.data = mockSessionOnboarding

  render(<SessionGuard />)

  await waitFor(() =>
    expect(nav.replace).toHaveBeenCalledWith("/onboarding/workspace"),
  )
})

test("a user with a workspace is left where they are", async () => {
  session.data = mockSession

  render(<SessionGuard />)

  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(nav.replace).not.toHaveBeenCalled()
})

test("no session at all goes to sign-in", async () => {
  session.error = new ApiRequestError(401, "NOT_AUTHENTICATED", "Sign in.")

  render(<SessionGuard />)

  await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/login"))
})

test("the onboarding page itself is not redirected to onboarding", async () => {
  session.data = mockSessionOnboarding
  nav.pathname = "/onboarding/workspace"

  render(<SessionGuard />)

  await new Promise((resolve) => setTimeout(resolve, 0))
  // Redirecting a page to itself is a loop, and the browser is the one that
  // notices.
  expect(nav.replace).not.toHaveBeenCalled()
})

test("an invitation kept through sign-in sends the user back to accept it", async () => {
  sessionStorage.setItem("codesage.pendingInvitation", "kept-token")
  session.data = mockSessionOnboarding

  render(<SessionGuard />)

  await waitFor(() =>
    expect(nav.replace).toHaveBeenCalledWith("/invitations/accept"),
  )
  // Before onboarding: joining is the way in, not creating a workspace.
  expect(nav.replace).not.toHaveBeenCalledWith("/onboarding/workspace")
  sessionStorage.removeItem("codesage.pendingInvitation")
})
