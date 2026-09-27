import { act, renderHook } from "@testing-library/react"
import { http, HttpResponse } from "msw"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

import { ACTIVITY_STALE_EVENT } from "@/lib/api/client"
import { server } from "@/lib/mocks/server"
import type { Activity } from "@/lib/types"
import {
  ACTIVITY_BUSY_MS,
  ACTIVITY_IDLE_MS,
  resetActivity,
  useActivity,
} from "./use-activity"
import { invalidateWorkspaceScope } from "./use-workspace-scope"

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  resetActivity()
  vi.useRealTimers()
})

const QUIET: Activity = { scans: [], rescoring: [] }
const BUSY: Activity = {
  scans: [],
  rescoring: [{ repo_id: "r", repo_name: "acme/r", snapshots_left: 2 }],
}

/** Answer `GET /api/activity` with `answer()`, counting the asks. */
function serve(answer: () => Activity) {
  const asked = { count: 0 }
  server.use(
    http.get("*/api/activity", () => {
      asked.count += 1
      return HttpResponse.json(answer())
    }),
  )
  return asked
}

const flush = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
const wait = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })

test("asks once on mount, then often while busy and rarely while quiet", async () => {
  let answer = BUSY
  const asked = serve(() => answer)
  const { result } = renderHook(() => useActivity())
  await flush()
  expect(asked.count).toBe(1)
  expect(result.current).toEqual(BUSY)

  await wait(ACTIVITY_BUSY_MS)
  expect(asked.count).toBe(2)

  answer = QUIET
  await wait(ACTIVITY_BUSY_MS)
  expect(asked.count).toBe(3)
  expect(result.current).toEqual(QUIET)

  // Quiet: the next ask is a long way off.
  await wait(ACTIVITY_BUSY_MS)
  expect(asked.count).toBe(3)
  await wait(ACTIVITY_IDLE_MS)
  expect(asked.count).toBe(4)
})

test("nobody listening, nobody asking", async () => {
  const asked = serve(() => BUSY)
  const { unmount } = renderHook(() => useActivity())
  await flush()
  unmount()
  await wait(ACTIVITY_IDLE_MS * 3)
  expect(asked.count).toBe(1)
})

test("a profile change asks at once rather than at the next poll", async () => {
  let answer = QUIET
  const asked = serve(() => answer)
  const { result } = renderHook(() => useActivity())
  await flush()
  expect(asked.count).toBe(1)

  answer = BUSY
  act(() => {
    window.dispatchEvent(new Event(ACTIVITY_STALE_EVENT))
  })
  await flush()
  expect(asked.count).toBe(2)
  expect(result.current).toEqual(BUSY)
})

test("an answer about the workspace just left is never shown", async () => {
  const asked = serve(() => BUSY)
  const { result } = renderHook(() => useActivity())
  await flush()
  expect(result.current).toEqual(BUSY)

  act(() => invalidateWorkspaceScope())
  // Until the new workspace answers, there is nothing to show.
  expect(result.current).toBeUndefined()
  await flush()
  expect(asked.count).toBeGreaterThanOrEqual(2)
  expect(result.current).toEqual(BUSY)
})

test("a failed ask keeps the last answer", async () => {
  let fail = false
  server.use(
    http.get("*/api/activity", () =>
      fail
        ? HttpResponse.json(
            { detail: "x", code: "INTERNAL_ERROR" },
            { status: 500 },
          )
        : HttpResponse.json(BUSY),
    ),
  )
  const { result } = renderHook(() => useActivity())
  await flush()
  fail = true
  await wait(ACTIVITY_BUSY_MS)
  expect(result.current).toEqual(BUSY)
})
