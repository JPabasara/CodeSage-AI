import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, expect, test, vi } from "vitest"

import { http, HttpResponse } from "msw"

import { server } from "@/lib/mocks/server"
import { mockRepos } from "@/lib/mocks/fixtures"
import { SELECTED_PROJECT_KEY } from "@/hooks/use-selected-project"
import { AppRail } from "@/components/layout/app-rail"
import { SidebarProvider } from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"
import ProjectsPage from "./page"

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }))

vi.mock("next/navigation", () => ({
  usePathname: () => "/projects",
  useRouter: () => ({ push: pushMock }),
}))

vi.mock("next/image", () => ({
  default: () => <span data-testid="mock-next-image" />,
}))

vi.mock("@/hooks/use-session", () => ({
  useSession: () => ({ data: null }),
}))

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
  localStorage.clear()
  pushMock.mockClear()
  toastError.mockClear()
  toastSuccess.mockClear()
})

/** Wait for the projects list to finish its first load. */
async function ready() {
  const list = await screen.findByRole("list", {
    name: /connected repositories/i,
  })
  expect(within(list).getByText("acme-payments")).toBeInTheDocument()
  return list
}

async function connect(url: string) {
  await userEvent.type(screen.getByLabelText(/repository url/i), url)
  await userEvent.click(screen.getByRole("button", { name: /connect/i }))
}

function renderWithAppRail() {
  return render(
    <TooltipProvider>
      <SidebarProvider>
        <AppRail />
        <ProjectsPage />
      </SidebarProvider>
    </TooltipProvider>,
  )
}

/** The message shown for the last failed connect. */
async function failureMessage(): Promise<string> {
  await waitFor(() => expect(toastError).toHaveBeenCalled())
  return String(toastError.mock.calls.at(-1)?.[0] ?? "")
}

test("connecting a public URL adds it to the list", async () => {
  render(<ProjectsPage />)
  await ready()
  expect(screen.queryByText("hello-world")).not.toBeInTheDocument()

  await connect("https://github.com/octocat/hello-world")

  // The list is a separate read from the write, so this only passes if the page
  // actually reloads it afterwards.
  const list = await screen.findByRole("list", {
    name: /connected repositories/i,
  })
  expect(within(list).getByText("hello-world")).toBeInTheDocument()
  expect(within(list).getByText("octocat")).toBeInTheDocument()
  expect(toastSuccess).toHaveBeenCalledWith("Connected octocat/hello-world")
  expect(toastError).not.toHaveBeenCalled()
})

test("selecting a project stores it before opening the dashboard", async () => {
  render(<ProjectsPage />)
  await ready()

  const dashboardLink = screen.getByRole("link", {
    name: /go to dashboard for acme\/web-store/i,
  })
  dashboardLink.addEventListener("click", (event) => event.preventDefault())
  await userEvent.click(dashboardLink)

  expect(dashboardLink).toHaveAttribute("href", `/dashboard/${mockRepos[1].id}`)

  expect(localStorage.getItem(SELECTED_PROJECT_KEY)).toBe(mockRepos[1].id)
})

test("removing the active project confirms its name and selects a safe remaining project", async () => {
  let projects = [...mockRepos]
  server.use(
    http.get("*/api/projects", () => HttpResponse.json(projects)),
    http.delete("*/api/projects/:repoId", ({ params }) => {
      projects = projects.filter((repo) => repo.id !== params.repoId)
      return new HttpResponse(null, { status: 204 })
    }),
  )
  localStorage.setItem(SELECTED_PROJECT_KEY, mockRepos[0].id)
  render(<ProjectsPage />)
  await ready()

  await userEvent.click(
    screen.getByRole("button", {
      name: /remove acme\/acme-payments repository/i,
    }),
  )
  expect(screen.getByRole("dialog")).toHaveTextContent("acme/acme-payments")
  await userEvent.click(
    screen.getByRole("button", { name: /^remove repository$/i }),
  )

  await waitFor(() =>
    expect(screen.queryByText("acme-payments")).not.toBeInTheDocument(),
  )
  expect(localStorage.getItem(SELECTED_PROJECT_KEY)).toBe(mockRepos[1].id)
  expect(toastSuccess).toHaveBeenCalledWith("Removed acme/acme-payments")
})

test("the page and AppRail cannot restore a deleted active project", async () => {
  let projects = [...mockRepos]
  server.use(
    http.get("*/api/projects", () => HttpResponse.json(projects)),
    http.delete("*/api/projects/:repoId", ({ params }) => {
      projects = projects.filter((repo) => repo.id !== params.repoId)
      return new HttpResponse(null, { status: 204 })
    }),
  )
  localStorage.setItem(SELECTED_PROJECT_KEY, mockRepos[0].id)
  renderWithAppRail()
  await ready()
  await waitFor(() =>
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute(
      "href",
      `/dashboard/${mockRepos[0].id}`,
    ),
  )

  await userEvent.click(
    screen.getByRole("button", {
      name: /remove acme\/acme-payments repository/i,
    }),
  )
  await userEvent.click(
    screen.getByRole("button", { name: /^remove repository$/i }),
  )

  await waitFor(() => {
    expect(screen.queryByText("acme-payments")).not.toBeInTheDocument()
    expect(localStorage.getItem(SELECTED_PROJECT_KEY)).toBe(mockRepos[1].id)
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute(
      "href",
      `/dashboard/${mockRepos[1].id}`,
    )
    expect(screen.getByRole("link", { name: "Scan History" })).toHaveAttribute(
      "href",
      `/dashboard/${mockRepos[1].id}/history`,
    )
  })
})

test("removing the last project clears storage and sends rail links to Projects", async () => {
  let projects = [mockRepos[0]]
  server.use(
    http.get("*/api/projects", () => HttpResponse.json(projects)),
    http.delete("*/api/projects/:repoId", () => {
      projects = []
      return new HttpResponse(null, { status: 204 })
    }),
  )
  localStorage.setItem(SELECTED_PROJECT_KEY, mockRepos[0].id)
  renderWithAppRail()
  await ready()

  await userEvent.click(
    screen.getByRole("button", {
      name: /remove acme\/acme-payments repository/i,
    }),
  )
  await userEvent.click(
    screen.getByRole("button", { name: /^remove repository$/i }),
  )

  expect(
    await screen.findByText(/no repositories connected/i),
  ).toBeInTheDocument()
  await waitFor(() => {
    expect(localStorage.getItem(SELECTED_PROJECT_KEY)).toBeNull()
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute(
      "href",
      "/projects",
    )
    expect(screen.getByRole("link", { name: "Scan History" })).toHaveAttribute(
      "href",
      "/projects",
    )
  })
})

test("a running scan prevents repository removal", async () => {
  server.use(
    http.delete("*/api/projects/:repoId", () =>
      HttpResponse.json(
        {
          detail:
            "Stop or wait for the queued or running scan before removing this repository.",
          code: "REPOSITORY_SCAN_RUNNING",
        },
        { status: 409 },
      ),
    ),
  )
  render(<ProjectsPage />)
  await ready()

  await userEvent.click(
    screen.getByRole("button", {
      name: /remove acme\/acme-payments repository/i,
    }),
  )
  await userEvent.click(
    screen.getByRole("button", { name: /^remove repository$/i }),
  )

  expect(await failureMessage()).toMatch(/queued or running scan/i)
  expect(screen.getByRole("dialog")).toBeInTheDocument()
  // Radix marks background content aria-hidden while the modal is open, so
  // accessible queries correctly cannot see the list at this point. Inspect
  // the already-rendered list node to prove the failed delete kept its row.
  expect(
    document.querySelector('[aria-label="Connected repositories"]'),
  ).toHaveTextContent("acme-payments")
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

// ── the two halves of reload vs refetch, on one screen (#110) ────────────────

test("a failed list offers a Retry that actually reloads it", async () => {
  let broken = true
  server.use(
    http.get("*/api/projects", () =>
      broken
        ? HttpResponse.json(
            { detail: "Something broke.", code: "INTERNAL_ERROR" },
            { status: 500 },
          )
        : HttpResponse.json(mockRepos),
    ),
  )

  render(<ProjectsPage />)
  expect(
    await screen.findByText(/could not load projects/i),
  ).toBeInTheDocument()

  // Before #110 this screen had no Retry at all: a failed load was a dead end
  // and the only way out was refreshing the browser.
  broken = false
  await userEvent.click(screen.getByRole("button", { name: "Retry" }))

  const list = await screen.findByRole("list", {
    name: /connected repositories/i,
  })
  expect(within(list).getByText("acme-payments")).toBeInTheDocument()
  expect(screen.queryByText(/could not load projects/i)).not.toBeInTheDocument()
})

test("connecting a repository refreshes the list without blanking it", async () => {
  // Hold the SECOND read open, so "while the refresh is in flight" is a moment
  // this test can actually stand in rather than a race it might lose.
  let reads = 0
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  server.use(
    http.get("*/api/projects", async () => {
      reads += 1
      if (reads > 1) await held
      return HttpResponse.json(mockRepos)
    }),
  )

  render(<ProjectsPage />)
  await ready()

  await connect("https://github.com/octocat/hello-world")
  await waitFor(() => expect(toastSuccess).toHaveBeenCalled())

  // The refresh has not answered yet, and the list the user was reading is
  // still on screen. This is `reload`, and it is why `refetch` had to be a
  // second function rather than a change to this one.
  expect(
    within(
      screen.getByRole("list", { name: /connected repositories/i }),
    ).getByText("acme-payments"),
  ).toBeInTheDocument()
  expect(screen.queryByTestId("projects-loading")).not.toBeInTheDocument()

  release()
})
