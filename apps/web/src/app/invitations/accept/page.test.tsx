import { render, screen, waitFor } from "@testing-library/react"
import { beforeEach, expect, test, vi } from "vitest"

import AcceptInvitationPage from "./page"
import * as client from "@/lib/api/client"
import { ApiRequestError, getWorkspaces } from "@/lib/api/client"
import { readPendingInvitation } from "@/lib/pending-invitation"
import {
  INVITED_WORKSPACE_ID,
  MOCK_INVITATION_TOKEN,
  mockSession,
} from "@/lib/mocks/fixtures"
import type { Session } from "@/lib/types"

const nav = vi.hoisted(() => ({ replace: vi.fn(), search: "" }))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.search),
}))

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}))

const session = vi.hoisted(() => ({
  data: null as Session | null,
  error: undefined as Error | undefined,
}))
vi.mock("@/hooks/use-session", () => ({
  useSession: () => ({ data: session.data, error: session.error }),
}))

beforeEach(() => {
  nav.replace.mockClear()
  nav.search = ""
  session.data = mockSession
  session.error = undefined
  sessionStorage.clear()
})

test("a valid token joins, switches to that workspace and enters it", async () => {
  nav.search = `token=${MOCK_INVITATION_TOKEN}`
  const accept = vi.spyOn(client, "acceptInvitation")
  render(<AcceptInvitationPage />)

  // The token leaves the address bar straight away.
  await waitFor(() =>
    expect(nav.replace).toHaveBeenCalledWith("/invitations/accept"),
  )
  await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/projects"))
  expect(accept).toHaveBeenCalledTimes(1)
  expect(readPendingInvitation()).toBeNull()

  const active = (await getWorkspaces()).find((w) => w.is_active)
  expect(active?.workspace_id).toBe(INVITED_WORKSPACE_ID)
  expect(active?.role).toBe("developer")
  accept.mockRestore()
})

test("an unusable token gets one plain answer, whatever the reason", async () => {
  nav.search = "token=expired-or-revoked-or-used-token-000000000"
  render(<AcceptInvitationPage />)

  expect(
    await screen.findByRole("heading", {
      name: /this invitation can.t be used/i,
    }),
  ).toBeVisible()
  expect(nav.replace).not.toHaveBeenCalledWith("/projects")
  expect(readPendingInvitation()).toBeNull()
})

test("signed out: the token is kept and sign-in is offered", async () => {
  nav.search = `token=${MOCK_INVITATION_TOKEN}`
  session.data = null
  session.error = new ApiRequestError(401, "NOT_AUTHENTICATED", "Sign in.")
  const accept = vi.spyOn(client, "acceptInvitation")
  render(<AcceptInvitationPage />)

  expect(
    await screen.findByRole("heading", { name: /sign in to accept/i }),
  ).toBeVisible()
  // Straight to sign-in, with this page (token included) as `return_to`, so the
  // invitee comes back here even from the email-verification tab.
  const href = screen
    .getByRole("link", { name: "Sign in" })
    .getAttribute("href")
  const signIn = new URL(href ?? "")
  expect(signIn.pathname).toBe("/api/auth/login")
  expect(signIn.searchParams.get("return_to")).toBe(
    `/invitations/accept?token=${MOCK_INVITATION_TOKEN}`,
  )
  expect(readPendingInvitation()).toBe(MOCK_INVITATION_TOKEN)
  expect(accept).not.toHaveBeenCalled()
  accept.mockRestore()
})

test("back from sign-in, the kept token is accepted without the URL", async () => {
  sessionStorage.setItem("codesage.pendingInvitation", MOCK_INVITATION_TOKEN)
  render(<AcceptInvitationPage />)

  await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/projects"))
})

test("no token at all says the link is incomplete", async () => {
  render(<AcceptInvitationPage />)

  expect(
    await screen.findByRole("heading", { name: /link is incomplete/i }),
  ).toBeVisible()
})
