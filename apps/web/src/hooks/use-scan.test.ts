import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

import { useScan } from "./use-scan"

// The scan is timer-driven (poll every 600ms), so drive it with FAKE timers for
// determinism. The MSW Node server + resetMockBackend() already run in
// src/test/setup.ts, so every test starts from a clean idle scan.
//
// We assert directly after advanceTimersByTimeAsync rather than using waitFor:
// waitFor polls on real timers, which never advance while timers are faked.
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

test("start → polls until done, then calls onComplete once", async () => {
  const onComplete = vi.fn()
  const { result } = renderHook(() => useScan("demo-repo", onComplete))

  await act(async () => {
    await result.current.scan("main")
  })
  expect(result.current.status.phase).toBe("running")

  // 6 polls × 17% crosses 100% (→ done); advance a couple extra to be safe.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600 * 8)
  })

  expect(result.current.status.phase).toBe("done")
  expect(result.current.status.progress).toBe(100)
  expect(onComplete).toHaveBeenCalledTimes(1)
})

test("stop only REQUESTS cancellation - the scan is still running", async () => {
  const { result } = renderHook(() => useScan("demo-repo"))

  await act(async () => {
    await result.current.scan("main")
  })
  expect(result.current.status.phase).toBe("running")

  await act(async () => {
    await result.current.stop()
  })

  // Cancellation is cooperative: the POST sets a flag and returns 202 with the
  // phase unchanged. Asserting "idle" here would bake in the old wrong belief.
  expect(result.current.status.phase).toBe("running")
})

test("the next poll after stop reports cancelled, never idle or done", async () => {
  const { result } = renderHook(() => useScan("demo-repo"))

  await act(async () => {
    await result.current.scan("main")
  })
  await act(async () => {
    await result.current.stop()
  })

  await act(async () => {
    await vi.advanceTimersByTimeAsync(600 * 2)
  })

  expect(result.current.status.phase).toBe("cancelled")
})

test("polling stops once a scan is cancelled", async () => {
  const { result } = renderHook(() => useScan("demo-repo"))

  await act(async () => {
    await result.current.scan("main")
  })
  await act(async () => {
    await result.current.stop()
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600 * 2)
  })
  expect(result.current.status.phase).toBe("cancelled")

  // Assert the INTERVAL is gone, not just that the phase looks stable. The mock
  // echoes a non-running scan back unchanged, so a leaked timer would keep
  // polling forever while every phase assertion still passed.
  expect(vi.getTimerCount()).toBe(0)
})

test("stop pressed during finalize is too late - the scan still completes", async () => {
  const onComplete = vi.fn()
  const { result } = renderHook(() => useScan("demo-repo", onComplete))

  await act(async () => {
    await result.current.scan("main")
  })
  // Run it into the finalize window (progress 85), where the worker no longer
  // reads the cancel flag: a half-written snapshot would be indistinguishable
  // from a complete one (FR-6).
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600 * 5)
  })
  expect(result.current.status.progress).toBe(85)

  await act(async () => {
    await result.current.stop()
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600 * 3)
  })

  // Pressing Stop does NOT guarantee a cancellation. The scan finished, a real
  // snapshot exists, so the dashboard must refetch exactly as it would normally.
  expect(result.current.status.phase).toBe("done")
  expect(onComplete).toHaveBeenCalledTimes(1)
  expect(vi.getTimerCount()).toBe(0)
})

test("stopping is true only between the Stop press and the terminal phase", async () => {
  const { result } = renderHook(() => useScan("demo-repo"))

  await act(async () => {
    await result.current.scan("main")
  })
  expect(result.current.stopping).toBe(false)

  await act(async () => {
    await result.current.stop()
  })
  // Still "running" - this is the window the flag exists for.
  expect(result.current.status.phase).toBe("running")
  expect(result.current.stopping).toBe(true)

  await act(async () => {
    await vi.advanceTimersByTimeAsync(600 * 2)
  })
  expect(result.current.status.phase).toBe("cancelled")
  expect(result.current.stopping).toBe(false)
})

test("stopping is released when a too-late Stop ends in done", async () => {
  const { result } = renderHook(() => useScan("demo-repo"))

  await act(async () => {
    await result.current.scan("main")
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600 * 5)
  })
  await act(async () => {
    await result.current.stop()
  })
  expect(result.current.stopping).toBe(true)

  await act(async () => {
    await vi.advanceTimersByTimeAsync(600 * 3)
  })

  // The scan completed instead of cancelling, but the flag must still clear -
  // otherwise the next scan starts with a disabled Stop button.
  expect(result.current.status.phase).toBe("done")
  expect(result.current.stopping).toBe(false)
})
