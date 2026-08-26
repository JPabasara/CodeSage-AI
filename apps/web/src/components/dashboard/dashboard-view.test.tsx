import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { http, HttpResponse } from "msw"
import { beforeEach, expect, test, vi } from "vitest"

import { DashboardView } from "@/components/dashboard/dashboard-view"
import {
  DEMO_REPO_ID,
  UNSCANNED_REPO_ID,
  mockFindings,
  mockHealthReport,
} from "@/lib/mocks/fixtures"
import { server } from "@/lib/mocks/server"

// D-CR7 moved the selection into the URL, so a container test needs a router
// that actually re-renders on navigate. This is a miniature one: a query string
// in a module-level store, and useSearchParams subscribed to it.
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

beforeEach(() => nav.reset())

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

// ── J-CR9: the never-scanned repository ─────────────────────────────────────
// Reported by Chamodh: connect a brand-new repo, open it, and the dashboard is
// blank with no way out. The health endpoint answers 404 for a branch that has
// never been scanned (the documented first-run state), and the top nav used to
// live inside the success branch — so the 404 took the Scan button down with it.

test("a never-scanned repo still gets the top nav, so a scan can be started", async () => {
  render(<DashboardView repoId={UNSCANNED_REPO_ID} />)

  // the empty state, not the error treatment
  expect(await screen.findByText(/no scans yet/i)).toBeInTheDocument()
  expect(
    screen.queryByText(/couldn’t load this dashboard/i),
  ).not.toBeInTheDocument()

  // …and the controls that produce the first snapshot are on screen
  expect(screen.getByRole("button", { name: /scan/i })).toBeInTheDocument()
  expect(screen.getByLabelText("Branch")).toBeInTheDocument()
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
  expect(screen.getByRole("button", { name: /scan/i })).toBeInTheDocument()
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

  await userEvent.click(screen.getByRole("button", { name: /scan/i }))

  // Without useScan's onComplete wired to the report's reload(), this never
  // arrives and the empty state sits there until a manual refresh.
  expect(
    await screen.findByText("Code Health", {}, { timeout: 4000 }),
  ).toBeInTheDocument()
  expect(screen.queryByText(/no scans yet/i)).not.toBeInTheDocument()
})
