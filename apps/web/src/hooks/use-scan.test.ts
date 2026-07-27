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

test("stop cancels a running scan and returns to idle", async () => {
  const { result } = renderHook(() => useScan("demo-repo"))

  await act(async () => {
    await result.current.scan("main")
  })
  expect(result.current.status.phase).toBe("running")

  await act(async () => {
    await result.current.stop()
  })

  expect(result.current.status.phase).toBe("idle")
  expect(result.current.status.progress).toBe(0)
})
