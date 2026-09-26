import { act, render, renderHook } from "@testing-library/react"
import { http, HttpResponse } from "msw"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

import { ScanCenter } from "./scan-center"
import {
  POLL_MS,
  scanKey,
  startScan,
  stopScan,
  useScanFor,
} from "@/hooks/use-scan-center"
import {
  healthKey,
  SCORE_POLL_MS,
  SCORE_TIMEOUT_MS,
} from "@/hooks/use-health-report"
import { readWorkspaceEpoch } from "@/hooks/use-workspace-scope"
import { writeCached } from "@/lib/query-cache"
import {
  DEMO_REPO_ID,
  mockHealthReport,
  WORKSPACE_ID,
} from "@/lib/mocks/fixtures"
import { server } from "@/lib/mocks/server"

const nav = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: vi.fn() }),
}))

const toasts = vi.hoisted(() => ({
  plain: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}))
vi.mock("sonner", () => ({
  toast: Object.assign(toasts.plain, {
    success: toasts.success,
    error: toasts.error,
  }),
}))

beforeEach(() => {
  vi.useFakeTimers()
  nav.push.mockClear()
  toasts.plain.mockClear()
  toasts.success.mockClear()
  toasts.error.mockClear()
})
afterEach(() => vi.useRealTimers())

const target = {
  workspaceId: WORKSPACE_ID,
  repoId: DEMO_REPO_ID,
  branch: "main",
  repoName: "acme-payments",
}
const polls = (n: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(POLL_MS * n)
  })

test("queued is acknowledged, and 'ready' comes only with the score", async () => {
  render(<ScanCenter />)
  await act(() => startScan(target))
  expect(toasts.plain).toHaveBeenCalledWith(
    "Scan queued · acme-payments · main",
  )

  // The scan is done, but its score is still being calculated: no toast yet.
  await polls(8)
  expect(toasts.success).not.toHaveBeenCalled()

  await act(async () => {
    await vi.advanceTimersByTimeAsync(SCORE_POLL_MS * 4)
  })
  expect(toasts.success).toHaveBeenCalledWith(
    "acme-payments · main is ready",
    expect.objectContaining({
      description: expect.stringMatching(
        /^Health \d+ \([A-F]\) · [+−]\d+ since the last scan$/,
      ),
    }),
  )
})

test("'View dashboard' goes there and shows the new results, not the pinned ones", async () => {
  // Results were on screen before the scan: the job will wait for a look.
  writeCached(healthKey(readWorkspaceEpoch(), DEMO_REPO_ID, "main"), {
    ...mockHealthReport,
    snapshot_id: "before",
  })
  const { result } = renderHook(() => useScanFor(DEMO_REPO_ID, "main"))
  render(<ScanCenter />)
  await act(() => startScan(target))
  await polls(8)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(SCORE_POLL_MS * 4)
  })
  expect(result.current.scan?.job).toBe("ready")

  const { action } = toasts.success.mock.calls[0][1]
  expect(action.label).toBe("View dashboard")
  act(() => action.onClick())
  expect(nav.push).toHaveBeenCalledWith(
    `/dashboard/${DEMO_REPO_ID}?branch=main`,
  )
  expect(result.current.scan).toBeUndefined()
})

test("a score that comes too late still ends the job, and says so", async () => {
  server.use(
    http.get("*/api/repos/:repoId/health", () =>
      HttpResponse.json(
        { detail: "Still scoring.", code: "SCORE_PENDING" },
        { status: 503 },
      ),
    ),
  )
  render(<ScanCenter />)
  await act(() => startScan(target))
  await polls(8)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(SCORE_TIMEOUT_MS + SCORE_POLL_MS)
  })
  expect(toasts.success).toHaveBeenCalledWith(
    "Scan complete · acme-payments · main",
    expect.objectContaining({
      description: expect.stringMatching(/still being calculated/),
    }),
  )
})

test("nothing new on the branch says 'already up to date'", async () => {
  render(<ScanCenter />)
  await act(() => startScan(target))
  await polls(8)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(SCORE_POLL_MS * 4)
  })
  toasts.plain.mockClear()

  await act(() => startScan(target)) // same head commit as the last scan
  expect(toasts.plain).toHaveBeenCalledWith(
    "acme-payments is already up to date",
    expect.objectContaining({
      description: "No new commits on main since the last scan.",
    }),
  )
})

test("a stop says the results are unchanged and offers Try again", async () => {
  render(<ScanCenter />)
  await act(() => startScan(target))
  await act(() => stopScan(scanKey(WORKSPACE_ID, DEMO_REPO_ID, "main")))
  await polls(1)

  expect(toasts.plain).toHaveBeenCalledWith(
    "Scan stopped · acme-payments · main",
    expect.objectContaining({
      description: "The previous results are unchanged.",
      action: expect.objectContaining({ label: "Try again" }),
    }),
  )
})

test("a start that fails explains, with Try again", async () => {
  server.use(
    http.post("*/api/repos/:repoId/scan", () =>
      HttpResponse.json(
        {
          detail: "GitHub is not answering right now.",
          code: "UPSTREAM_UNAVAILABLE",
        },
        { status: 503 },
      ),
    ),
  )
  render(<ScanCenter />)
  await act(() => startScan(target))

  expect(toasts.error).toHaveBeenCalledWith(
    "Couldn't start the scan",
    expect.objectContaining({
      description: "GitHub is not answering right now.",
      action: expect.objectContaining({ label: "Try again" }),
    }),
  )
})
