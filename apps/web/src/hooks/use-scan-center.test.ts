import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

import {
  acknowledgeScan,
  discoverScan,
  LIVE_TICK_MS,
  onScanEvent,
  pinScanResults,
  POLL_MS,
  resetScanCenter,
  resumeScans,
  scanKey,
  startScan,
  stopScan,
  useScanFor,
  useScanLive,
  type ScanEvent,
} from "./use-scan-center"
import {
  healthKey,
  SCORE_POLL_MS,
  SCORE_SLOW_MS,
  SCORE_TIMEOUT_MS,
} from "./use-health-report"
import { readWorkspaceEpoch } from "./use-workspace-scope"
import { readCached, writeCached } from "@/lib/query-cache"
import { SCAN_SHARE } from "@/lib/scan-progress"
import { STAGE_LINES } from "@/lib/scan-messages"
import { noteActiveWorkspace } from "./use-workspace-scope"
import { http, HttpResponse } from "msw"

import { startScan as apiStartScan } from "@/lib/api/client"
import { server } from "@/lib/mocks/server"
import type { ScanStatus } from "@/lib/types"
import {
  DEMO_REPO_ID,
  mockHealthReport,
  SECOND_WORKSPACE_ID,
  WORKSPACE_ID,
} from "@/lib/mocks/fixtures"

// Timer-driven (one poll per POLL_MS), so FAKE timers keep it deterministic;
// assertions follow advanceTimersByTimeAsync rather than waitFor, which polls on
// real timers that never move while these are faked.
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

const target = {
  workspaceId: WORKSPACE_ID,
  repoId: DEMO_REPO_ID,
  branch: "main",
  repoName: "acme-payments",
}
const key = scanKey(WORKSPACE_ID, DEMO_REPO_ID, "main")

function recordEvents() {
  const events: ScanEvent["type"][] = []
  onScanEvent((event) => events.push(event.type))
  return events
}

const polls = (n: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(POLL_MS * n)
  })

/** Past the scan AND its score: the mock scores for two asks, 2 s apart. */
const untilJobEnds = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(POLL_MS * 8 + SCORE_POLL_MS * 4)
  })

test("Scan is acknowledged at once: queued before the request answers", async () => {
  const { result } = renderHook(() => useScanFor(DEMO_REPO_ID, "main"))
  const events = recordEvents()

  let pending!: Promise<void>
  act(() => {
    pending = startScan(target)
  })
  // Synchronously, before the POST has returned.
  expect(result.current.scan?.status.phase).toBe("queued")
  expect(events).toEqual(["queued"])

  await act(async () => {
    await pending
  })
  expect(result.current.scan?.status.phase).toBe("running")
})

test("polls to done, reports finished once, then lets go", async () => {
  const { result } = renderHook(() => useScanFor(DEMO_REPO_ID, "main"))
  const events = recordEvents()
  await act(() => startScan(target))

  await untilJobEnds() // the scan, then its score

  expect(events.filter((e) => e === "finished")).toHaveLength(1)
  expect(result.current.scan).toBeUndefined()
})

test("THE BUG: leaving the page mid-scan and coming back still shows it", async () => {
  const first = renderHook(() => useScanFor(DEMO_REPO_ID, "main"))
  await act(() => startScan(target))
  await polls(2)
  first.unmount() // navigated away: the dashboard is gone

  await polls(1) // …and the scan carries on without it

  const again = renderHook(() => useScanFor(DEMO_REPO_ID, "main"))
  expect(again.result.current.scan?.status.phase).toBe("running")
  expect(again.result.current.scan?.status.progress).toBeGreaterThan(17)
})

test("a refresh resumes the scans this tab was following", async () => {
  await act(() => startScan(target))
  await polls(1)
  const saved = sessionStorage.getItem("codesage.activeScans.v1")
  expect(saved).toContain(DEMO_REPO_ID)

  // A reload: memory is gone, the tab's storage is not.
  resetScanCenter()
  sessionStorage.setItem("codesage.activeScans.v1", saved!)
  const events = recordEvents()
  const { result } = renderHook(() => useScanFor(DEMO_REPO_ID, "main"))
  act(() => resumeScans(WORKSPACE_ID))
  expect(result.current.scan).toBeDefined()

  await untilJobEnds()
  expect(events).toContain("finished")
})

test("stop only requests cancellation; the next poll reports cancelled", async () => {
  const { result } = renderHook(() => useScanFor(DEMO_REPO_ID, "main"))
  const events = recordEvents()
  await act(() => startScan(target))

  await act(() => stopScan(key))
  // Cooperative: still running, and marked as stopping.
  expect(result.current.scan?.status.phase).toBe("running")
  expect(result.current.scan?.stopping).toBe(true)

  await polls(1)
  expect(events).toContain("cancelled")
  expect(result.current.scan).toBeUndefined()
})

test("Stop pressed during finalization is too late: the scan still completes", async () => {
  const events = recordEvents()
  await act(() => startScan(target))
  await polls(5) // past the finalize threshold

  await act(() => stopScan(key))
  await untilJobEnds()

  expect(events).toContain("finished")
  expect(events).not.toContain("cancelled")
})

test("Scan on a branch already scanning joins that scan instead of failing", async () => {
  const running = await apiStartScan(DEMO_REPO_ID, "main") // someone else's
  const events = recordEvents()
  const { result } = renderHook(() => useScanFor(DEMO_REPO_ID, "main"))

  await act(() => startScan(target))

  expect(events).toEqual(["queued", "attached"])
  expect(result.current.scan?.status.scan_id).toBe(running.scan_id)
})

test("a scan this tab never started is discovered and followed", async () => {
  const running = await apiStartScan(DEMO_REPO_ID, "main")
  const { result } = renderHook(() => useScanFor(DEMO_REPO_ID, "main"))

  await act(() => discoverScan(target))

  expect(result.current.scan?.status.scan_id).toBe(running.scan_id)
})

test("nothing running: discovery finds nothing and adds nothing", async () => {
  const { result } = renderHook(() => useScanFor(DEMO_REPO_ID, "main"))
  await act(() => discoverScan(target))
  expect(result.current.scan).toBeUndefined()
})

test("a start that fails says why and leaves nothing behind", async () => {
  const events = recordEvents()
  await act(() =>
    startScan({ ...target, repoId: "00000000-0000-4000-8000-000000000000" }),
  )
  expect(events).toEqual(["queued", "start-failed"])
})

test("in another workspace a scan waits, and resumes on the way back", async () => {
  const { result } = renderHook(() => useScanFor(DEMO_REPO_ID, "main"))
  await act(() => startScan(target))
  await polls(1)
  const progressBefore = result.current.scan!.status.progress

  act(() => noteActiveWorkspace(SECOND_WORKSPACE_ID))
  await polls(3)
  expect(result.current.scan).toBeUndefined() // not shown in the other one

  act(() => noteActiveWorkspace(WORKSPACE_ID))
  act(() => resumeScans(WORKSPACE_ID))
  await polls(1)
  expect(result.current.scan!.status.progress).toBeGreaterThan(progressBefore)
})

test("a scan ended by a guardrail fails with its plain sentence (13H.1)", async () => {
  const reasons: string[] = []
  onScanEvent((event) => {
    if (event.type === "failed") reasons.push(event.reason)
  })
  await act(() => startScan(target))

  // The worker found no Java on this branch: a clean ending, with a code.
  server.use(
    http.get("*/api/repos/:repoId/scan/:scanId", ({ params }) =>
      HttpResponse.json({
        scan_id: params.scanId as string,
        phase: "error",
        progress: 0,
        branch: "main",
        error: "No Java files on this branch.",
        error_code: "NO_JAVA_FILES",
      } satisfies ScanStatus),
    ),
  )
  await polls(1)

  expect(reasons).toEqual([
    "No Java files on this branch. CodeSage reads Java for now; more languages are coming soon.",
  ])
})

test("a full workspace queue refuses the start with the server's sentence", async () => {
  const sentence =
    "5 scans are already waiting in this workspace. Try again when one finishes."
  server.use(
    http.post("*/api/repos/:repoId/scan", () =>
      HttpResponse.json(
        { detail: sentence, code: "SCAN_QUEUE_FULL" },
        { status: 429 },
      ),
    ),
  )
  const reasons: string[] = []
  const stop = onScanEvent((event) => {
    if (event.type === "start-failed") reasons.push(event.reason)
  })
  const { result } = renderHook(() => useScanFor(DEMO_REPO_ID, "main"))

  await act(() => startScan(target))
  stop()

  expect(reasons).toEqual([sentence])
  // Nothing is left looking queued: the scan was never accepted.
  expect(result.current.scan).toBeUndefined()
})

// ── the whole job: scanning → scoring → ready ───────────────────────────────

/** The report the dashboard was showing before the scan, as the cache holds it. */
function cacheShownReport(snapshotId = "snapshot-before-the-scan") {
  const report = { ...mockHealthReport, snapshot_id: snapshotId }
  writeCached(healthKey(readWorkspaceEpoch(), DEMO_REPO_ID, "main"), report)
  return report
}

test("finished waits for the score, and carries the new report", async () => {
  const finished: ScanEvent[] = []
  onScanEvent((event) => {
    if (event.type === "finished") finished.push(event)
  })
  const { result } = renderHook(() => useScanFor(DEMO_REPO_ID, "main"))
  await act(() => startScan(target))

  // The scan is done; the job is not: the score is still being calculated.
  await polls(8)
  expect(result.current.scan?.job).toBe("scoring")
  expect(finished).toHaveLength(0)

  await act(async () => {
    await vi.advanceTimersByTimeAsync(SCORE_POLL_MS * 4)
  })
  expect(finished).toHaveLength(1)
  const event = finished[0] as Extract<ScanEvent, { type: "finished" }>
  expect(event.report?.health_score).toEqual(expect.any(Number))
  expect(event.scan.health?.grade).toBe(event.report?.grade)
})

test("with results on screen, the job waits at 'ready' until the user looks", async () => {
  const shown = cacheShownReport()
  const { result } = renderHook(() => useScanFor(DEMO_REPO_ID, "main"))
  await act(() => startScan(target))
  await untilJobEnds()

  // The old results are still one read away, under their own id…
  expect(result.current.scan?.job).toBe("ready")
  expect(result.current.scan?.pinnedSnapshotId).toBe(shown.snapshot_id)
  expect(
    readCached(
      healthKey(readWorkspaceEpoch(), DEMO_REPO_ID, "main", shown.snapshot_id),
    )?.data,
  ).toEqual(shown)
  // …and the new ones are already in the cache as "latest".
  const latest = readCached<typeof shown>(
    healthKey(readWorkspaceEpoch(), DEMO_REPO_ID, "main"),
  )?.data
  expect(latest?.snapshot_id).not.toBe(shown.snapshot_id)

  // "Show them": the job is over.
  act(() => acknowledgeScan(key))
  expect(result.current.scan).toBeUndefined()
})

test("a first scan has nothing to keep on screen, so it ends at ready by itself", async () => {
  const { result } = renderHook(() => useScanFor(DEMO_REPO_ID, "main"))
  await act(() => startScan(target))
  await untilJobEnds()
  expect(result.current.scan).toBeUndefined()
})

test("the dashboard can pin what it shows, even if the cache is emptied", async () => {
  const { result } = renderHook(() => useScanFor(DEMO_REPO_ID, "main"))
  await act(() => startScan(target))
  const shown = { ...mockHealthReport, snapshot_id: "pinned-by-the-page" }
  act(() => pinScanResults(key, shown))
  expect(result.current.scan?.pinnedSnapshotId).toBe("pinned-by-the-page")

  await untilJobEnds()
  expect(result.current.scan?.job).toBe("ready")
  expect(
    readCached(
      healthKey(readWorkspaceEpoch(), DEMO_REPO_ID, "main", shown.snapshot_id),
    )?.data,
  ).toEqual(shown)
})

test("nothing new on the branch: 'up to date', and no job at all", async () => {
  await act(() => startScan(target))
  await untilJobEnds() // one real scan, so the head commit is now scanned

  const events = recordEvents()
  const { result } = renderHook(() => useScanFor(DEMO_REPO_ID, "main"))
  await act(() => startScan(target))

  expect(events).toEqual(["queued", "up-to-date"])
  expect(result.current.scan).toBeUndefined()
})

test("a slow score says so, and a score that never comes still ends the job", async () => {
  server.use(
    http.get("*/api/repos/:repoId/health", () =>
      HttpResponse.json(
        { detail: "Still scoring.", code: "SCORE_PENDING" },
        { status: 503 },
      ),
    ),
  )
  const finished: ScanEvent[] = []
  onScanEvent((event) => {
    if (event.type === "finished") finished.push(event)
  })
  const { result } = renderHook(() => useScanFor(DEMO_REPO_ID, "main"))
  await act(() => startScan(target))
  await polls(8)
  expect(result.current.scan?.job).toBe("scoring")

  await act(async () => {
    await vi.advanceTimersByTimeAsync(SCORE_SLOW_MS + SCORE_POLL_MS)
  })
  expect(result.current.scan?.scoreSlow).toBe(true)
  expect(finished).toHaveLength(0)

  await act(async () => {
    await vi.advanceTimersByTimeAsync(SCORE_TIMEOUT_MS)
  })
  expect(finished).toHaveLength(1)
  expect((finished[0] as { report?: unknown }).report).toBeUndefined()
  expect(result.current.scan).toBeUndefined()
})

// ── the shared bar and line ─────────────────────────────────────────────────

test("the bar lives in the store: leaving and coming back keeps it, forward only", async () => {
  await act(() => startScan(target))
  const first = renderHook(() => useScanLive(key))
  const seen: number[] = []
  for (let i = 0; i < 20; i += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LIVE_TICK_MS)
    })
    if (first.result.current?.bar !== undefined)
      seen.push(first.result.current.bar)
  }
  const left = first.result.current
  first.unmount() // navigated away

  // Coming back picks up exactly where it was: same bar, same line — no
  // restart from zero, no fresh random pick.
  const back = renderHook(() => useScanLive(key))
  expect(back.result.current?.bar).toBe(left?.bar)
  expect(back.result.current?.line).toBe(left?.line)
  back.unmount()

  // Away for a while: the job kept going without any page.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(LIVE_TICK_MS * 5)
  })
  const again = renderHook(() => useScanLive(key))
  expect(again.result.current?.bar).toBeGreaterThanOrEqual(seen.at(-1)!)

  for (let i = 0; i < 40; i += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LIVE_TICK_MS)
    })
    seen.push(again.result.current?.bar ?? 0)
  }
  for (let i = 1; i < seen.length; i += 1) {
    expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]!)
  }
})

test("the bar carries on through the score's section of the same bar", async () => {
  await act(() => startScan(target))
  const { result } = renderHook(() => useScanLive(key))
  await polls(8) // scan done: scoring
  await act(async () => {
    await vi.advanceTimersByTimeAsync(LIVE_TICK_MS * 10)
  })
  expect(result.current?.bar).toBeGreaterThan(SCAN_SHARE - 1)
  expect(result.current?.bar).toBeLessThan(100)
})

test("a new stage swaps the line at once; otherwise it holds for 15 seconds", async () => {
  await act(() => startScan(target))
  const { result } = renderHook(() => useScanLive(key))
  await act(async () => {
    await vi.advanceTimersByTimeAsync(LIVE_TICK_MS)
  })
  const first = result.current?.line
  const firstPool = result.current?.poolKey
  expect(first).toBeTruthy()

  // Within one stage and under 15 s the line holds.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(POLL_MS - LIVE_TICK_MS * 2)
  })
  if (result.current?.poolKey === firstPool) {
    expect(result.current?.line).toBe(first)
  }

  // Scoring: a different pool, so a different kind of line, at once.
  await polls(8)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(LIVE_TICK_MS)
  })
  expect(result.current?.poolKey).toBe("calculating:false")
  expect(STAGE_LINES.calculating).toContain(result.current?.line)
})
