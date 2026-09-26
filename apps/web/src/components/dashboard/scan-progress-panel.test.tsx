import { act, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

import { LINE_ROTATE_MS } from "@/hooks/use-rotating-line"
import { SLOW_LINES, SLOW_SCORE_LINES, STAGE_LINES } from "@/lib/scan-messages"
import type { ScanStatus } from "@/lib/types"
import { ScanProgressPanel } from "./scan-progress-panel"

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-09-26T10:00:00Z"))
})
afterEach(() => vi.useRealTimers())

const status = (patch: Partial<ScanStatus>): ScanStatus => ({
  scan_id: "s1",
  phase: "running",
  progress: 25,
  stage: "reading_code",
  files_done: 120,
  files_total: 1240,
  typical_seconds: 130,
  ...patch,
})

const panel = (patch: Partial<ScanStatus> = {}, startedAgoMs = 10_000) => (
  <ScanProgressPanel
    kind="scan"
    status={status(patch)}
    progress={30}
    startedAt={Date.now() - startedAgoMs}
    repoName="payments"
    branch="main"
  />
)

test("names the stage, the files and the usual time", () => {
  render(panel())

  expect(screen.getByRole("status")).toHaveTextContent(
    "Reading 1,240 Java files",
  )
  expect(screen.getByText("payments on main")).toBeInTheDocument()
  expect(screen.getByText("120 of 1,240 read · 30%")).toBeInTheDocument()
  expect(screen.getByText(/Usually about 2 min/)).toBeInTheDocument()
  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "30")
})

test("shows a line from the stage's pool and rotates it without repeating", () => {
  render(panel())
  const first = screen.getByTestId("scan-panel-line").textContent

  act(() => {
    vi.advanceTimersByTime(LINE_ROTATE_MS)
  })
  const second = screen.getByTestId("scan-panel-line").textContent
  expect(second).not.toBe(first)
})

test("a stage change swaps the line to the new stage's pool at once", () => {
  const { rerender } = render(
    panel({ stage: "cloning", files_done: null, files_total: null }),
  )
  rerender(
    <ScanProgressPanel
      kind="scan"
      status={status({
        stage: "finishing",
        files_done: null,
        files_total: null,
      })}
      progress={98}
      startedAt={Date.now() - 10_000}
      branch="main"
      random={() => 0}
    />,
  )
  expect(screen.getByRole("status")).toHaveTextContent("Almost there")
  expect(STAGE_LINES.finishing).toContain(
    screen.getByTestId("scan-panel-line").textContent,
  )
})

test("a scan well past its usual time says so, kindly", () => {
  render(panel({ stage: "predicting_risk" }, 5 * 60_000))

  expect(screen.getByTestId("scan-progress-panel")).toHaveAttribute(
    "data-slow",
    "true",
  )
  expect(SLOW_LINES).toContain(
    screen.getByTestId("scan-panel-line").textContent,
  )
})

test("a queued scan waits with an indeterminate bar", () => {
  render(panel({ phase: "queued", stage: null, progress: 0 }))
  expect(screen.getByRole("status")).toHaveTextContent(
    "Waiting for a free scan slot",
  )
})

test("after the scan, the score calculation gets its own panel", () => {
  render(<ScanProgressPanel kind="calculating" />)

  expect(screen.getByRole("status")).toHaveTextContent(
    "Calculating your health score",
  )
  expect(STAGE_LINES.calculating).toContain(
    screen.getByTestId("scan-panel-line").textContent,
  )
})

test("the score's wait carries on the same bar and clock", () => {
  render(
    <ScanProgressPanel
      kind="calculating"
      progress={93}
      startedAt={Date.now() - 125_000}
      repoName="payments"
      branch="main"
    />,
  )

  expect(screen.getByRole("status")).toHaveTextContent(
    "Calculating your health score",
  )
  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "93")
  expect(screen.getByText("2m 5s")).toBeInTheDocument()
  expect(screen.getByText("93%")).toBeInTheDocument()
})

test("a slow score says so kindly instead of failing", () => {
  render(<ScanProgressPanel kind="calculating" progress={97} slow />)

  expect(screen.getByTestId("scan-progress-panel")).toHaveAttribute(
    "data-slow",
    "true",
  )
  expect(SLOW_SCORE_LINES).toContain(
    screen.getByTestId("scan-panel-line").textContent,
  )
})

test("lines stay up for fifteen seconds", () => {
  render(panel())
  const first = screen.getByTestId("scan-panel-line").textContent
  act(() => {
    vi.advanceTimersByTime(14_000)
  })
  expect(screen.getByTestId("scan-panel-line").textContent).toBe(first)
})
