import { act, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

import { LINE_ROTATE_MS } from "@/hooks/use-rotating-line"
import {
  LIVE_TICK_MS,
  POLL_MS,
  scanKey,
  startScan,
  type TrackedScan,
} from "@/hooks/use-scan-center"
import { SLOW_LINES, SLOW_SCORE_LINES, STAGE_LINES } from "@/lib/scan-messages"
import { DEMO_REPO_ID, WORKSPACE_ID } from "@/lib/mocks/fixtures"
import { ScanProgressPanel } from "./scan-progress-panel"

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-09-26T10:00:00Z"))
})
afterEach(() => vi.useRealTimers())

const tick = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })

/** A job as the store holds it, for the rendering-only cases. */
const job = (patch: Partial<TrackedScan> = {}): TrackedScan => ({
  key: "job",
  workspaceId: WORKSPACE_ID,
  repoId: DEMO_REPO_ID,
  branch: "main",
  repoName: "payments",
  job: "scanning",
  stopping: false,
  startedAt: Date.now() - 10_000,
  status: {
    scan_id: "s1",
    phase: "running",
    progress: 30,
    stage: "reading_code",
    files_done: 120,
    files_total: 1240,
    typical_seconds: 130,
  },
  ...patch,
})

/** Start a real scan through the store and the mock API. */
async function runningScan() {
  await act(() =>
    startScan({
      workspaceId: WORKSPACE_ID,
      repoId: DEMO_REPO_ID,
      branch: "main",
      repoName: "payments",
    }),
  )
  return scanKey(WORKSPACE_ID, DEMO_REPO_ID, "main")
}

test("full: names the stage, the files and the usual time", () => {
  render(<ScanProgressPanel kind="job" scan={job()} size="full" />)

  expect(screen.getByRole("status")).toHaveTextContent(
    "Reading 1,240 Java files",
  )
  expect(screen.getByText("payments on main")).toBeInTheDocument()
  expect(screen.getByText(/120 of 1,240 read/)).toBeInTheDocument()
  expect(screen.getByText(/Usually about 2 min/)).toBeInTheDocument()
  expect(screen.getByTestId("scan-progress-panel")).toHaveAttribute(
    "data-size",
    "full",
  )
})

test("the bar and the line come from the store, and keep going", async () => {
  await runningScan()
  const { rerender } = render(
    <ScanProgressPanel
      kind="job"
      scan={job({ key: scanKey(WORKSPACE_ID, DEMO_REPO_ID, "main") })}
      size="full"
    />,
  )
  await tick(POLL_MS * 2)
  const bar = Number(
    screen.getByRole("progressbar").getAttribute("aria-valuenow"),
  )
  expect(bar).toBeGreaterThan(0)
  expect(screen.getByTestId("scan-panel-line").textContent).not.toBe("")

  // A re-render (or a remount) starts nothing over.
  rerender(
    <ScanProgressPanel
      kind="job"
      scan={job({ key: scanKey(WORKSPACE_ID, DEMO_REPO_ID, "main") })}
      size="compact"
    />,
  )
  expect(
    Number(screen.getByRole("progressbar").getAttribute("aria-valuenow")),
  ).toBeGreaterThanOrEqual(bar)
})

test("compact: the same job, small, above the results", () => {
  render(<ScanProgressPanel kind="job" scan={job()} size="compact" />)
  const panel = screen.getByTestId("scan-progress-panel")
  expect(panel).toHaveAttribute("data-size", "compact")
  expect(screen.getByRole("status")).toHaveTextContent(
    "Reading 1,240 Java files",
  )
})

test("ready: offers 'Show them' with the new score, and nothing moves by itself", async () => {
  const onShow = vi.fn()
  render(
    <ScanProgressPanel
      kind="job"
      scan={job({
        job: "ready",
        health: { score: 72.4, grade: "B", delta: 2 },
      })}
      size="compact"
      onShow={onShow}
    />,
  )
  expect(screen.getByRole("status")).toHaveTextContent("New results are ready")
  expect(screen.getByText(/Health 72 \(B\)/)).toBeInTheDocument()

  vi.useRealTimers()
  await userEvent.click(screen.getByRole("button", { name: "Show them" }))
  expect(onShow).toHaveBeenCalledOnce()
})

test("scoring: the job's last stage says the score is being calculated", () => {
  render(
    <ScanProgressPanel
      kind="job"
      scan={job({ job: "scoring", scoringSince: Date.now() })}
      size="full"
    />,
  )
  expect(screen.getByRole("status")).toHaveTextContent(
    "Calculating your health score",
  )
  expect(screen.getByRole("progressbar")).toHaveAccessibleName("Score progress")
})

test("a scan well past its usual time says so, kindly", async () => {
  await runningScan()
  const key = scanKey(WORKSPACE_ID, DEMO_REPO_ID, "main")
  render(
    <ScanProgressPanel
      kind="job"
      scan={job({
        key,
        startedAt: Date.now() - 5 * 60_000,
        status: { ...job().status, stage: "predicting_risk" },
      })}
      size="full"
    />,
  )
  expect(screen.getByTestId("scan-progress-panel")).toHaveAttribute(
    "data-slow",
    "true",
  )
})

test("queued: waiting for a slot, with a sweeping bar and no made-up number", () => {
  render(
    <ScanProgressPanel
      kind="job"
      scan={job({
        status: { scan_id: "s1", phase: "queued", progress: 0 },
      })}
      size="full"
    />,
  )
  expect(screen.getByRole("status")).toHaveTextContent(
    "Waiting for a free scan slot",
  )
  expect(screen.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow")
})

test("stopping says so", () => {
  render(
    <ScanProgressPanel kind="job" scan={job({ stopping: true })} size="full" />,
  )
  expect(screen.getByRole("status")).toHaveTextContent("Stopping the scan")
})

// ── a re-score with no scan behind it (a profile change) ────────────────────

test("re-scoring after a profile change: its own panel and lines", () => {
  render(<ScanProgressPanel kind="calculating" random={() => 0} />)
  expect(screen.getByRole("status")).toHaveTextContent(
    "Calculating your health score",
  )
  expect(STAGE_LINES.calculating).toContain(
    screen.getByTestId("scan-panel-line").textContent,
  )
})

test("a slow re-score says so kindly instead of failing", () => {
  render(<ScanProgressPanel kind="calculating" slow />)
  expect(screen.getByTestId("scan-progress-panel")).toHaveAttribute(
    "data-slow",
    "true",
  )
  expect(SLOW_SCORE_LINES).toContain(
    screen.getByTestId("scan-panel-line").textContent,
  )
  expect(SLOW_LINES).not.toContain(
    screen.getByTestId("scan-panel-line").textContent,
  )
})

test("its lines stay up for fifteen seconds, then change", async () => {
  render(<ScanProgressPanel kind="calculating" />)
  const first = screen.getByTestId("scan-panel-line").textContent
  await tick(LINE_ROTATE_MS - LIVE_TICK_MS)
  expect(screen.getByTestId("scan-panel-line").textContent).toBe(first)
  await tick(LIVE_TICK_MS * 2)
  expect(screen.getByTestId("scan-panel-line").textContent).not.toBe(first)
})
