import { act, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

import { LINE_ROTATE_MS } from "@/hooks/use-rotating-line"
import { LIVE_TICK_MS } from "@/hooks/use-scan-center"
import { SLOW_LINES, SLOW_SCORE_LINES, STAGE_LINES } from "@/lib/scan-messages"
import { ScanProgressPanel } from "./scan-progress-panel"

// A scan's own progress is ScanProgressCard (scan-progress-card.test.tsx).

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-09-26T10:00:00Z"))
})
afterEach(() => vi.useRealTimers())

const tick = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })

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
