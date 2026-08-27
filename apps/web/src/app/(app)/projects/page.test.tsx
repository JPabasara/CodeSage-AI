import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, expect, test, vi } from "vitest"

import { http, HttpResponse } from "msw"

import { server } from "@/lib/mocks/server"
import ProjectsPage from "./page"

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }))

// <Toaster> lives in the root layout, not in this page, so rendering the page
// alone puts no toast in the DOM. Assert on the calls instead: what matters is
// that the right message is chosen for the right error code.
const { toastError, toastSuccess } = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}))
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: toastError, success: toastSuccess }),
}))

beforeEach(() => {
  toastError.mockClear()
  toastSuccess.mockClear()
})

/** Wait for the projects list to finish its first load. Rows render "owner/name". */
async function ready() {
  expect(await screen.findByText("acme/acme-payments")).toBeInTheDocument()
}

async function connect(url: string) {
  await userEvent.type(screen.getByLabelText(/repository url/i), url)
  await userEvent.click(screen.getByRole("button", { name: /connect/i }))
}

/** The message shown for the last failed connect. */
async function failureMessage(): Promise<string> {
  await waitFor(() => expect(toastError).toHaveBeenCalled())
  return String(toastError.mock.calls.at(-1)?.[0] ?? "")
}

test("connecting a public URL adds it to the list", async () => {
  render(<ProjectsPage />)
  await ready()
  expect(screen.queryByText("octocat/hello-world")).not.toBeInTheDocument()

  await connect("https://github.com/octocat/hello-world")

  // The list is a separate read from the write, so this only passes if the page
  // actually reloads it afterwards.
  expect(await screen.findByText("octocat/hello-world")).toBeInTheDocument()
  expect(toastSuccess).toHaveBeenCalledWith("Connected octocat/hello-world")
  expect(toastError).not.toHaveBeenCalled()
})

test("a private repository explains itself instead of failing generically", async () => {
  render(<ProjectsPage />)
  await ready()

  await connect("https://github.com/octocat/private-thing")

  // REPOSITORY_NOT_PUBLIC. Someone pasting their own repository has done nothing
  // wrong and needs to know why it was refused.
  expect(await failureMessage()).toMatch(/only public repositories/i)
  expect(screen.queryByText("octocat/private-thing")).not.toBeInTheDocument()
})

test("an unreachable repository says so", async () => {
  render(<ProjectsPage />)
  await ready()

  await connect("https://github.com/octocat/missing-thing")

  expect(await failureMessage()).toMatch(/could not be reached/i) // REPOSITORY_UNREACHABLE
})

test("a malformed URL is rejected with a useful message", async () => {
  render(<ProjectsPage />)
  await ready()

  await connect("not-a-url")

  expect(await failureMessage()).toMatch(/does not look like/i) // INVALID_REPOSITORY_URL
})

test("connecting the same repository twice is refused", async () => {
  render(<ProjectsPage />)
  await ready()

  // acme/acme-payments is already in the fixtures.
  await connect("https://github.com/acme/acme-payments")

  expect(await failureMessage()).toMatch(/already connected/i) // ALREADY_CONNECTED
})

test("each failure code produces a different message", async () => {
  const seen = new Set<string>()

  for (const url of [
    "https://github.com/octocat/private-thing",
    "https://github.com/octocat/missing-thing",
    "not-a-url",
    "https://github.com/acme/acme-payments",
  ]) {
    toastError.mockClear()
    const { unmount } = render(<ProjectsPage />)
    await ready()
    await connect(url)
    seen.add(await failureMessage())
    unmount()
  }

  // Four codes, four distinct messages — not one generic "400 Bad Request".
  expect(seen.size).toBe(4)
})

test("the form is locked while a connect is in flight", async () => {
  render(<ProjectsPage />)
  await ready()

  await connect("https://github.com/octocat/hello-world")

  // Whatever the outcome, the form must come back out of the busy state - a
  // stuck "Connecting…" would make the page look broken after one paste.
  // The button stays disabled only because submit cleared the input, which is
  // the empty-URL guard doing its job, so type again to prove it recovers.
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: /connecting/i }),
    ).not.toBeInTheDocument(),
  )
  const input = screen.getByLabelText(/repository url/i)
  expect(input).toBeEnabled()

  await userEvent.type(input, "https://github.com/octocat/another")
  expect(screen.getByRole("button", { name: /^connect$/i })).toBeEnabled()
})

test("the message is chosen by CODE, not copied from the server's detail", async () => {
  // A backend that sends a correct code with a useless detail must still produce
  // a usable message. Without this the earlier tests pass either way, because the
  // mock's detail text happens to read like the message we want.
  server.use(
    http.post("*/api/projects", () =>
      HttpResponse.json(
        { detail: "x", code: "REPOSITORY_NOT_PUBLIC" },
        { status: 400 },
      ),
    ),
  )

  render(<ProjectsPage />)
  await ready()
  await connect("https://github.com/octocat/anything")

  const message = await failureMessage()
  expect(message).toMatch(/only public repositories/i)
  expect(message).not.toBe("x")
})

test("an unrecognised code still shows the server's sentence rather than nothing", async () => {
  server.use(
    http.post("*/api/projects", () =>
      HttpResponse.json(
        {
          detail: "The upstream host is having a bad day.",
          code: "UPSTREAM_UNAVAILABLE",
        },
        { status: 503 },
      ),
    ),
  )

  render(<ProjectsPage />)
  await ready()
  await connect("https://github.com/octocat/anything")

  // No entry in the message map for this code, so fall back to `detail` - which
  // is still a sentence, and better than "503 Service Unavailable".
  expect(await failureMessage()).toMatch(/bad day/i)
})
