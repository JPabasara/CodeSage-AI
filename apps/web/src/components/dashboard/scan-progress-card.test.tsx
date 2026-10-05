import { act, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

import {
  POLL_MS,
  scanKey,
  startScan,
  type TrackedScan,
} from "@/hooks/use-scan-center"
import { formatElapsed } from "@/lib/scan-messages"
import { DEMO_REPO_ID, WORKSPACE_ID } from "@/lib/mocks/fixtures"
import { ScanProgressCard } from "./scan-progress-card"

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
    progress: 54,
    stage: "reading_code",
    step: "reading_comments",
    files_done: 214,
    files_total: 329,
    typical_seconds: 130,
  },
  ...patch,
})

const stepStates = () =>
  within(screen.getByRole("list", { name: "Scan steps" }))
    .getAllByRole("listitem")
    .map((item) => item.getAttribute("data-state"))

test.each([
  [0, "0s"],
  [4_000, "4s"],
  [72_000, "1m 12s"],
])("elapsed %i ms reads %s", (ms, text) => {
  expect(formatElapsed(ms)).toBe(text)
})

test("names the step, its count, where, and the usual time", () => {
  render(<ScanProgressCard scan={job()} />)

  expect(screen.getByRole("status")).toHaveTextContent("Reading comments")
  const card = screen.getByTestId("scan-progress-panel")
  expect(card).toHaveTextContent(
    "Step 4 of 7 · 214 of 329 files · payments on main",
  )
  expect(card).toHaveTextContent(/Usually about 2 min/)
  expect(card).toHaveAttribute("data-mode", "comments")
})

test("the stepper marks the steps before as done and this one as now", () => {
  render(<ScanProgressCard scan={job()} />)
  expect(stepStates()).toEqual([
    "done",
    "done",
    "done",
    "now",
    "upcoming",
    "upcoming",
    "upcoming",
  ])
})

test("a step with nothing counted yet never says 0 of N", () => {
  render(
    <ScanProgressCard
      scan={job({
        status: {
          ...job().status,
          progress: 37,
          step: "reading_history",
          commits_done: 0,
          commits_total: 1212,
          files_done: null,
          files_total: null,
        },
      })}
    />,
  )
  const card = screen.getByTestId("scan-progress-panel")
  expect(card).toHaveTextContent("Reading git history")
  expect(card).toHaveTextContent("Starting…")
  expect(card).not.toHaveTextContent("0 of")
})

test("the bar comes from the store and keeps going across a re-render", async () => {
  await act(() =>
    startScan({
      workspaceId: WORKSPACE_ID,
      repoId: DEMO_REPO_ID,
      branch: "main",
      repoName: "payments",
    }),
  )
  const key = scanKey(WORKSPACE_ID, DEMO_REPO_ID, "main")
  const { rerender } = render(<ScanProgressCard scan={job({ key })} />)
  await tick(POLL_MS * 2)
  const bar = Number(
    screen.getByRole("progressbar").getAttribute("aria-valuenow"),
  )
  expect(bar).toBeGreaterThan(0)

  // A re-render (or a remount, or the full size) starts nothing over.
  rerender(<ScanProgressCard scan={job({ key })} size="full" />)
  expect(
    Number(screen.getByRole("progressbar").getAttribute("aria-valuenow")),
  ).toBeGreaterThanOrEqual(bar)
})

test("queued: waiting for a worker, with a sweeping bar and no made-up number", () => {
  render(
    <ScanProgressCard
      scan={job({ status: { scan_id: "", phase: "queued", progress: 0 } })}
      canStop
      onStop={() => {}}
    />,
  )
  const card = screen.getByTestId("scan-progress-panel")
  expect(screen.getByRole("status")).toHaveTextContent("Queued")
  expect(card).toHaveTextContent("payments on main · waiting for a worker")
  expect(screen.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow")
  expect(stepStates()).not.toContain("now")
  // No id yet, so nothing to stop.
  expect(screen.getByRole("button", { name: "Stop" })).toBeDisabled()
})

test("Stop asks, then reads Stopping… until the scan ends", async () => {
  vi.useRealTimers()
  const onStop = vi.fn()
  const { rerender } = render(
    <ScanProgressCard scan={job()} canStop onStop={onStop} />,
  )
  await userEvent.click(screen.getByRole("button", { name: "Stop" }))
  expect(onStop).toHaveBeenCalledOnce()

  rerender(
    <ScanProgressCard scan={job({ stopping: true })} canStop onStop={onStop} />,
  )
  // The step stays in view: it is what has to finish before the scan stops.
  expect(screen.getByRole("status")).toHaveTextContent(
    "Stopping · Reading comments",
  )
  expect(screen.getByRole("button", { name: "Stopping…" })).toBeDisabled()
})

test("a red banner says the scan stops when the current step finishes", () => {
  render(
    <ScanProgressCard
      scan={job({ stopping: true })}
      canStop
      onStop={() => {}}
    />,
  )

  const banner = screen.getByTestId("scan-stopping-banner")
  expect(banner).toHaveTextContent(
    "Stopping. The scan will stop when the current step finishes (Reading comments).",
  )
  expect(banner).toHaveTextContent("Nothing from this scan is saved.")
  expect(banner.className).toMatch(/destructive/)
})

test("a Stop pressed in another tab shows here too, from the server", () => {
  render(
    <ScanProgressCard
      scan={job({ status: { ...job().status, cancel_requested: true } })}
      canStop
      onStop={() => {}}
    />,
  )
  expect(screen.getByTestId("scan-stopping-banner")).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Stopping…" })).toBeDisabled()
})

test("no banner while nobody has pressed Stop", () => {
  render(<ScanProgressCard scan={job()} canStop onStop={() => {}} />)
  expect(screen.queryByTestId("scan-stopping-banner")).toBeNull()
})

test("a role that cannot stop scans sees progress without Stop", () => {
  render(<ScanProgressCard scan={job()} canStop={false} onStop={() => {}} />)
  expect(screen.queryByRole("button", { name: /stop/i })).toBeNull()
})

test("scoring is the last step, on the score's own bar, with nothing to stop", () => {
  render(
    <ScanProgressCard
      scan={job({
        job: "scoring",
        scoringSince: Date.now(),
        status: { scan_id: "s1", phase: "done", progress: 100 },
      })}
      canStop
      onStop={() => {}}
    />,
  )
  expect(screen.getByRole("status")).toHaveTextContent("Saving and scoring")
  expect(screen.getByRole("progressbar")).toHaveAccessibleName("Score progress")
  expect(stepStates().at(-1)).toBe("now")
  expect(screen.queryByRole("button", { name: /stop/i })).toBeNull()
})

test("a scan well past its usual time says so", () => {
  render(
    <ScanProgressCard
      scan={job({
        startedAt: Date.now() - 5 * 60_000,
        status: { ...job().status, stage: "predicting_risk", step: null },
      })}
    />,
  )
  expect(screen.getByTestId("scan-progress-panel")).toHaveAttribute(
    "data-slow",
    "true",
  )
})

test("full size is the first-scan screen, and says the user can leave", () => {
  render(<ScanProgressCard scan={job()} size="full" />)
  const card = screen.getByTestId("scan-progress-panel")
  expect(card).toHaveAttribute("data-size", "full")
  expect(card).toHaveTextContent(/you can leave this page/i)
})

test("ready: offers 'Show them' with the new score and its change", async () => {
  vi.useRealTimers()
  const onShow = vi.fn()
  render(
    <ScanProgressCard
      scan={job({
        job: "ready",
        health: { score: 72.4, grade: "B", delta: 2 },
      })}
      onShow={onShow}
    />,
  )
  expect(screen.getByRole("status")).toHaveTextContent("New results are ready")
  expect(screen.getByText(/Health 72 \(B\) \(\+2\)/)).toBeInTheDocument()

  await userEvent.click(screen.getByRole("button", { name: "Show them" }))
  expect(onShow).toHaveBeenCalledOnce()
})
