"use client"

import { useCallback, useSyncExternalStore } from "react"

import {
  ApiRequestError,
  getActiveScan,
  getScanStatus,
  startScan as apiStartScan,
  stopScan as apiStopScan,
} from "@/lib/api/client"
import type { ScanStatus } from "@/lib/types"
import {
  readActiveWorkspaceId,
  useActiveWorkspaceId,
} from "./use-workspace-scope"

// Every scan the app is following, held ABOVE the pages.
//
// The scan used to live inside the dashboard: leave the page and the poll
// stopped, the scan id was forgotten, and coming back showed an idle Scan
// button while the worker was still busy — no progress, no way to Stop. Here a
// scan survives navigation (module state and timers outlive any page), a
// refresh (the ids are kept in this tab's sessionStorage) and, through
// `GET …/scan/active`, a scan this tab never started at all.

export const POLL_MS = 600
const STORAGE_KEY = "codesage.activeScans.v1"

export interface TrackedScan {
  key: string
  workspaceId: string
  repoId: string
  branch: string
  repoName?: string
  status: ScanStatus
  /** Stop has been requested; the worker stops at its next stage boundary. */
  stopping: boolean
  /** When it started, for the elapsed clock (server time when known). */
  startedAt: number
}

export type ScanEvent =
  | { type: "queued"; scan: TrackedScan }
  | { type: "attached"; scan: TrackedScan }
  | { type: "finished"; scan: TrackedScan }
  | { type: "cancelled"; scan: TrackedScan }
  | { type: "failed"; scan: TrackedScan; reason: string }
  | {
      type: "start-failed"
      target: ScanTarget
      reason: string
    }
  | { type: "stop-failed"; scan: TrackedScan }

export interface ScanTarget {
  workspaceId: string
  repoId: string
  branch: string
  repoName?: string
}

const scans = new Map<string, TrackedScan>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()
const listeners = new Set<() => void>()
const eventListeners = new Set<(event: ScanEvent) => void>()
let snapshot: TrackedScan[] = []

export const scanKey = (workspaceId: string, repoId: string, branch: string) =>
  `${workspaceId}:${repoId}:${branch}`

export const isActivePhase = (phase: ScanStatus["phase"]) =>
  phase === "queued" || phase === "running"

// ── store plumbing ──────────────────────────────────────────────────────────

function changed() {
  snapshot = [...scans.values()]
  persist()
  for (const listener of listeners) listener()
}

function emit(event: ScanEvent) {
  for (const listener of eventListeners) listener(event)
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Toasts, dashboard refreshes: anything that reacts to how a scan ended. */
export function onScanEvent(listener: (event: ScanEvent) => void) {
  eventListeners.add(listener)
  return () => {
    eventListeners.delete(listener)
  }
}

function storage(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage
  } catch {
    return null
  }
}

type Persisted = Omit<TrackedScan, "status" | "stopping"> & { scanId: string }

function persist() {
  const store = storage()
  if (!store) return
  const saved: Persisted[] = snapshot
    .filter((scan) => scan.status.scan_id)
    .map(
      ({ key, workspaceId, repoId, branch, repoName, startedAt, status }) => ({
        key,
        workspaceId,
        repoId,
        branch,
        repoName,
        startedAt,
        scanId: status.scan_id,
      }),
    )
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(saved))
  } catch {
    // Full or blocked: navigation still works, only a refresh forgets.
  }
}

function readPersisted(): Persisted[] {
  try {
    const parsed: unknown = JSON.parse(storage()?.getItem(STORAGE_KEY) ?? "[]")
    return Array.isArray(parsed) ? (parsed as Persisted[]) : []
  } catch {
    return []
  }
}

function startedAtOf(status: ScanStatus) {
  const server = status.started_at ? Date.parse(status.started_at) : NaN
  return Number.isNaN(server) ? Date.now() : server
}

function track(target: ScanTarget, status: ScanStatus): TrackedScan {
  const key = scanKey(target.workspaceId, target.repoId, target.branch)
  const existing = scans.get(key)
  const scan: TrackedScan = {
    key,
    ...target,
    repoName: target.repoName ?? existing?.repoName,
    status,
    stopping: existing?.stopping ?? false,
    startedAt: existing?.startedAt ?? startedAtOf(status),
  }
  scans.set(key, scan)
  changed()
  return scan
}

function update(key: string, patch: Partial<TrackedScan>) {
  const current = scans.get(key)
  if (!current) return undefined
  const next = { ...current, ...patch }
  scans.set(key, next)
  changed()
  return next
}

function forget(key: string) {
  const timer = timers.get(key)
  if (timer) clearTimeout(timer)
  timers.delete(key)
  if (scans.delete(key)) changed()
}

// ── polling ─────────────────────────────────────────────────────────────────

/**
 * One poll chain per scan, however many screens show it. Chained rather than
 * an interval, so a slow answer can never stack requests.
 */
function schedule(key: string) {
  if (timers.has(key)) return
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key)
      void poll(key)
    }, POLL_MS),
  )
}

async function poll(key: string) {
  const scan = scans.get(key)
  if (!scan) return
  // The session reads one workspace at a time; a scan in another workspace
  // would answer 404. It waits — `resumeScans` restarts it on the way back.
  if (readActiveWorkspaceId() !== scan.workspaceId) return

  let next: ScanStatus
  try {
    next = await getScanStatus(scan.repoId, scan.status.scan_id)
  } catch (caught) {
    if (caught instanceof ApiRequestError && caught.status === 404) {
      forget(key) // gone — deleted repository, or never ours to see
      return
    }
    schedule(key) // a blip: ask again
    return
  }
  if (!scans.has(key)) return // stopped following while the request was out

  const current = update(key, { status: next })
  if (!current) return
  if (isActivePhase(next.phase)) {
    schedule(key)
    return
  }
  forget(key)
  if (next.phase === "done") emit({ type: "finished", scan: current })
  else if (next.phase === "cancelled")
    emit({ type: "cancelled", scan: current })
  else
    emit({
      type: "failed",
      scan: current,
      reason: next.error ?? "The scan could not be completed.",
    })
}

// ── actions ─────────────────────────────────────────────────────────────────

/**
 * Start a scan, acknowledged at once.
 *
 * The button shows "Queued…" before the request returns. If a scan is already
 * running on that branch — started elsewhere, or before a refresh — this joins
 * it instead of reporting an error.
 */
export async function startScan(target: ScanTarget) {
  const key = scanKey(target.workspaceId, target.repoId, target.branch)
  const existing = scans.get(key)
  if (existing && isActivePhase(existing.status.phase)) return

  const optimistic = track(target, {
    scan_id: "",
    phase: "queued",
    progress: 0,
    branch: target.branch,
  })
  emit({ type: "queued", scan: optimistic })

  try {
    const started = await apiStartScan(target.repoId, target.branch)
    track(target, started)
    schedule(key)
  } catch (caught) {
    if (
      caught instanceof ApiRequestError &&
      caught.code === "SCAN_ALREADY_RUNNING"
    ) {
      const active = await getActiveScan(target.repoId, target.branch).catch(
        () => null,
      )
      if (active) {
        const joined = track(target, active)
        emit({ type: "attached", scan: joined })
        schedule(key)
        return
      }
    }
    forget(key)
    emit({
      type: "start-failed",
      target,
      reason:
        caught instanceof ApiRequestError
          ? caught.detail
          : "Couldn't reach CodeSage to start the scan.",
    })
  }
}

/**
 * Ask the worker to stop. Polling carries on: cancellation is cooperative, and
 * the scan is over only when a poll says `cancelled` (or `done`, if Stop came
 * after finalization had begun).
 */
export async function stopScan(key: string) {
  const scan = scans.get(key)
  if (!scan?.status.scan_id) return
  update(key, { stopping: true })
  try {
    await apiStopScan(scan.repoId, scan.status.scan_id)
  } catch {
    const current = update(key, { stopping: false })
    if (current) emit({ type: "stop-failed", scan: current })
  }
}

/**
 * Find a scan this tab never started — a teammate's, another tab's, one from
 * before the tab was cleared — and follow it. Silent: nothing was asked for.
 */
export async function discoverScan(target: ScanTarget) {
  const key = scanKey(target.workspaceId, target.repoId, target.branch)
  if (scans.has(key)) return
  const active = await getActiveScan(target.repoId, target.branch).catch(
    () => null,
  )
  if (!active || !isActivePhase(active.phase) || scans.has(key)) return
  track(target, active)
  schedule(key)
}

/**
 * Pick up where this tab left off: after a refresh, or on switching back to a
 * workspace whose scans were paused while another one was active.
 */
export function resumeScans(workspaceId: string) {
  for (const saved of readPersisted()) {
    if (saved.workspaceId !== workspaceId || scans.has(saved.key)) continue
    track(saved, {
      scan_id: saved.scanId,
      phase: "running",
      progress: 0,
      branch: saved.branch,
    })
  }
  for (const scan of scans.values()) {
    if (scan.workspaceId === workspaceId && scan.status.scan_id) {
      schedule(scan.key)
    }
  }
}

/** Tests only. */
export function resetScanCenter() {
  for (const timer of timers.values()) clearTimeout(timer)
  timers.clear()
  scans.clear()
  eventListeners.clear()
  snapshot = []
  storage()?.removeItem(STORAGE_KEY)
  for (const listener of listeners) listener()
}

// ── hooks ───────────────────────────────────────────────────────────────────

const EMPTY: TrackedScan[] = []

/** Every scan being followed in the active workspace. */
export function useActiveScans(): TrackedScan[] {
  const workspaceId = useActiveWorkspaceId()
  const all = useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => EMPTY,
  )
  return workspaceId
    ? all.filter((scan) => scan.workspaceId === workspaceId)
    : EMPTY
}

/** The scan on one branch of one project, and the controls for it. */
export function useScanFor(repoId: string, branch: string, repoName?: string) {
  const workspaceId = useActiveWorkspaceId()
  const key = workspaceId && branch ? scanKey(workspaceId, repoId, branch) : ""
  const scan = useSyncExternalStore(
    subscribe,
    () => (key ? scans.get(key) : undefined),
    () => undefined,
  )
  const start = useCallback(() => {
    if (!workspaceId || !branch) return
    void startScan({ workspaceId, repoId, branch, repoName })
  }, [workspaceId, repoId, branch, repoName])
  const stop = useCallback(() => {
    if (key) void stopScan(key)
  }, [key])
  return { scan, start, stop }
}
