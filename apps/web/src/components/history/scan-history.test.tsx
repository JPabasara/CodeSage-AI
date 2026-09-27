import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { http, HttpResponse } from "msw"
import { beforeEach, expect, test, vi } from "vitest"

import { ScanHistory } from "./scan-history"
import { server } from "@/lib/mocks/server"
import { DEMO_REPO_ID, UNSCANNED_REPO_ID } from "@/lib/mocks/fixtures"

const nav = vi.hoisted(() => ({
  push: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push }),
}))

beforeEach(() => {
  nav.push.mockReset()
})

test("shows a skeleton while the first request is in flight", () => {
  render(<ScanHistory repoId={DEMO_REPO_ID} />)

  // Synchronous assertion, deliberately: nothing has resolved yet.
  expect(screen.getByTestId("scan-history-loading")).toBeInTheDocument()
  expect(screen.queryByRole("table")).not.toBeInTheDocument()
  expect(screen.queryByText(/no scans yet/i)).not.toBeInTheDocument()
})

test("lists the stored snapshots newest first (FR-19)", async () => {
  render(<ScanHistory repoId={DEMO_REPO_ID} />)

  // One header row plus one row per snapshot.
  const rows = await screen.findAllByRole("row")
  expect(rows.length).toBeGreaterThan(1)

  const first = within(rows[1])
  // The newest snapshot in the fixture is a1b2c3d.
  expect(first.getByText("a1b2c3d")).toBeInTheDocument()
  expect(first.getByText("main")).toBeInTheDocument()
})

test("opens an exact historical snapshot from a row", async () => {
  render(<ScanHistory repoId={DEMO_REPO_ID} />)

  const rows = await screen.findAllByRole("row")
  await userEvent.click(rows[1])

  expect(nav.push).toHaveBeenCalledWith(
    expect.stringMatching(
      new RegExp(
        `/dashboard/${DEMO_REPO_ID}\\?branch=main&snapshot_id=[0-9a-f-]+`,
      ),
    ),
  )
})

test("exposes a latest-scan link for the branch", async () => {
  render(<ScanHistory repoId={DEMO_REPO_ID} />)

  const latest = await screen.findByRole("link", {
    name: /open latest scan/i,
  })
  expect(latest).toHaveAttribute(
    "href",
    `/dashboard/${DEMO_REPO_ID}?branch=main`,
  )
})

test("the oldest row says no change rather than inventing a direction", async () => {
  render(<ScanHistory repoId={DEMO_REPO_ID} />)

  const rows = await screen.findAllByRole("row")
  const oldest = within(rows[rows.length - 1])
  expect(oldest.getByText("no change")).toBeInTheDocument()
})

test("a connected repository with no scans reads as empty, not broken", async () => {
  render(<ScanHistory repoId={UNSCANNED_REPO_ID} />)

  expect(await screen.findByText(/no scans yet/i)).toBeInTheDocument()
  // The way forward, not an apology.
  expect(screen.getByRole("link", { name: "Go to dashboard" })).toHaveAttribute(
    "href",
    `/dashboard/${UNSCANNED_REPO_ID}`,
  )
  expect(screen.queryByRole("table")).not.toBeInTheDocument()
})

test("a failure reads as an error, not as an empty state", async () => {
  server.use(
    http.get("*/api/repos/:repoId/scans", () =>
      HttpResponse.json(
        { detail: "Something broke.", code: "INTERNAL_ERROR" },
        { status: 500 },
      ),
    ),
  )
  render(<ScanHistory repoId={DEMO_REPO_ID} />)

  expect(
    await screen.findByText(/couldn’t load the scan history/i),
  ).toBeInTheDocument()
  expect(screen.queryByText(/no scans yet/i)).not.toBeInTheDocument()
})

test("Retry shows the skeleton, then fills the table in", async () => {
  let failing = true
  // Hold the retried read open, so the in-between state is a moment the test
  // can stand in rather than a race it might lose.
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  server.use(
    http.get("*/api/repos/:repoId/scans", async () => {
      if (failing)
        return HttpResponse.json(
          { detail: "Something broke.", code: "INTERNAL_ERROR" },
          { status: 500 },
        )
      await held
      return HttpResponse.json(ONE_ROW)
    }),
  )
  render(<ScanHistory repoId={DEMO_REPO_ID} />)

  await screen.findByText(/couldn’t load the scan history/i)
  failing = false
  await userEvent.click(screen.getByRole("button", { name: "Retry" }))

  // The press is VISIBLE. With the old quiet `reload` nothing changed here at
  // all until the answer landed, so the button read as dead and got pressed
  // again — which is the whole of #110.
  expect(await screen.findByTestId("scan-history-loading")).toBeInTheDocument()
  expect(
    screen.queryByText(/couldn’t load the scan history/i),
  ).not.toBeInTheDocument()

  // …and Retry re-runs the fetch, not just the message.
  release()
  await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument())
  expect(screen.getByText("a1b2c3d")).toBeInTheDocument()
})

/** One valid ScanSummary — enough to prove a refetch landed. */
const ONE_ROW = [
  {
    snapshot_id: "4d5f7b92-1e3c-4a47-8df0-2b3c5e7a9d16",
    scan_id: "8f6c4b19-0a7d-4ec3-9514-b607c9da4f58",
    branch: "main",
    commit_sha: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
    scanned_at: "2026-07-22T18:35:00.000Z",
    finding_count: 10,
    health_score: 72,
    grade: "B",
    delta: 3,
  },
]

// ── branch filter (Phase 13D) ───────────────────────────────────────────────

test("All branches by default; each row shows its branch", async () => {
  render(<ScanHistory repoId={DEMO_REPO_ID} />)
  expect(
    screen.getByRole("combobox", { name: "Filter by branch" }),
  ).toHaveTextContent("All branches")
  const rows = await screen.findAllByRole("row")
  expect(within(rows[1]).getByText("main")).toBeInTheDocument()
})

test("filtering asks the API for one branch", async () => {
  const asked: (string | null)[] = []
  server.use(
    http.get("*/api/repos/:repoId/scans", ({ request }) => {
      asked.push(new URL(request.url).searchParams.get("branch"))
      return HttpResponse.json([])
    }),
  )
  render(<ScanHistory repoId={DEMO_REPO_ID} />)
  await waitFor(() => expect(asked).toEqual([null])) // all branches

  await userEvent.click(
    screen.getByRole("combobox", { name: "Filter by branch" }),
  )
  await userEvent.click(await screen.findByRole("option", { name: "develop" }))

  await waitFor(() => expect(asked).toContain("develop"))
  expect(
    await screen.findByText(/no scans on develop yet/i),
  ).toBeInTheDocument()
})

test("the heading names the project the history belongs to", async () => {
  render(<ScanHistory repoId={DEMO_REPO_ID} />)

  const heading = screen.getByRole("heading", { level: 1, name: /history/i })
  const header = heading.closest("header") as HTMLElement
  // The top bar says it too, but the page should not depend on the bar.
  expect(
    await within(header).findByText("acme/acme-payments"),
  ).toBeInTheDocument()
})

test("says which profile every row is scored with, and where to change it", async () => {
  render(<ScanHistory repoId={DEMO_REPO_ID} />)
  const line = await screen.findByTestId("history-profile")
  // The mock project inherits the workspace default, Balanced.
  expect(line).toHaveTextContent(
    "All scans are shown under the Balanced profile — change it in Profiles.",
  )
  expect(
    within(line).getByRole("link", { name: "change it in Profiles" }),
  ).toHaveAttribute("href", "/profiles")
})
