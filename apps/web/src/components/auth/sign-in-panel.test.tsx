import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { http, HttpResponse } from "msw"
import { beforeEach, expect, test, vi } from "vitest"

import { SignInPanel } from "./sign-in-panel"
import { server } from "@/lib/mocks/server"
import { markSignedOut, resetSignedOutNotice } from "@/lib/sign-in"
import { mockSession } from "@/lib/mocks/fixtures"

const nav = vi.hoisted(() => ({ replace: vi.fn() }))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: vi.fn() }),
}))

const HREF = "http://api.test/api/auth/login"

// The shared handlers leave the session to the real API in dev, so each test
// says which answer it wants.
const signedOut = () =>
  server.use(
    http.get("*/api/auth/session", () =>
      HttpResponse.json(
        { detail: "Sign in.", code: "NOT_AUTHENTICATED" },
        { status: 401 },
      ),
    ),
  )

beforeEach(() => {
  nav.replace.mockClear()
  sessionStorage.clear()
  resetSignedOutNotice()
})

test("one link, straight to the API's sign-in", async () => {
  signedOut()
  render(<SignInPanel href={HREF} />)

  expect(
    screen.getByRole("link", { name: /sign in with asgardeo/i }),
  ).toHaveAttribute("href", HREF)
})

test("a sign-in error is shown above the button", () => {
  signedOut()
  render(<SignInPanel href={HREF} error="Sign-in took too long." />)

  expect(screen.getByRole("alert")).toHaveTextContent("Sign-in took too long.")
})

test("after sign-out it says so, once", () => {
  signedOut()
  markSignedOut()
  const { unmount } = render(<SignInPanel href={HREF} />)
  expect(screen.getByRole("status")).toHaveTextContent("You're signed out.")
  unmount()

  resetSignedOutNotice() // a refresh
  render(<SignInPanel href={HREF} />)
  expect(screen.queryByRole("status")).toBeNull()
})

test("an error outranks the signed-out note", () => {
  signedOut()
  markSignedOut()
  render(<SignInPanel href={HREF} error="Your session ended." />)

  expect(screen.getByRole("alert")).toBeVisible()
  expect(screen.queryByRole("status")).toBeNull()
})

test("a live session skips the page", async () => {
  server.use(
    http.get("*/api/auth/session", () => HttpResponse.json(mockSession)),
  )
  render(<SignInPanel href={HREF} />)

  await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/projects"))
})

test("no live session: the page stays", async () => {
  signedOut()
  render(<SignInPanel href={HREF} />)

  await new Promise((resolve) => setTimeout(resolve, 50))
  expect(nav.replace).not.toHaveBeenCalled()
})

test("the first click shows progress and a second click does nothing", async () => {
  signedOut()
  render(<SignInPanel href={HREF} />)
  const link = screen.getByRole("link", { name: /sign in with asgardeo/i })
  // On the document, so it runs after React's handler has had its say; jsdom
  // cannot navigate, so the default is stopped here once recorded.
  const clicks: boolean[] = []
  const record = (event: MouseEvent) => {
    clicks.push(event.defaultPrevented)
    event.preventDefault()
  }
  document.addEventListener("click", record)

  await userEvent.click(link)
  expect(link).toHaveTextContent("Redirecting to Asgardeo…")
  expect(link).toHaveAttribute("aria-disabled", "true")

  await userEvent.click(link)
  // The first click went through; the second was stopped by the panel.
  expect(clicks).toEqual([false, true])
  document.removeEventListener("click", record)
})
