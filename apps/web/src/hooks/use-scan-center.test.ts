import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

import {
  discoverScan,
  onScanEvent,
  POLL_MS,
  resetScanCenter,
  resumeScans,
  scanKey,
  startScan,
  stopScan,
  useScanFor,
  type ScanEvent,
} from "./use-scan-center"
import { noteActiveWorkspace } from "./use-workspace-scope"
import { startScan as apiStartScan } from "@/lib/api/client"
import {
  DEMO_REPO_ID,
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

  await polls(8) // 6 polls × 17% crosses 100%

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

  await polls(8)
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
  await polls(3)

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
