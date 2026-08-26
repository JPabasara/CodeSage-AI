import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { http, HttpResponse } from "msw"
import { expect, test } from "vitest"

import { ScanHistory } from "./scan-history"
import { server } from "@/lib/mocks/server"
import { DEMO_REPO_ID, UNSCANNED_REPO_ID } from "@/lib/mocks/fixtures"

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

test("Retry actually refetches, so a recovered backend fills the table in", async () => {
  let failing = true
  server.use(
    http.get("*/api/repos/:repoId/scans", () =>
      failing
        ? HttpResponse.json(
            { detail: "Something broke.", code: "INTERNAL_ERROR" },
            { status: 500 },
          )
        : HttpResponse.json(ONE_ROW),
    ),
  )
  render(<ScanHistory repoId={DEMO_REPO_ID} />)

  await screen.findByText(/couldn’t load the scan history/i)
  failing = false
  await userEvent.click(screen.getByRole("button", { name: "Retry" }))

  // Retry has to re-run the fetch, not just clear the message.
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
