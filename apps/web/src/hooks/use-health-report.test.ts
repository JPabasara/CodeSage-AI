import { act, renderHook, waitFor } from "@testing-library/react"
import { http, HttpResponse } from "msw"
import { expect, test, vi } from "vitest"

import {
  SCORE_POLL_MS,
  SCORE_TIMEOUT_MS,
  useHealthReport,
} from "./use-health-report"
import { DEMO_REPO_ID, mockHealthReport } from "@/lib/mocks/fixtures"
import { server } from "@/lib/mocks/server"

// Proves the data path end-to-end: hook → client → MSW handler. No fixture is
// imported for the happy path — the data arrives over (mocked) fetch, exactly as
// it will from the real backend.

// ── helpers for the SCORE_PENDING tests ─────────────────────────────────────

/** The contract's 503 while a snapshot is being scored. */
const scorePending = () =>
  HttpResponse.json(
    {
      detail:
        "The dashboard score is still being prepared. Please try again shortly.",
      code: "SCORE_PENDING",
    },
    { status: 503 },
  )

/**
 * Wait for a condition while `vi.useFakeTimers()` is in force.
 *
 * Testing Library's own `waitFor` cannot be used here: it decides whether to
 * drive the clock by looking for a `jest` global, finds none under Vitest, and
 * so polls with a real `setInterval` that fake timers have frozen — it would
 * hang rather than fail. This advances the clock we control instead.
 */
async function advanceUntil(
  predicate: () => boolean,
  { step = SCORE_POLL_MS, limit = 60 } = {},
) {
  for (let i = 0; i <= limit; i += 1) {
    if (predicate()) return
    await act(async () => {
      await vi.advanceTimersByTimeAsync(step)
    })
  }
  throw new Error(`condition not reached within ${limit} steps`)
}

/** Fake timers for the body, real ones restored however it ends. */
async function withFakeTimers(body: () => Promise<void>) {
  vi.useFakeTimers()
  try {
    await body()
  } finally {
    vi.useRealTimers()
  }
}

// ── the happy path ──────────────────────────────────────────────────────────

test("starts loading, then resolves the report for the branch", async () => {
  const { result } = renderHook(() => useHealthReport(DEMO_REPO_ID, "main"))

  expect(result.current.loading).toBe(true)
  expect(result.current.data).toBeUndefined()

  await waitFor(() => expect(result.current.loading).toBe(false))

  expect(result.current.error).toBeUndefined()
  expect(result.current.pending).toBe(false)
  expect(result.current.data?.health_score).toBe(72)
  expect(result.current.data?.grade).toBe("B")
})

test("refetches when the branch changes", async () => {
  const { result, rerender } = renderHook(
    ({ branch }: { branch: string }) => useHealthReport(DEMO_REPO_ID, branch),
    { initialProps: { branch: "main" } },
  )

  await waitFor(() => expect(result.current.data?.health_score).toBe(72))

  rerender({ branch: "develop" })

  // stale data is cleared immediately, then the new branch resolves
  expect(result.current.loading).toBe(true)
  await waitFor(() => expect(result.current.data?.health_score).toBe(66))
})

test("passes snapshot_id and refetches when the snapshot changes", async () => {
  const seen: Array<string | null> = []
  server.use(
    http.get("*/api/repos/:repoId/health", ({ request }) => {
      seen.push(new URL(request.url).searchParams.get("snapshot_id"))
      return HttpResponse.json(mockHealthReport)
    }),
  )

  const { result, rerender } = renderHook(
    ({ snapshotId }: { snapshotId?: string }) =>
      useHealthReport(DEMO_REPO_ID, "main", snapshotId),
    { initialProps: { snapshotId: "old-snapshot" } },
  )

  await waitFor(() => expect(result.current.loading).toBe(false))
  rerender({ snapshotId: "new-snapshot" })
  await waitFor(() => expect(seen).toContain("new-snapshot"))

  expect(seen).toContain("old-snapshot")
})

test("surfaces an error for an unknown repo instead of throwing", async () => {
  const { result } = renderHook(() =>
    useHealthReport("11111111-2222-3333-4444-555555555555", "main"),
  )

  await waitFor(() => expect(result.current.loading).toBe(false))

  expect(result.current.error).toBeInstanceOf(Error)
  expect(result.current.data).toBeUndefined()
})

// ── SCORE_PENDING (#109) ────────────────────────────────────────────────────
//
// The API stores a snapshot first and scores it in a background task, so a read
// taken straight after a scan answers 503 SCORE_PENDING. That is not a failure
// and must never render as one; the hook waits it out, and gives up eventually
// so a dead worker cannot leave the screen spinning forever.

test("pending → ready: waits out SCORE_PENDING and resolves with no help", async () => {
  await withFakeTimers(async () => {
    let asks = 0
    server.use(
      http.get("*/api/repos/:repoId/health", () => {
        asks += 1
        return asks <= 2 ? scorePending() : HttpResponse.json(mockHealthReport)
      }),
    )

    const { result } = renderHook(() => useHealthReport(DEMO_REPO_ID, "main"))

    // A pending score is its own state: not an error, and not "still loading".
    await advanceUntil(() => result.current.pending)
    expect(result.current.error).toBeUndefined()
    expect(result.current.loading).toBe(false)
    expect(result.current.data).toBeUndefined()

    // No reload(), no remount — the hook gets there by itself.
    await advanceUntil(() => result.current.data !== undefined)
    expect(result.current.data?.health_score).toBe(
      mockHealthReport.health_score,
    )
    expect(result.current.pending).toBe(false)
    expect(result.current.error).toBeUndefined()
    expect(asks).toBe(3)
  })
})

test("pending → give-up: a score that never arrives becomes an error, not a spinner", async () => {
  await withFakeTimers(async () => {
    let asks = 0
    server.use(
      http.get("*/api/repos/:repoId/health", () => {
        asks += 1
        return scorePending()
      }),
    )

    const { result } = renderHook(() => useHealthReport(DEMO_REPO_ID, "main"))

    await advanceUntil(() => result.current.pending)

    // Past the stated deadline it stops asking and says so.
    await advanceUntil(() => result.current.error !== undefined, {
      limit: SCORE_TIMEOUT_MS / SCORE_POLL_MS + 5,
    })

    expect(result.current.pending).toBe(false)
    expect(result.current.error?.message).toMatch(/taking longer than usual/i)

    // …and having given up, it really has: no further requests.
    const asksAtGiveUp = asks
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SCORE_POLL_MS * 5)
    })
    expect(asks).toBe(asksAtGiveUp)
  })
})

test("a genuine 500 is an error, not a pending score, and Retry re-runs the read", async () => {
  let asks = 0
  let broken = true
  server.use(
    http.get("*/api/repos/:repoId/health", () => {
      asks += 1
      return broken
        ? HttpResponse.json(
            { detail: "Something broke.", code: "INTERNAL_ERROR" },
            { status: 500 },
          )
        : HttpResponse.json(mockHealthReport)
    }),
  )

  const { result } = renderHook(() => useHealthReport(DEMO_REPO_ID, "main"))

  await waitFor(() => expect(result.current.error).toBeDefined())
  expect(result.current.pending).toBe(false)
  // One ask, and no retry loop: a 500 is not something waiting fixes.
  expect(asks).toBe(1)

  broken = false
  act(() => result.current.refetch())

  // Retry blanks the stale error rather than leaving it on screen…
  expect(result.current.loading).toBe(true)
  expect(result.current.error).toBeUndefined()

  // …and resolves.
  await waitFor(() => expect(result.current.data).toBeDefined())
  expect(result.current.error).toBeUndefined()
})

test("unmounting stops the polling", async () => {
  await withFakeTimers(async () => {
    let asks = 0
    server.use(
      http.get("*/api/repos/:repoId/health", () => {
        asks += 1
        return scorePending()
      }),
    )

    const { result, unmount } = renderHook(() =>
      useHealthReport(DEMO_REPO_ID, "main"),
    )
    await advanceUntil(() => result.current.pending)

    unmount()
    const asksAtUnmount = asks

    // Navigating away mid-score must not leave a timer asking forever.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SCORE_POLL_MS * 10)
    })
    expect(asks).toBe(asksAtUnmount)
  })
})

// ── the dashboard cache (13H.3) ─────────────────────────────────────────────

test("coming back renders the cached report with no skeleton", async () => {
  const first = renderHook(() => useHealthReport(DEMO_REPO_ID, "main"))
  await waitFor(() => expect(first.result.current.data?.health_score).toBe(72))
  const shown = first.result.current.data
  first.unmount()

  const second = renderHook(() => useHealthReport(DEMO_REPO_ID, "main"))
  expect(second.result.current.loading).toBe(false)
  expect(second.result.current.data?.health_score).toBe(72)

  // The quiet revalidation returns the same report: the same object stays.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
  expect(second.result.current.data).toBe(shown)
})

test("a scan finishing on the branch clears its cached report", async () => {
  const { forgetScanResults } = await import("@/lib/query-cache")
  const first = renderHook(() => useHealthReport(DEMO_REPO_ID, "main"))
  await waitFor(() => expect(first.result.current.loading).toBe(false))
  first.unmount()

  forgetScanResults(DEMO_REPO_ID, "main")

  const second = renderHook(() => useHealthReport(DEMO_REPO_ID, "main"))
  expect(second.result.current.loading).toBe(true)
  await waitFor(() => expect(second.result.current.data?.health_score).toBe(72))
})

test("a profile write clears the cached report", async () => {
  const { setDefaultProfile, getProfiles } = await import("@/lib/api/client")
  const first = renderHook(() => useHealthReport(DEMO_REPO_ID, "main"))
  await waitFor(() => expect(first.result.current.loading).toBe(false))
  first.unmount()

  const [profile] = await getProfiles()
  await setDefaultProfile(profile!.id)

  const second = renderHook(() => useHealthReport(DEMO_REPO_ID, "main"))
  expect(second.result.current.loading).toBe(true)
})

test("two dashboards on the same branch send one request", async () => {
  let calls = 0
  const count = ({ request }: { request: Request }) => {
    if (new URL(request.url).pathname.endsWith("/health")) calls += 1
  }
  server.events.on("request:start", count)
  try {
    const a = renderHook(() => useHealthReport(DEMO_REPO_ID, "main"))
    const b = renderHook(() => useHealthReport(DEMO_REPO_ID, "main"))
    await waitFor(() => expect(a.result.current.data).toBeDefined())
    await waitFor(() => expect(b.result.current.data).toBeDefined())
  } finally {
    server.events.removeListener("request:start", count)
  }
  expect(calls).toBe(1)
})
