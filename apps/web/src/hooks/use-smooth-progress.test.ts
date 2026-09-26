import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

import { SCAN_SHARE, toBar } from "@/lib/scan-progress"
import type { ScanStatus } from "@/lib/types"
import { SMOOTH_TICK_MS, useSmoothProgress } from "./use-smooth-progress"

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

const running = (patch: Partial<ScanStatus>): ScanStatus => ({
  scan_id: "s1",
  phase: "running",
  progress: 5,
  stage: "cloning",
  ...patch,
})

const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms)
  })

test("creeps inside the stage but never enters the next band", () => {
  const { result } = renderHook(() => useSmoothProgress(running({})))
  advance(10 * 60_000)
  expect(result.current).toBeGreaterThan(toBar(5))
  expect(result.current).toBeLessThan(toBar(25))
})

test("only moves forward, and glides when a new stage arrives", () => {
  const { result, rerender } = renderHook(
    ({ status }: { status: ScanStatus }) => useSmoothProgress(status),
    { initialProps: { status: running({}) } },
  )
  const seen: number[] = []
  for (let i = 0; i < 20; i += 1) {
    advance(SMOOTH_TICK_MS)
    seen.push(result.current!)
  }

  rerender({ status: running({ stage: "reading_code", progress: 25 }) })
  advance(SMOOTH_TICK_MS)
  const firstStep = result.current!
  // A glide, not a jump: one tick later it is on its way, not there.
  expect(firstStep).toBeLessThan(toBar(25))
  for (let i = 0; i < 30; i += 1) {
    advance(SMOOTH_TICK_MS)
    seen.push(result.current!)
  }
  expect(result.current).toBeGreaterThanOrEqual(toBar(25))

  for (let i = 1; i < seen.length; i += 1) {
    expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]!)
  }
})

test("a queued scan has no number to show", () => {
  const { result } = renderHook(() =>
    useSmoothProgress({ scan_id: "s1", phase: "queued", progress: 0 }),
  )
  expect(result.current).toBeUndefined()
})

test("under reduced motion the bar steps from stage to stage", () => {
  const matchMedia = vi
    .spyOn(window, "matchMedia")
    .mockImplementation(
      (query: string) =>
        ({ matches: query.includes("reduce") }) as MediaQueryList,
    )
  try {
    const { result, rerender } = renderHook(
      ({ status }: { status: ScanStatus }) => useSmoothProgress(status),
      { initialProps: { status: running({}) } },
    )
    advance(5_000)
    expect(result.current).toBe(toBar(5)) // no creep

    rerender({ status: running({ stage: "reading_code", progress: 25 }) })
    advance(SMOOTH_TICK_MS)
    expect(result.current).toBe(toBar(25)) // one step, no glide
  } finally {
    matchMedia.mockRestore()
  }
})

test("after the scan, the same bar carries on through the score's section", () => {
  const { result, rerender } = renderHook(
    ({ status, scoring }: { status?: ScanStatus; scoring: boolean }) =>
      useSmoothProgress(status, scoring),
    {
      initialProps: {
        status: running({ stage: "finishing", progress: 97 }),
        scoring: false,
      } as { status?: ScanStatus; scoring: boolean },
    },
  )
  advance(5_000)
  const endOfScan = result.current!
  expect(endOfScan).toBeLessThanOrEqual(SCAN_SHARE)

  // The scan is done and forgotten; the score is being calculated.
  rerender({ status: undefined, scoring: true })
  const seen: number[] = [endOfScan]
  for (let i = 0; i < 300; i += 1) {
    advance(SMOOTH_TICK_MS)
    seen.push(result.current!)
  }
  expect(result.current).toBeGreaterThan(SCAN_SHARE)
  expect(result.current).toBeLessThan(100)
  for (let i = 1; i < seen.length; i += 1) {
    expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]!)
  }
})
