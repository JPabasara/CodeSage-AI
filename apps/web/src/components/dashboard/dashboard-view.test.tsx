import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { http, HttpResponse } from "msw"
import { toast } from "sonner"
import { beforeEach, expect, test, vi } from "vitest"

import { DashboardView } from "@/components/dashboard/dashboard-view"
import {
  DEMO_REPO_ID,
  UNSCANNED_REPO_ID,
  mockFindings,
  mockHealthReport,
  mockScanHistory,
} from "@/lib/mocks/fixtures"
import { server } from "@/lib/mocks/server"

// The selection lives in the URL, so a container test needs a router that
// actually re-renders on navigate. This is a miniature one: a query string in a
// module-level store, with useSearchParams subscribed to it.
const nav = vi.hoisted(() => {
  let params = new URLSearchParams()
  const listeners = new Set<() => void>()
  return {
    read: () => params,
    subscribe: (fn: () => void) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    navigate: (url: string) => {
      params = new URLSearchParams(url.split("?")[1] ?? "")
      listeners.forEach((fn) => fn())
    },
    reset: () => {
      params = new URLSearchParams()
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

beforeEach(() => {
  nav.reset()
  server.resetHandlers()
})

/** Wait for the (mock) health report to land. */
async function ready() {
  expect(await screen.findByText("Code Health")).toBeInTheDocument()
}

test("selecting a finding swaps the health card for the detail, in place", async () => {
  render(<DashboardView repoId={DEMO_REPO_ID} />)
  await ready()

  // by reason, not symbol: two fixtures share the symbol "charge()"
  await userEvent.click(
    screen.getByRole("row", { name: /hardcoded stripe api key/i }),
  )

  const detail = await screen.findByLabelText("Finding detail")
  expect(within(detail).getByText(CRITICAL.reason)).toBeInTheDocument()
  // the region was replaced, not covered
  expect(screen.queryByText("Code Health")).not.toBeInTheDocument()
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  // …and the list is still there, so the next finding is one click away
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

test("the tree highlights the selected finding's file", async () => {
  nav.navigate(`/dashboard/${DEMO_REPO_ID}?finding=${CRITICAL.fingerprint}`)
  render(<DashboardView repoId={DEMO_REPO_ID} />)
  await screen.findByLabelText("Finding detail")

  const tree = screen.getByLabelText("File health tree")
  const highlighted = within(tree).getByRole("button", { current: true })
  expect(highlighted).toHaveTextContent("payment_service.ts")
})

test("closing restores the health card and the trend chart", async () => {
  nav.navigate(`/dashboard/${DEMO_REPO_ID}?finding=${CRITICAL.fingerprint}`)
  render(<DashboardView repoId={DEMO_REPO_ID} />)
  await screen.findByLabelText("Finding detail")

  await userEvent.click(
    screen.getByRole("button", { name: /close finding detail/i }),
  )

  await waitFor(() =>
    expect(screen.getByText("Code Health")).toBeInTheDocument(),
  )
  expect(screen.queryByLabelText("Finding detail")).not.toBeInTheDocument()
})

test("clicking a file in the tree opens that file's finding", async () => {
  render(<DashboardView repoId={DEMO_REPO_ID} />)
  await ready()

  const tree = screen.getByLabelText("File health tree")
  await userEvent.click(
    within(tree).getByRole("button", { name: /order_controller\.ts/i }),
  )

  const detail = await screen.findByLabelText("Finding detail")
  expect(
    within(detail).getByText(/order_controller\.ts:\d+/),
  ).toBeInTheDocument()
})

// ── the never-scanned repository ────────────────────────────────────────────
// Connect a brand-new repo, open it, and the dashboard used to be blank with no
// way out. The health endpoint answers 404 for a branch that has never been
// scanned, and the top nav lived inside the success branch — so the 404 took
// the Scan button down with it.

test("a snapshot_id URL loads historical mode and can return to latest", async () => {
  const older = mockScanHistory[1]
  nav.navigate(
    `/dashboard/${DEMO_REPO_ID}?branch=${older.branch}&snapshot_id=${older.snapshot_id}`,
  )
  render(<DashboardView repoId={DEMO_REPO_ID} />)
  await ready()

  expect(screen.getByText("Historical snapshot")).toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: /latest scan/i }))

  expect(nav.read().get("snapshot_id")).toBeNull()
  expect(nav.read().get("branch")).toBe("main")
})

test("normal dashboard arrows can move to an older scan", async () => {
  render(<DashboardView repoId={DEMO_REPO_ID} />)
  await ready()

  const older = await screen.findByRole("button", { name: /older scan/i })
  await waitFor(() => expect(older).not.toBeDisabled())
  await userEvent.click(older)

  expect(nav.read().get("snapshot_id")).toBe(mockScanHistory[1].snapshot_id)
  expect(nav.read().get("branch")).toBe("main")
})

test("renders the ranked-list label and tree legend", async () => {
  render(<DashboardView repoId={DEMO_REPO_ID} />)
  await ready()

  expect(screen.getByText(/ranked by priority/i)).toBeInTheDocument()
  expect(screen.getByLabelText("Heat map legend")).toBeInTheDocument()
})

test("clicking a tree file with no finding shows feedback", async () => {
  render(<DashboardView repoId={DEMO_REPO_ID} />)
  await ready()

  const tree = screen.getByLabelText("File health tree")
  await userEvent.click(
    within(tree).getByRole("button", { name: /formatters\.ts/i }),
  )

  const status = await screen.findByRole("status")
  expect(status).toHaveTextContent(
    "formatters.ts has no findings in this snapshot.",
  )
  expect(toast).toHaveBeenCalledWith(
    "formatters.ts has no findings in this snapshot.",
  )
  expect(screen.queryByLabelText("Finding detail")).not.toBeInTheDocument()
})

test("a never-scanned repo still gets the top nav, so a scan can be started", async () => {
  render(<DashboardView repoId={UNSCANNED_REPO_ID} />)

  // the empty state, not the error treatment
  expect(await screen.findByText(/no scans yet/i)).toBeInTheDocument()
  expect(
    screen.queryByText(/couldn’t load this dashboard/i),
  ).not.toBeInTheDocument()

  // …and the controls that produce the first snapshot are on screen
  expect(screen.getByRole("button", { name: /^scan$/i })).toBeInTheDocument()
  expect(screen.getByLabelText("Branch")).toBeInTheDocument()
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
  expect(screen.queryByText(/no scans yet/i)).not.toBeInTheDocument()
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
  expect(screen.queryByText(/no scans yet/i)).not.toBeInTheDocument()
  // the nav survives this too — switching branch is the obvious recovery
  expect(screen.getByRole("button", { name: /^scan$/i })).toBeInTheDocument()
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
    // Terminal on the first poll: this test is about the refetch, not about
    // watching the progress bar climb.
    http.get("*/api/repos/:repoId/scan/:scanId", () => {
      scanned = true
      return HttpResponse.json({ scan_id: "s1", phase: "done", progress: 100 })
    }),
  )

  render(<DashboardView repoId={UNSCANNED_REPO_ID} />)
  await screen.findByText(/no scans yet/i)

  await userEvent.click(screen.getByRole("button", { name: /^scan$/i }))

  // Without useScan's onComplete wired to the report's reload(), this never
  // arrives and the empty state sits there until a manual refresh.
  expect(
    await screen.findByText("Code Health", {}, { timeout: 4000 }),
  ).toBeInTheDocument()
  expect(screen.queryByText(/no scans yet/i)).not.toBeInTheDocument()
})

// ── SCORE_PENDING (#109) ────────────────────────────────────────────────────
//
// The API scores a snapshot in a background task, so the read taken the moment a
// scan finishes answers 503 SCORE_PENDING. Rendering that as a red error is the
// first thing anyone sees after their first scan, and it is not true.

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

  // Branch-aware, because the first render asks with an empty branch — the
  // branch list has not landed yet — so "the first ask" is not the first ask
  // for `main`. Counting raw requests would answer ready one poll too early.
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
  expect(screen.queryByText(/no scans yet/i)).not.toBeInTheDocument()

  // Arrives on its own. No Retry pressed, no refresh.
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

test("a never-scanned repository displays the empty state with first-scan guidance, not an error state (U-14)", async () => {
  render(<DashboardView repoId={UNSCANNED_REPO_ID} />)

  expect(await screen.findByText("No scans yet")).toBeInTheDocument()
  expect(
    screen.getByText(/run your first scan to see its health/i),
  ).toBeInTheDocument()

  // Must not be an error state
  expect(
    screen.queryByText(/couldn’t load this dashboard/i),
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole("button", { name: /retry/i }),
  ).not.toBeInTheDocument()
})

test("a report with an empty file tree displays the named empty tree state (U-14)", async () => {
  server.use(
    http.get("*/api/repos/:repoId/health", () =>
      HttpResponse.json({
        ...mockHealthReport,
        tree: [],
      }),
    ),
  )
  render(<DashboardView repoId={DEMO_REPO_ID} />)
  await ready()

  expect(screen.getByText("No files in this tree")).toBeInTheDocument()
  expect(
    screen.getByText(/no files were detected in this snapshot/i),
  ).toBeInTheDocument()
  expect(
    screen.getByText(
      /run a scan to analyze and display the repository file hierarchy/i,
    ),
  ).toBeInTheDocument()
})

test("a report with zero findings displays the celebratory empty state in place of the list (U-14)", async () => {
  server.use(
    http.get("*/api/repos/:repoId/health", () =>
      HttpResponse.json({
        ...mockHealthReport,
        findings: [],
      }),
    ),
  )
  render(<DashboardView repoId={DEMO_REPO_ID} />)
  await ready()

  expect(screen.getByText("No refactoring issues found")).toBeInTheDocument()
  expect(
    screen.getByText(
      /the scan found no technical debt or refactoring issues on this branch/i,
    ),
  ).toBeInTheDocument()
  expect(screen.queryByRole("table")).not.toBeInTheDocument()
})

test("filtering to nothing inside the dashboard displays the filter empty state and clear button (U-14)", async () => {
  server.use(
    http.get("*/api/repos/:repoId/health", () =>
      HttpResponse.json({
        ...mockHealthReport,
        findings: [mockFindings[0]], // only a security finding
      }),
    ),
  )
  const user = userEvent.setup()
  render(<DashboardView repoId={DEMO_REPO_ID} />)
  await ready()

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
  expect(screen.getByRole("table")).toBeInTheDocument()
})
