import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, expect, test, vi } from "vitest"

import { http, HttpResponse } from "msw"

import { server } from "@/lib/mocks/server"
import { mockRepos } from "@/lib/mocks/fixtures"
import {
  readSelectedProjectId,
  writeSelectedProjectId,
} from "@/hooks/use-selected-project"
import {
  mockSession,
  mockSessionViewer,
  WORKSPACE_ID,
} from "@/lib/mocks/fixtures"
import type { Session } from "@/lib/types"
import { AppRail } from "@/components/layout/app-rail"
import { javaOnlyAckKey } from "@/components/projects/java-only-dialog"
import type { ScanTarget } from "@/hooks/use-scan-center"
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

const session = vi.hoisted(() => ({ current: null as Session | null }))
vi.mock("@/hooks/use-session", () => ({
  useSession: () => ({ data: session.current, loading: false }),
}))

const { toastError, toastSuccess } = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}))
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: toastError, success: toastSuccess }),
}))

// The scan itself is the scan center's job; here it is enough that it was asked for.
const { startScanMock } = vi.hoisted(() => ({
  startScanMock: vi.fn<
    (target: ScanTarget, options?: { quiet?: boolean }) => Promise<void>
  >(async () => {}),
}))
vi.mock("@/hooks/use-scan-center", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-scan-center")>()),
  startScan: startScanMock,
}))

beforeEach(() => {
  session.current = mockSession
  localStorage.clear()
  pushMock.mockClear()
  toastError.mockClear()
  toastSuccess.mockClear()
  startScanMock.mockClear()
})

/** Wait for the projects list to finish its first load. */
async function ready() {
  const list = await screen.findByRole("list", {
    name: /connected repositories/i,
  })
  expect(within(list).getByText("acme-payments")).toBeInTheDocument()
  return list
}

type DialogChoice = "Connect only" | "Connect and scan" | "Cancel" | null

/** Types a URL and submits it; a well-formed one is then answered in the Java-only dialog. */
async function connect(url: string, choice: DialogChoice = "Connect only") {
  await userEvent.type(screen.getByLabelText(/repository url/i), url)
  await userEvent.click(
    screen.getByRole("button", { name: /^connect repository$/i }),
  )
  if (choice && url.startsWith("https://github.com/")) {
    const dialog = await screen.findByRole("alertdialog")
    await userEvent.click(within(dialog).getByRole("button", { name: choice }))
  }
}

/** Opens the remove dialog from a row's ⋯ menu. */
async function askToRemove(repoLabel: string) {
  await userEvent.click(
    screen.getByRole("button", { name: `More actions for ${repoLabel}` }),
  )
  await userEvent.click(
    await screen.findByRole("menuitem", { name: "Remove repository…" }),
  )
}

const ackKey = () => javaOnlyAckKey(mockSession.user_id, WORKSPACE_ID)

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

  expect(readSelectedProjectId(WORKSPACE_ID)).toBe(mockRepos[1].id)
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
  writeSelectedProjectId(mockRepos[0].id, WORKSPACE_ID)
  render(<ProjectsPage />)
  await ready()

  await askToRemove("acme/acme-payments")
  expect(screen.getByRole("dialog")).toHaveTextContent("acme/acme-payments")
  await userEvent.click(
    screen.getByRole("button", { name: /^remove repository$/i }),
  )

  await waitFor(() =>
    expect(screen.queryByText("acme-payments")).not.toBeInTheDocument(),
  )
  expect(readSelectedProjectId(WORKSPACE_ID)).toBe(mockRepos[1].id)
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
  writeSelectedProjectId(mockRepos[0].id, WORKSPACE_ID)
  renderWithAppRail()
  await ready()
  await waitFor(() =>
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute(
      "href",
      `/dashboard/${mockRepos[0].id}`,
    ),
  )

  await askToRemove("acme/acme-payments")
  await userEvent.click(
    screen.getByRole("button", { name: /^remove repository$/i }),
  )

  await waitFor(() => {
    expect(screen.queryByText("acme-payments")).not.toBeInTheDocument()
    expect(readSelectedProjectId(WORKSPACE_ID)).toBe(mockRepos[1].id)
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute(
      "href",
      `/dashboard/${mockRepos[1].id}`,
    )
    expect(screen.getByRole("link", { name: "Scan history" })).toHaveAttribute(
      "href",
      `/dashboard/${mockRepos[1].id}/history`,
    )
  })
})

test("removing the last project clears storage and hides the rail's project pages", async () => {
  let projects = [mockRepos[0]]
  server.use(
    http.get("*/api/projects", () => HttpResponse.json(projects)),
    http.delete("*/api/projects/:repoId", () => {
      projects = []
      return new HttpResponse(null, { status: 204 })
    }),
  )
  writeSelectedProjectId(mockRepos[0].id, WORKSPACE_ID)
  renderWithAppRail()
  await ready()

  await askToRemove("acme/acme-payments")
  await userEvent.click(
    screen.getByRole("button", { name: /^remove repository$/i }),
  )

  expect(
    await screen.findByText(/no repositories connected/i),
  ).toBeInTheDocument()
  await waitFor(() => {
    expect(readSelectedProjectId(WORKSPACE_ID)).toBeUndefined()
    expect(screen.queryByRole("link", { name: "Dashboard" })).toBeNull()
    expect(screen.queryByRole("link", { name: "Scan history" })).toBeNull()
    expect(screen.getByRole("link", { name: "Projects" })).toBeInTheDocument()
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

  await askToRemove("acme/acme-payments")
  await userEvent.click(
    screen.getByRole("button", { name: /^remove repository$/i }),
  )

  expect(await failureMessage()).toMatch(/queued or running scan/i)
  expect(screen.getByRole("dialog")).toBeInTheDocument()
  expect(
    document.querySelector('[aria-label="Connected repositories"]'),
  ).toHaveTextContent("acme-payments")
})

test("a private repository explains itself instead of failing generically", async () => {
  render(<ProjectsPage />)
  await ready()

  await connect("https://github.com/octocat/private-thing")

  expect(await failureMessage()).toMatch(
    /private repositories cannot be connected yet/i,
  )
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

  expect(await failureMessage()).toMatch(/valid GitHub repository link/i)
  expect(await within(connectForm()).findByRole("alert")).toHaveTextContent(
    /https:\/\/github\.com\/owner\/repository/i,
  )
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

  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: /connecting/i }),
    ).not.toBeInTheDocument(),
  )
  const input = screen.getByLabelText(/repository url/i)
  expect(input).toBeEnabled()

  await userEvent.type(input, "https://github.com/octocat/another")
  expect(
    screen.getByRole("button", { name: /^connect repository$/i }),
  ).toBeEnabled()
})

test("the message is chosen by CODE, not copied from the server's detail", async () => {
  // A backend that sends a correct code with a useless detail must still produce a usable message.
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
  expect(message).toMatch(/private repositories cannot be connected yet/i)
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

  expect(await failureMessage()).toMatch(/bad day/i)
})

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

  broken = false
  await userEvent.click(screen.getByRole("button", { name: "Retry" }))

  const list = await screen.findByRole("list", {
    name: /connected repositories/i,
  })
  expect(within(list).getByText("acme-payments")).toBeInTheDocument()
  expect(screen.queryByText(/could not load projects/i)).not.toBeInTheDocument()
})

test("connecting a repository refreshes the list without blanking it", async () => {
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

  // The refresh has not answered yet, and the list the user was reading is still on screen.
  expect(
    within(
      screen.getByRole("list", { name: /connected repositories/i }),
    ).getByText("acme-payments"),
  ).toBeInTheDocument()
  expect(screen.queryByTestId("projects-loading")).not.toBeInTheDocument()

  release()
})

test("the active workspace is named on the page, not just implied", async () => {
  render(<ProjectsPage />)
  await ready()

  expect(screen.getByText("Acme Engineering")).toBeVisible()
})

test("a role without connect sees the form locked, and remove and scan locked", async () => {
  session.current = mockSessionViewer

  render(<ProjectsPage />)
  await ready()

  // Connect is a main action, so it stays visible but locked, with the reason on hover and focus.
  expect(screen.getByLabelText(/repository url/i)).toBeDisabled()
  expect(
    screen.getByRole("button", { name: /^connect repository$/i }),
  ).toBeDisabled()
  expect(
    screen.getByLabelText(
      "Only org-admins and managers can connect repositories",
    ),
  ).toBeInTheDocument()
  // Remove is locked the same way, in the row's ⋯ menu.
  expect(
    screen.getByRole("button", {
      name: "More actions for acme/acme-payments",
    }),
  ).toBeDisabled()
  expect(
    screen.getAllByLabelText(
      "Only org-admins and managers can remove repositories",
    ).length,
  ).toBeGreaterThan(0)
  // And a viewer cannot start the first scan of an unscanned repository.
  expect(
    screen.getByRole("button", { name: "Run first scan of acme/octo-cli" }),
  ).toBeDisabled()
  expect(screen.getByText(/needs the manager or org-admin role/i)).toBeVisible()
})

test("an empty workspace says so, and says what to do about it", async () => {
  server.use(http.get("*/api/projects", () => HttpResponse.json([])))

  render(<ProjectsPage />)

  // A new workspace is genuinely empty — no demo repository is invented for it.
  expect(
    await screen.findByText(/no repositories connected/i),
  ).toBeInTheDocument()
  expect(
    screen.getByText(
      /Acme Engineering is empty\. Connect a public repository/i,
    ),
  ).toBeVisible()
})

/** The connect form itself, where the inline refusal lives. */
const connectForm = () =>
  screen.getByRole("region", { name: /connect a github repository/i })

test("a repository with no Java is refused inline, naming what GitHub found", async () => {
  render(<ProjectsPage />)
  const list = await ready()
  const rowsBefore = within(list).getAllByRole("listitem").length

  await connect("https://github.com/acme/nojava-site")

  const inline = await within(connectForm()).findByRole("alert")
  expect(inline).toHaveTextContent(/couldn't find any java in this repository/i)
  expect(inline).toHaveTextContent(/more languages are coming soon/i)
  expect(inline).toHaveTextContent(/GitHub lists Python and Shell/)
  // The toast says the same thing; the inline copy is what stays on screen.
  expect(await failureMessage()).toBe(inline.textContent)

  expect(within(list).getAllByRole("listitem")).toHaveLength(rowsBefore)
  expect(screen.queryByText("nojava-site")).not.toBeInTheDocument()
  expect(screen.getByLabelText(/repository url/i)).toHaveValue(
    "https://github.com/acme/nojava-site",
  )
})

test("a repository over the size limit is refused inline with the limit", async () => {
  render(<ProjectsPage />)
  await ready()

  await connect("https://github.com/acme/huge-monorepo")

  expect(await within(connectForm()).findByRole("alert")).toHaveTextContent(
    /larger than 300 MB/i,
  )
  expect(screen.queryByText("huge-monorepo")).not.toBeInTheDocument()
})

test("editing the URL clears the inline refusal, and a success leaves none", async () => {
  render(<ProjectsPage />)
  await ready()

  await connect("https://github.com/acme/nojava-site")
  await within(connectForm()).findByRole("alert")

  const input = screen.getByLabelText(/repository url/i)
  await userEvent.clear(input)
  expect(within(connectForm()).queryByRole("alert")).not.toBeInTheDocument()

  await connect("https://github.com/octocat/hello-world")
  await waitFor(() =>
    expect(toastSuccess).toHaveBeenCalledWith("Connected octocat/hello-world"),
  )
  expect(within(connectForm()).queryByRole("alert")).not.toBeInTheDocument()
  expect(input).toHaveValue("")
})

// The Java-only dialog (6.1), Connect and scan (6.2) and opening a row (6.4).

test("a well-formed URL asks first, and Cancel connects nothing", async () => {
  let posts = 0
  server.use(
    http.post("*/api/projects", () => {
      posts += 1
      return HttpResponse.json(
        { detail: "x", code: "INTERNAL_ERROR" },
        { status: 500 },
      )
    }),
  )
  render(<ProjectsPage />)
  await ready()

  await connect("https://github.com/octocat/hello-world", null)
  const dialog = await screen.findByRole("alertdialog")
  expect(dialog).toHaveTextContent("Connect octocat/hello-world?")

  await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))

  await waitFor(() =>
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
  )
  expect(posts).toBe(0)
  expect(toastSuccess).not.toHaveBeenCalled()
  expect(toastError).not.toHaveBeenCalled()
  // The URL waits in the box for a second try.
  expect(screen.getByLabelText(/repository url/i)).toHaveValue(
    "https://github.com/octocat/hello-world",
  )
  expect(screen.getByLabelText(/repository url/i)).toBeEnabled()
})

test("a malformed URL is refused before the dialog", async () => {
  render(<ProjectsPage />)
  await ready()

  await connect("not-a-url")

  expect(await failureMessage()).toMatch(/valid GitHub repository link/i)
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
})

test("Connect only adds the row and stays on the page, without a scan", async () => {
  render(<ProjectsPage />)
  const list = await ready()

  await connect("https://github.com/octocat/hello-world", "Connect only")

  expect(await within(list).findByText("hello-world")).toBeInTheDocument()
  expect(toastSuccess).toHaveBeenCalledWith("Connected octocat/hello-world")
  expect(startScanMock).not.toHaveBeenCalled()
  expect(pushMock).not.toHaveBeenCalled()
  // Freshly connected and never scanned: its row offers the first scan.
  expect(
    within(list).getByRole("button", {
      name: "Run first scan of octocat/hello-world",
    }),
  ).toBeInTheDocument()
})

test("Connect and scan selects the project, queues its first scan and opens its dashboard", async () => {
  render(<ProjectsPage />)
  await ready()

  await connect("https://github.com/octocat/hello-world", "Connect and scan")

  await waitFor(() => expect(pushMock).toHaveBeenCalledTimes(1))
  const repoId = readSelectedProjectId(WORKSPACE_ID)
  expect(repoId).toBeDefined()
  expect(mockRepos.some((repo) => repo.id === repoId)).toBe(false)
  // Its own toast already says "scan queued", so the scan center stays quiet.
  expect(startScanMock).toHaveBeenCalledExactlyOnceWith(
    {
      workspaceId: WORKSPACE_ID,
      repoId,
      branch: "main",
      repoName: "hello-world",
    },
    { quiet: true },
  )
  expect(pushMock).toHaveBeenCalledWith(`/dashboard/${repoId}`)
  expect(toastSuccess).toHaveBeenCalledWith(
    "Connected octocat/hello-world · scan queued on main",
  )
})

test("a refusal closes the dialog first, then shows under the URL field", async () => {
  render(<ProjectsPage />)
  await ready()

  await connect("https://github.com/acme/huge-monorepo", "Connect and scan")

  expect(await within(connectForm()).findByRole("alert")).toHaveTextContent(
    /larger than 300 MB/i,
  )
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
  expect(startScanMock).not.toHaveBeenCalled()
  expect(pushMock).not.toHaveBeenCalled()
})

test("a remembered choice skips the dialog in this workspace", async () => {
  localStorage.setItem(ackKey(), "scan")
  render(<ProjectsPage />)
  await ready()

  await connect("https://github.com/octocat/hello-world", null)

  await waitFor(() => expect(startScanMock).toHaveBeenCalledTimes(1))
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
  expect(pushMock).toHaveBeenCalledWith(
    `/dashboard/${readSelectedProjectId(WORKSPACE_ID)}`,
  )
})

test("ticking Don't show this again is what the next connect remembers", async () => {
  render(<ProjectsPage />)
  await ready()

  await userEvent.type(
    screen.getByLabelText(/repository url/i),
    "https://github.com/octocat/hello-world",
  )
  await userEvent.click(
    screen.getByRole("button", { name: /^connect repository$/i }),
  )
  const dialog = await screen.findByRole("alertdialog")
  await userEvent.click(within(dialog).getByRole("checkbox"))
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Connect only" }),
  )
  await waitFor(() =>
    expect(toastSuccess).toHaveBeenCalledWith("Connected octocat/hello-world"),
  )

  await connect("https://github.com/octocat/another", null)
  await waitFor(() =>
    expect(toastSuccess).toHaveBeenCalledWith("Connected octocat/another"),
  )
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
  expect(startScanMock).not.toHaveBeenCalled()
})

test("clicking a row selects that project and opens its dashboard", async () => {
  render(<ProjectsPage />)
  const list = await ready()

  const row = within(list).getByText("web-store").closest("li")!
  await userEvent.click(within(row).getAllByText("public")[0])

  expect(readSelectedProjectId(WORKSPACE_ID)).toBe(mockRepos[1].id)
  expect(pushMock).toHaveBeenCalledExactlyOnceWith(
    `/dashboard/${mockRepos[1].id}`,
  )
})

test("the selected project wears the Current chip", async () => {
  writeSelectedProjectId(mockRepos[1].id, WORKSPACE_ID)
  render(<ProjectsPage />)
  const list = await ready()

  await waitFor(() =>
    expect(within(list).getByText("Current").closest("li")).toHaveTextContent(
      "web-store",
    ),
  )
  expect(screen.queryByRole("button", { name: /^select/i })).toBeNull()
})

test("Run first scan on an unscanned row scans its default branch and opens the dashboard", async () => {
  render(<ProjectsPage />)
  await ready()

  await userEvent.click(
    screen.getByRole("button", { name: "Run first scan of acme/octo-cli" }),
  )

  expect(startScanMock).toHaveBeenCalledExactlyOnceWith(
    {
      workspaceId: WORKSPACE_ID,
      repoId: mockRepos[2].id,
      branch: "trunk",
      repoName: "octo-cli",
    },
    { quiet: false },
  )
  expect(readSelectedProjectId(WORKSPACE_ID)).toBe(mockRepos[2].id)
  expect(pushMock).toHaveBeenCalledWith(`/dashboard/${mockRepos[2].id}`)
})
