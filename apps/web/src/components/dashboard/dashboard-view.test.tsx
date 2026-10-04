import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { http, HttpResponse } from "msw"
import { toast } from "sonner"
import { beforeEach, expect, test, vi } from "vitest"

import { DashboardView } from "@/components/dashboard/dashboard-view"
import { dashboardViewPreferenceKey } from "@/components/dashboard/dashboard-tabs"
import { BranchSwitcher } from "@/components/layout/branch-switcher"
import {
  DEMO_REPO_ID,
  UNSCANNED_REPO_ID,
  WORKSPACE_ID,
  mockFindings,
  mockHealthReport,
  mockRepos,
  mockSession,
  mockSessionViewer,
  mockScanHistory,
} from "@/lib/mocks/fixtures"
import { server } from "@/lib/mocks/server"
import {
  readSelectedBranch,
  writeSelectedBranch,
} from "@/hooks/use-selected-branch"

const nav = vi.hoisted(() => {
  let params = new URLSearchParams()
  const listeners = new Set<() => void>()
  // Every url this view navigates to, in order.
  const visited: string[] = []
  return {
    read: () => params,
    visited,
    subscribe: (fn: () => void) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    navigate: (url: string) => {
      visited.push(url)
      params = new URLSearchParams(url.split("?")[1] ?? "")
      listeners.forEach((fn) => fn())
    },
    reset: () => {
      params = new URLSearchParams()
      visited.length = 0
    },
  }
})

vi.mock("next/navigation", async () => {
  const { useSyncExternalStore } = await import("react")
  return {
    usePathname: () => `/dashboard/${DEMO_REPO_ID}`,
    useSearchParams: () =>
      useSyncExternalStore(nav.subscribe, nav.read, nav.read),
    useRouter: () => ({ push: nav.navigate, replace: nav.navigate }),
  }
})

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))

const CRITICAL = mockFindings[0] // the hardcoded Stripe key in payment_service.ts
const UNKNOWN_REPO_ID = "11111111-2222-3333-4444-555555555555"
const LATEST_POSITION = `Scan ${mockScanHistory.length} of ${mockScanHistory.length}`
const ONE_BEFORE_LATEST_POSITION = `Scan ${mockScanHistory.length - 1} of ${mockScanHistory.length}`
const OLD_VIEW_KEY = `codesage.dashboard-view.v1:${mockSession.user_id}:${WORKSPACE_ID}`

beforeEach(() => {
  nav.reset()
  server.resetHandlers()
  server.use(
    http.get("*/api/auth/session", () => HttpResponse.json(mockSession)),
  )
  localStorage.removeItem(
    dashboardViewPreferenceKey(mockSession.user_id, WORKSPACE_ID),
  )
  localStorage.removeItem(OLD_VIEW_KEY)
  localStorage.removeItem(
    `codesage.javaBanner.v1:${mockSession.user_id}:${WORKSPACE_ID}:${DEMO_REPO_ID}`,
  )
})

/** Wait for the (mock) health report to land. */
async function ready() {
  expect(await screen.findByText("Code Health")).toBeInTheDocument()
}

/** The dashboard with the top bar's branch picker beside it, as the app shell has it. */
function renderWithBranchPicker() {
  return render(
    <>
      <BranchSwitcher repoId={DEMO_REPO_ID} />
      <DashboardView repoId={DEMO_REPO_ID} />
    </>,
  )
}

const tab = (name: string) =>
  screen.getByRole("tab", { name: new RegExp(`^${name}`) })

test("selecting a finding opens the findings and detail view", async () => {
  render(<DashboardView repoId={DEMO_REPO_ID} />)
  await ready()

  await userEvent.click(
    screen.getByRole("button", { name: /hardcoded stripe api key/i }),
  )

  const detail = await screen.findByLabelText("Finding detail")
  expect(within(detail).getByText(CRITICAL.reason)).toBeInTheDocument()
  expect(
    within(detail).getByRole("link", { name: /^Open at line \d+ on GitHub$/ }),
  ).toHaveAttribute(
    "href",
    `${mockRepos.find((repo) => repo.id === DEMO_REPO_ID)?.url}/blob/${mockHealthReport.commit_sha}/${CRITICAL.file}#L${CRITICAL.line}`,
  )
  // The detail is beside the still-usable list, not a modal over the dashboard.
  expect(screen.queryByText("Code Health")).not.toBeInTheDocument()
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  expect(
    screen.getByRole("heading", { name: /refactor first/i }),
  ).toBeInTheDocument()
})

test("detail mode is driven by ?finding=, so a refresh restores it", async () => {
  nav.navigate(`/dashboard/${DEMO_REPO_ID}?finding=${CRITICAL.fingerprint}`)
  render(<DashboardView repoId={DEMO_REPO_ID} />)

  expect(await screen.findByLabelText("Finding detail")).toBeInTheDocument()
  expect(screen.queryByText("Code Health")).not.toBeInTheDocument()
})

test("GitHub links use a historical snapshot commit instead of branch head", async () => {
  const commit = "f".repeat(40)
  server.use(
    http.get("*/api/repos/:repoId/health", () =>
      HttpResponse.json({ ...mockHealthReport, commit_sha: commit }),
    ),
  )
  nav.navigate(
    `/dashboard/${DEMO_REPO_ID}?snapshot_id=${mockScanHistory[0].snapshot_id}&finding=${CRITICAL.fingerprint}`,
  )
  render(<DashboardView repoId={DEMO_REPO_ID} />)
  const link = await screen.findByRole("link", {
    name: /^Open at line \d+ on GitHub$/,
  })
  expect(link).toHaveAttribute(
    "href",
    `${mockRepos[0].url}/blob/${commit}/${CRITICAL.file}#L${CRITICAL.line}`,
  )
})

test("the code map highlights the file named in the URL and shows its findings", async () => {
  nav.navigate(
    `/dashboard/${DEMO_REPO_ID}?view=code&file=src/payments/payment_service.ts`,
  )
  render(<DashboardView repoId={DEMO_REPO_ID} />)

  const tree = await screen.findByLabelText("File health tree")
  const highlighted = within(tree).getByRole("button", { current: true })
  expect(highlighted).toHaveTextContent("payment_service.ts")
  const detail = screen.getByLabelText("File detail")
  expect(
    within(detail).getByRole("heading", { name: "payment_service.ts" }),
  ).toBeInTheDocument()
  expect(
    within(detail).getByRole("button", {
      name: new RegExp(CRITICAL.reason.slice(0, 20)),
    }),
  ).toBeInTheDocument()
})

test("closing detail expands the findings panel", async () => {
  nav.navigate(`/dashboard/${DEMO_REPO_ID}?finding=${CRITICAL.fingerprint}`)
  render(<DashboardView repoId={DEMO_REPO_ID} />)
  await screen.findByLabelText("Finding detail")

  await userEvent.click(
    screen.getByRole("button", { name: /close finding detail/i }),
  )

  await waitFor(() => expect(nav.read().get("finding")).toBeNull())
  expect(tab("Findings")).toHaveAttribute("aria-selected", "true")
  expect(screen.queryByText("Code Health")).not.toBeInTheDocument()
  expect(screen.getByText("Select a finding")).toBeInTheDocument()
})

test("choosing a file in the code map shows it, and its finding opens the detail", async () => {
  const user = userEvent.setup()
  render(<DashboardView repoId={DEMO_REPO_ID} />)
  await ready()

  await user.click(tab("Code map"))
  const tree = await screen.findByLabelText("File health tree")
  await user.click(
    within(tree).getByRole("button", { name: /order_controller\.ts/i }),
  )
  expect(nav.read().get("file")).toBe("src/orders/order_controller.ts")

  const file = screen.getByLabelText("File detail")
  await user.click(within(file).getAllByRole("button")[0])

  const detail = await screen.findByLabelText("Finding detail")
  expect(
    within(detail).getByText(/order_controller\.ts:\d+/),
  ).toBeInTheDocument()
})

test("the tabs at the top switch among overview, findings and the code map", async () => {
  const user = userEvent.setup()
  nav.navigate(`/dashboard/${DEMO_REPO_ID}?finding=${CRITICAL.fingerprint}`)
  render(<DashboardView repoId={DEMO_REPO_ID} />)
  await screen.findByLabelText("Finding detail")

  const tabs = screen.getByRole("tablist", { name: "Dashboard view" })
  expect(within(tabs).getAllByRole("tab")).toHaveLength(3)
  expect(tab("Findings")).toHaveAttribute("aria-selected", "true")

  await user.click(tab("Code map"))
  expect(await screen.findByLabelText("File health tree")).toBeInTheDocument()
  expect(screen.queryByText("Code Health")).not.toBeInTheDocument()

  await user.click(tab("Overview"))
  expect(await screen.findByText("Code Health")).toBeInTheDocument()
  expect(screen.queryByLabelText("File health tree")).not.toBeInTheDocument()
  // Switching tabs does not discard the selected finding from the URL.
  expect(nav.read().get("finding")).toBeTruthy()

  // Arrow keys move between tabs, as a tablist should.
  tab("Overview").focus()
  await user.keyboard("{ArrowRight}")
  expect(nav.read().get("view")).toBe("findings")
})

test("the selected view is remembered per user and workspace", async () => {
  const user = userEvent.setup()
  const first = render(<DashboardView repoId={DEMO_REPO_ID} />)
  await ready()

  await user.click(tab("Code map"))
  await waitFor(() =>
    expect(
      localStorage.getItem(
        dashboardViewPreferenceKey(mockSession.user_id, WORKSPACE_ID),
      ),
    ).toBe("code"),
  )
  first.unmount()
  nav.reset()

  render(<DashboardView repoId={DEMO_REPO_ID} />)
  expect(await screen.findByLabelText("File health tree")).toBeInTheDocument()
  expect(tab("Code map")).toHaveAttribute("aria-selected", "true")
})

test("an old bottom-bar choice carries over to the matching tab, once", async () => {
  localStorage.setItem(OLD_VIEW_KEY, "findings-tree")
  render(<DashboardView repoId={DEMO_REPO_ID} />)

  expect(await screen.findByLabelText("File health tree")).toBeInTheDocument()
  expect(
    localStorage.getItem(
      dashboardViewPreferenceKey(mockSession.user_id, WORKSPACE_ID),
    ),
  ).toBe("code")
})

test("marking a finding done hides only that snapshot and does not change health", async () => {
  const user = userEvent.setup()
  render(<DashboardView repoId={DEMO_REPO_ID} />)
  await ready()

  const scoreBefore = screen.getByTestId("health-score").textContent
  const openBefore = Number(
    within(screen.getByTestId("kpi-open")).getByText(/^\d+$/).textContent,
  )
  await user.click(tab("Findings"))
  const findingCard = await screen.findByRole("button", {
    name: /hardcoded stripe api key/i,
  })
  const row = findingCard.closest("li")
  expect(row).not.toBeNull()
  await user.click(
    await within(row as HTMLLIElement).findByRole("button", {
      name: "Mark as done",
    }),
  )

  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: /hardcoded stripe api key/i }),
    ).not.toBeInTheDocument(),
  )
  expect(toast.success).toHaveBeenCalledWith("Finding marked as done.")

  // Health is untouched; only the open count moves.
  await user.click(tab("Overview"))
  expect(await screen.findByTestId("health-score")).toHaveTextContent(
    scoreBefore ?? "",
  )
  expect(
    within(screen.getByTestId("kpi-open")).getByText(String(openBefore - 1)),
  ).toBeInTheDocument()

  await user.click(tab("Findings"))
  await user.click(
    await screen.findByRole("button", { name: /show done \(1\)/i }),
  )
  const doneCard = screen.getByRole("button", {
    name: /hardcoded stripe api key/i,
  })
  expect(doneCard.closest("li")).toHaveTextContent("Done")

  // The same fingerprint in an older immutable snapshot is independent.
  await user.click(screen.getByRole("button", { name: /older scan/i }))
  await waitFor(() =>
    expect(nav.read().get("snapshot_id")).toBe(mockScanHistory[1].snapshot_id),
  )
  expect(
    await screen.findByRole("button", { name: /hardcoded stripe api key/i }),
  ).toBeInTheDocument()
})

test("a failed mark-done write restores the finding and explains the error", async () => {
  server.use(
    http.put("*/api/snapshots/:snapshotId/findings/:fingerprint/status", () =>
      HttpResponse.json(
        { detail: "Status service is unavailable.", code: "INTERNAL_ERROR" },
        { status: 500 },
      ),
    ),
  )
  const user = userEvent.setup()
  nav.navigate(`/dashboard/${DEMO_REPO_ID}?view=findings`)
  render(<DashboardView repoId={DEMO_REPO_ID} />)

  const findingCard = await screen.findByRole("button", {
    name: /hardcoded stripe api key/i,
  })
  await user.click(
    await within(findingCard.closest("li")!).findByRole("button", {
      name: "Mark as done",
    }),
  )

  expect(
    await screen.findByRole("button", { name: /hardcoded stripe api key/i }),
  ).toBeInTheDocument()
  expect(toast.error).toHaveBeenCalledWith("Status service is unavailable.")
})

test("a viewer can see statuses but has no finding action", async () => {
  server.use(
    http.get("*/api/auth/session", () => HttpResponse.json(mockSessionViewer)),
  )
  nav.navigate(`/dashboard/${DEMO_REPO_ID}?view=findings`)
  render(<DashboardView repoId={DEMO_REPO_ID} />)

  expect(
    await screen.findByRole("list", { name: /ranked refactor findings/i }),
  ).toBeInTheDocument()
  expect(
    screen.queryByRole("button", { name: "Mark as done" }),
  ).not.toBeInTheDocument()
})

test("agreed triage roles see the action before the API adds its new grant", async () => {
  server.use(
    http.get("*/api/auth/session", () =>
      HttpResponse.json({
        ...mockSession,
        role: "developer",
        permissions: mockSession.permissions?.filter(
          (permission) => permission !== "finding:triage",
        ),
      }),
    ),
  )
  nav.navigate(`/dashboard/${DEMO_REPO_ID}?view=findings`)
  render(<DashboardView repoId={DEMO_REPO_ID} />)

  expect(
    await screen.findAllByRole("button", { name: "Mark as done" }),
  ).not.toHaveLength(0)
})

test("a snapshot_id URL loads historical mode and can return to latest", async () => {
  const older = mockScanHistory[1]
  nav.navigate(
    `/dashboard/${DEMO_REPO_ID}?branch=${older.branch}&snapshot_id=${older.snapshot_id}`,
  )
  render(<DashboardView repoId={DEMO_REPO_ID} />)
  await ready()

  expect(screen.getByText("Historical snapshot")).toBeInTheDocument()
  expect(screen.getByText(ONE_BEFORE_LATEST_POSITION)).toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: /latest scan/i }))

  expect(nav.read().get("snapshot_id")).toBeNull()
  expect(nav.read().get("branch")).toBe("main")
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: /latest scan/i }),
    ).not.toBeInTheDocument(),
  )
  expect(screen.getByText("Latest")).toBeInTheDocument()
  expect(screen.getByText(LATEST_POSITION)).toBeInTheDocument()
})

test("normal dashboard arrows can move to an older scan", async () => {
  render(<DashboardView repoId={DEMO_REPO_ID} />)
  await ready()

  expect(screen.getByText(LATEST_POSITION)).toBeInTheDocument()
  expect(
    screen.queryByRole("button", { name: /latest scan/i }),
  ).not.toBeInTheDocument()
  expect(screen.getByText("Latest")).toBeInTheDocument()
  const older = await screen.findByRole("button", { name: /older scan/i })
  await waitFor(() => expect(older).not.toBeDisabled())
  await userEvent.click(older)

  expect(nav.read().get("snapshot_id")).toBe(mockScanHistory[1].snapshot_id)
  expect(nav.read().get("branch")).toBe("main")
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /latest scan/i })).toBeVisible(),
  )
  expect(screen.getByText(ONE_BEFORE_LATEST_POSITION)).toBeInTheDocument()
})

test("changing branches updates the URL and leaves historical snapshot mode", async () => {
  const older = mockScanHistory[1]
  nav.navigate(
    `/dashboard/${DEMO_REPO_ID}?branch=${older.branch}&snapshot_id=${older.snapshot_id}`,
  )
  const user = userEvent.setup()
  renderWithBranchPicker()
  await ready()

  await user.click(screen.getByRole("combobox", { name: "Branch" }))
  await user.click(await screen.findByRole("option", { name: /^develop/ }))

  expect(nav.read().get("branch")).toBe("develop")
  expect(nav.read().get("snapshot_id")).toBeNull()
  expect(nav.read().get("finding")).toBeNull()
})

test("the Findings tab carries the ranked-list label, the Code map its legend", async () => {
  const user = userEvent.setup()
  render(<DashboardView repoId={DEMO_REPO_ID} />)
  await ready()

  await user.click(tab("Findings"))
  expect(
    await screen.findByText(/ranked by severity.*risk/i),
  ).toBeInTheDocument()
  await user.click(tab("Code map"))
  expect(await screen.findByLabelText("Heat map legend")).toBeInTheDocument()
})

test("a file with no findings opens in the code map and says so", async () => {
  nav.navigate(`/dashboard/${DEMO_REPO_ID}?view=code`)
  render(<DashboardView repoId={DEMO_REPO_ID} />)

  const tree = await screen.findByLabelText("File health tree")
  await userEvent.click(
    within(tree).getByRole("button", { name: /formatters\.ts/i }),
  )

  const detail = await screen.findByLabelText("File detail")
  expect(
    within(detail).getByRole("heading", { name: "formatters.ts" }),
  ).toBeInTheDocument()
  expect(
    within(detail).getByText("No findings in this file in this snapshot."),
  ).toBeInTheDocument()
  expect(screen.queryByLabelText("Finding detail")).not.toBeInTheDocument()
})

test("a never-scanned repo still gets its header, so a scan can be started", async () => {
  render(
    <>
      <BranchSwitcher repoId={UNSCANNED_REPO_ID} />
      <DashboardView repoId={UNSCANNED_REPO_ID} />
    </>,
  )

  expect(await screen.findByTestId("first-scan-card")).toBeInTheDocument()
  expect(
    screen.queryByText(/couldn’t load this dashboard/i),
  ).not.toBeInTheDocument()

  // …and the controls that produce the first snapshot are on screen
  expect(screen.getByRole("button", { name: /^scan/i })).toBeInTheDocument()
  expect(
    await screen.findByRole("combobox", { name: "Branch" }),
  ).toBeInTheDocument()
})

test("an unavailable project shows project guidance instead of a raw uuid", async () => {
  render(<DashboardView repoId={UNKNOWN_REPO_ID} />)

  expect(await screen.findByText("Choose a project")).toBeInTheDocument()
  expect(screen.getByText("Project unavailable")).toBeInTheDocument()
  expect(screen.getByRole("link", { name: /view projects/i })).toHaveAttribute(
    "href",
    "/projects",
  )
  expect(screen.queryByText(UNKNOWN_REPO_ID)).not.toBeInTheDocument()
  expect(screen.queryByTestId("first-scan-card")).not.toBeInTheDocument()
})

test("with no snapshot the nav reads Never scanned instead of Invalid Date", async () => {
  render(<DashboardView repoId={UNSCANNED_REPO_ID} />)

  expect(await screen.findByText("Never scanned")).toBeInTheDocument()
  expect(screen.queryByText(/invalid date/i)).not.toBeInTheDocument()
})

test("a real failure still reads as an error, not as an empty state", async () => {
  server.use(
    http.get("*/api/repos/:repoId/health", () =>
      HttpResponse.json(
        { detail: "Something broke.", code: "INTERNAL_ERROR" },
        { status: 500 },
      ),
    ),
  )
  render(<DashboardView repoId={DEMO_REPO_ID} />)

  expect(
    await screen.findByText(/couldn’t load this dashboard/i),
  ).toBeInTheDocument()
  expect(screen.queryByTestId("first-scan-card")).not.toBeInTheDocument()
  // the nav survives this too — switching branch is the obvious recovery
  expect(screen.getByRole("button", { name: /^scan/i })).toBeInTheDocument()
})

test("finishing the first scan refetches the report, so the empty state fills in", async () => {
  let scanned = false
  server.use(
    http.get("*/api/repos/:repoId/health", () =>
      scanned
        ? HttpResponse.json(mockHealthReport)
        : HttpResponse.json(
            {
              detail: "This branch has not been scanned yet.",
              code: "NOT_FOUND",
            },
            { status: 404 },
          ),
    ),
    http.get("*/api/repos/:repoId/scan/:scanId", () => {
      scanned = true
      return HttpResponse.json({ scan_id: "s1", phase: "done", progress: 100 })
    }),
  )

  render(<DashboardView repoId={UNSCANNED_REPO_ID} />)
  await screen.findByTestId("first-scan-card")

  await userEvent.click(screen.getByRole("button", { name: /^scan/i }))

  expect(
    await screen.findByText("Code Health", {}, { timeout: 4000 }),
  ).toBeInTheDocument()
  expect(screen.queryByTestId("first-scan-card")).not.toBeInTheDocument()
})

test("a score still being calculated is a wait, not an error", async () => {
  const scorePending = () =>
    HttpResponse.json(
      {
        detail:
          "The dashboard score is still being prepared. Please try again shortly.",
        code: "SCORE_PENDING",
      },
      { status: 503 },
    )

  // Branch-aware, so a stray ask for any other branch could never count as the first ask for `main`.
  let asksForMain = 0
  server.use(
    http.get("*/api/repos/:repoId/health", ({ request }) => {
      const branch = new URL(request.url).searchParams.get("branch")
      if (branch !== "main") return scorePending()
      asksForMain += 1
      return asksForMain === 1
        ? scorePending()
        : HttpResponse.json(mockHealthReport)
    }),
  )

  render(<DashboardView repoId={DEMO_REPO_ID} />)

  expect(
    await screen.findByText(/calculating your health score/i),
  ).toBeInTheDocument()
  expect(
    screen.queryByText(/couldn’t load this dashboard/i),
  ).not.toBeInTheDocument()
  // Not the never-scanned empty state either — the snapshot does exist.
  expect(screen.queryByTestId("first-scan-card")).not.toBeInTheDocument()

  expect(
    await screen.findByText("Code Health", {}, { timeout: 8000 }),
  ).toBeInTheDocument()
  expect(
    screen.queryByText(/calculating your health score/i),
  ).not.toBeInTheDocument()
}, 15_000)

test("the error state's Retry actually re-runs the read", async () => {
  let broken = true
  server.use(
    http.get("*/api/repos/:repoId/health", () =>
      broken
        ? HttpResponse.json(
            { detail: "Something broke.", code: "INTERNAL_ERROR" },
            { status: 500 },
          )
        : HttpResponse.json(mockHealthReport),
    ),
  )

  render(<DashboardView repoId={DEMO_REPO_ID} />)
  await screen.findByText(/couldn’t load this dashboard/i)

  broken = false
  await userEvent.click(screen.getByRole("button", { name: /retry/i }))

  expect(await screen.findByText("Code Health")).toBeInTheDocument()
  expect(
    screen.queryByText(/couldn’t load this dashboard/i),
  ).not.toBeInTheDocument()
})

test("a never-scanned repository offers its first scan, not an error state", async () => {
  render(<DashboardView repoId={UNSCANNED_REPO_ID} />)

  const card = await screen.findByTestId("first-scan-card")
  expect(
    within(card).getByRole("heading", { name: /run the first scan of/i }),
  ).toBeInTheDocument()
  expect(card).toHaveTextContent("Only .java files are analysed.")
  expect(
    within(card).getByRole("link", { name: "What is analysed" }),
  ).toHaveAttribute("href", "/help/what-is-analysed")
  // One Scan button on the page: the card's, not a second one in the header.
  expect(screen.getAllByRole("button", { name: /^scan /i })).toHaveLength(1)

  // Must not be an error state
  expect(
    screen.queryByText(/couldn’t load this dashboard/i),
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole("button", { name: /retry/i }),
  ).not.toBeInTheDocument()
})

test("a report with an empty file tree displays the named empty tree state", async () => {
  server.use(
    http.get("*/api/repos/:repoId/health", () =>
      HttpResponse.json({
        ...mockHealthReport,
        tree: [],
      }),
    ),
  )
  nav.navigate(`/dashboard/${DEMO_REPO_ID}?view=code`)
  render(<DashboardView repoId={DEMO_REPO_ID} />)

  expect(await screen.findByText("No files in this tree")).toBeInTheDocument()
  expect(
    screen.getByText(/no files were detected in this snapshot/i),
  ).toBeInTheDocument()
  expect(
    screen.getByText(
      /run a scan to analyze and display the repository file hierarchy/i,
    ),
  ).toBeInTheDocument()
})

test("a report with zero findings displays the celebratory empty state in place of the list", async () => {
  server.use(
    http.get("*/api/repos/:repoId/health/findings", () =>
      HttpResponse.json({ items: [], total: 0, limit: 100, offset: 0 }),
    ),
    http.get("*/api/repos/:repoId/health", () =>
      HttpResponse.json({
        ...mockHealthReport,
        findings: [],
      }),
    ),
  )
  nav.navigate(`/dashboard/${DEMO_REPO_ID}?view=findings`)
  render(<DashboardView repoId={DEMO_REPO_ID} />)

  expect(
    await screen.findByText("No refactoring issues found"),
  ).toBeInTheDocument()
  expect(
    screen.getByText(
      /the scan found no technical debt or refactoring issues on this branch/i,
    ),
  ).toBeInTheDocument()
  expect(screen.queryByRole("table")).not.toBeInTheDocument()

  // The detail beside the list says there is nothing to select.
  expect(screen.getByLabelText("Finding detail")).toHaveTextContent(
    /no findings in this snapshot/i,
  )
})

test("filtering to nothing inside the dashboard displays the filter empty state and clear button", async () => {
  server.use(
    http.get("*/api/repos/:repoId/health/findings", () =>
      HttpResponse.json({
        items: [mockFindings[0]],
        total: 1,
        limit: 100,
        offset: 0,
      }),
    ),
    http.get("*/api/repos/:repoId/health", () =>
      HttpResponse.json({
        ...mockHealthReport,
        findings: [mockFindings[0]], // only a security finding
      }),
    ),
  )
  const user = userEvent.setup()
  nav.navigate(`/dashboard/${DEMO_REPO_ID}?view=findings`)
  render(<DashboardView repoId={DEMO_REPO_ID} />)
  await screen.findByRole("list", { name: /ranked refactor findings/i })

  // Filter by debt type to a category with 0 items
  await user.click(
    screen.getByRole("combobox", { name: /filter by debt type/i }),
  )
  await user.click(await screen.findByRole("option", { name: "test" }))

  expect(screen.getByText("No findings match this filter")).toBeInTheDocument()
  expect(
    screen.getByText(/no findings match the “test” filter/i),
  ).toBeInTheDocument()

  const clearBtn = screen.getByRole("button", { name: /clear filter/i })
  expect(clearBtn).toBeInTheDocument()

  await user.click(clearBtn)
  expect(
    screen.queryByText("No findings match this filter"),
  ).not.toBeInTheDocument()
  expect(
    screen.getByRole("list", { name: /ranked refactor findings/i }),
  ).toBeInTheDocument()
})

test("Scan is the page header's main action; the branch picker belongs to the top bar", async () => {
  render(<DashboardView repoId={DEMO_REPO_ID} />)
  await ready()

  const header = screen.getByRole("heading", { level: 1 }).closest("header")
  expect(header).not.toBeNull()
  expect(
    within(header as HTMLElement).getByRole("button", { name: "Scan main" }),
  ).toBeVisible()
  expect(screen.queryByRole("combobox", { name: "Branch" })).toBeNull()
  expect(screen.queryByRole("combobox", { name: /^Project/ })).toBeNull()
})

test("opened without ?branch=, the dashboard returns to the branch last used", async () => {
  writeSelectedBranch(WORKSPACE_ID, DEMO_REPO_ID, "develop")
  renderWithBranchPicker()
  await ready()

  await waitFor(() =>
    expect(screen.getByRole("combobox", { name: "Branch" })).toHaveTextContent(
      "develop",
    ),
  )
})

test("the URL still wins over the remembered branch", async () => {
  writeSelectedBranch(WORKSPACE_ID, DEMO_REPO_ID, "develop")
  nav.navigate(`/dashboard/${DEMO_REPO_ID}?branch=main`)
  renderWithBranchPicker()
  await ready()

  expect(screen.getByRole("combobox", { name: "Branch" })).toHaveTextContent(
    "main",
  )
})

test("a remembered branch that no longer exists falls back to the default", async () => {
  writeSelectedBranch(WORKSPACE_ID, DEMO_REPO_ID, "deleted-branch")
  renderWithBranchPicker()
  await ready()

  await waitFor(() =>
    expect(screen.getByRole("combobox", { name: "Branch" })).toHaveTextContent(
      "main",
    ),
  )
  // And the page settles the memory on a real branch again.
  await waitFor(() =>
    expect(readSelectedBranch(WORKSPACE_ID, DEMO_REPO_ID)).toBe("main"),
  )
})

test("choosing a branch remembers it for this project", async () => {
  const user = userEvent.setup()
  renderWithBranchPicker()
  await ready()

  await user.click(await screen.findByRole("combobox", { name: "Branch" }))
  await user.click(await screen.findByRole("option", { name: /^develop/ }))

  await waitFor(() =>
    expect(readSelectedBranch(WORKSPACE_ID, DEMO_REPO_ID)).toBe("develop"),
  )
})

/** Where the progress bar is, as the screen reader hears it. */
const barValue = () =>
  Number(
    within(screen.getByTestId("scan-progress-panel"))
      .getByRole("progressbar")
      .getAttribute("aria-valuenow") ?? "0",
  )

test("a scan keeps the previous results usable, with a progress card above them", async () => {
  const user = userEvent.setup()
  render(<DashboardView repoId={DEMO_REPO_ID} />)
  await ready()
  await user.click(screen.getByRole("button", { name: /^scan/i }))

  const card = await screen.findByTestId("scan-progress-panel")
  expect(card).toHaveAttribute("data-size", "card")
  // The results stay on screen and stay usable while it runs.
  expect(screen.getByText("Code Health")).toBeInTheDocument()
  expect(screen.getByRole("list", { name: "Top findings" })).toBeInTheDocument()
  await user.click(tab("Findings"))
  expect(
    await screen.findByRole("list", { name: /ranked refactor findings/i }),
  ).toBeInTheDocument()
  expect(await screen.findByTestId("scan-progress-panel")).toHaveTextContent(
    /acme-payments on main/,
  )
})

test("when it is done, 'Show them' — the page never swaps by itself", async () => {
  const user = userEvent.setup()
  render(<DashboardView repoId={DEMO_REPO_ID} />)
  await ready()
  const analyzed = () =>
    screen.getByTitle(/^Last analyzed/).getAttribute("title")
  const before = (await screen.findByTitle(/^Last analyzed/)).getAttribute(
    "title",
  )
  await user.click(screen.getByRole("button", { name: /^scan/i }))

  // Scan and score done: the card says so, and the OLD results are still up.
  expect(
    await screen.findByText("New results are ready", {}, { timeout: 15_000 }),
  ).toBeInTheDocument()
  await waitFor(() => expect(analyzed()).toBe(before))

  await user.click(screen.getByRole("button", { name: "Show them" }))
  await waitFor(() => expect(analyzed()).not.toBe(before))
  expect(screen.queryByTestId("scan-progress-panel")).not.toBeInTheDocument()
  expect(screen.getByText("Code Health")).toBeInTheDocument()
}, 20_000)

test("leave the dashboard mid-scan, come back: same bar, still running", async () => {
  const user = userEvent.setup()
  const first = render(<DashboardView repoId={DEMO_REPO_ID} />)
  await ready()
  await user.click(screen.getByRole("button", { name: /^scan/i }))
  await screen.findByTestId("scan-progress-panel")
  await waitFor(() => expect(barValue()).toBeGreaterThan(0))
  const leftAt = barValue()
  first.unmount() // navigated away

  render(<DashboardView repoId={DEMO_REPO_ID} />)
  await ready()
  // Not restarted: at least where it was, never back at zero.
  expect(barValue()).toBeGreaterThanOrEqual(leftAt)
  expect(await screen.findByTestId("scan-progress-panel")).toHaveTextContent(
    /acme-payments on main/,
  )
  expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument()
})

test("a scan started elsewhere is found when the dashboard opens", async () => {
  const { startScan: apiStartScan } = await import("@/lib/api/client")
  await apiStartScan(DEMO_REPO_ID, "main")

  render(<DashboardView repoId={DEMO_REPO_ID} />)

  expect(await screen.findByTestId("scan-progress-panel")).toBeInTheDocument()
})

test("a first scan has nothing to keep: the middle of the page is the job", async () => {
  const user = userEvent.setup()
  render(<DashboardView repoId={UNSCANNED_REPO_ID} />)
  const card = await screen.findByTestId("first-scan-card")
  await user.click(within(card).getByRole("button", { name: /^scan/i }))

  const panel = await screen.findByTestId("scan-progress-panel")
  expect(panel).toHaveAttribute("data-size", "full")
  expect(within(panel).getByRole("status")).toHaveTextContent(
    /Queued|Cloning the repository|Measuring code|Reading git history|Reading comments|Finding debt|Predicting risk|Saving and scoring/,
  )
  expect(
    within(panel).getByRole("list", { name: "Scan steps" }),
  ).toBeInTheDocument()
})

test("the dashboard says which profile its numbers are scored with", async () => {
  render(<DashboardView repoId={DEMO_REPO_ID} />)
  await ready()
  const chip = await screen.findByTestId("scored-with")
  expect(chip).toHaveTextContent(`Scored with ${mockHealthReport.profile}`)
  expect(chip).toHaveAttribute("href", "/profiles")
})

test("the report loads beside the branch list, for the default branch, once and with no flash", async () => {
  const healthAsked: (string | null)[] = []
  const scansAsked: (string | null)[] = []
  let releaseBranches!: () => void
  const branchesHeld = new Promise<void>((resolve) => {
    releaseBranches = resolve
  })
  // Each handler records or waits, then falls through to the mock API.
  server.use(
    http.get("*/api/repos/:repoId/branches", async () => {
      await branchesHeld
      return undefined
    }),
    http.get("*/api/repos/:repoId/health", ({ request }) => {
      healthAsked.push(new URL(request.url).searchParams.get("branch"))
      return undefined
    }),
    http.get("*/api/repos/:repoId/scans", ({ request }) => {
      scansAsked.push(new URL(request.url).searchParams.get("branch"))
      return undefined
    }),
  )

  const { container } = render(<DashboardView repoId={DEMO_REPO_ID} />)
  await new Promise((resolve) => setTimeout(resolve, 50))

  // Already asked while the branch list is still out, using the project's default.
  expect(healthAsked).toEqual(["main"])
  expect(scansAsked).toEqual(["main"])
  expect(screen.queryByTestId("first-scan-card")).not.toBeInTheDocument()

  releaseBranches()
  await ready()
  expect(container.querySelector('[aria-busy="true"]')).toBeNull()
  expect(screen.queryByTestId("first-scan-card")).not.toBeInTheDocument()
  // The branch list confirmed the guess: still one ask each, never an empty branch.
  expect(healthAsked).toEqual(["main"])
  expect(scansAsked).toEqual(["main"])
})

test("a remembered branch that no longer exists never flashes the first-scan card", async () => {
  writeSelectedBranch(WORKSPACE_ID, DEMO_REPO_ID, "deleted-branch")
  let releaseBranches!: () => void
  const branchesHeld = new Promise<void>((resolve) => {
    releaseBranches = resolve
  })
  const healthAsked: (string | null)[] = []
  server.use(
    http.get("*/api/repos/:repoId/branches", async () => {
      await branchesHeld
      return undefined
    }),
    http.get("*/api/repos/:repoId/health", ({ request }) => {
      const branch = new URL(request.url).searchParams.get("branch")
      healthAsked.push(branch)
      if (branch === "deleted-branch") {
        return HttpResponse.json(
          { detail: "No scans on this branch", code: "NOT_FOUND" },
          { status: 404 },
        )
      }
      return undefined
    }),
  )

  const { container } = render(<DashboardView repoId={DEMO_REPO_ID} />)
  await waitFor(() => expect(healthAsked).toContain("deleted-branch"))
  await new Promise((resolve) => setTimeout(resolve, 50))
  // The guess missed, but until the branch list confirms it the page keeps loading.
  expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
  expect(screen.queryByTestId("first-scan-card")).not.toBeInTheDocument()

  releaseBranches()
  await ready()
  expect(screen.queryByTestId("first-scan-card")).not.toBeInTheDocument()
  expect(healthAsked.at(-1)).toBe("main")
})
