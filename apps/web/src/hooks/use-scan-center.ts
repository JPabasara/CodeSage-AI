"use client"

import { useCallback, useSyncExternalStore } from "react"

import {
  ApiRequestError,
  getActiveScan,
  getHealthReport,
  getScanStatus,
  startScan as apiStartScan,
  stopScan as apiStopScan,
} from "@/lib/api/client"
import { scanFailureMessage } from "@/lib/guardrail-messages"
import {
  fetchShared,
  forgetScanResults,
  readCached,
  writeCached,
} from "@/lib/query-cache"
import { isSlow, pickLine, poolFor, type PanelMode } from "@/lib/scan-messages"
import {
  creepTarget,
  nextShown,
  reportedProgress,
  SCAN_SHARE,
  scoringTarget,
  stageOf,
  toBar,
} from "@/lib/scan-progress"
import type { HealthReport, ScanStatus } from "@/lib/types"
import {
  healthKey,
  SCORE_POLL_MS,
  SCORE_SLOW_MS,
  SCORE_SLOW_POLL_MS,
  SCORE_TIMEOUT_MS,
} from "./use-health-report"
import { LINE_ROTATE_MS } from "./use-rotating-line"
import {
  readActiveWorkspaceId,
  readWorkspaceEpoch,
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
//
// It follows the whole JOB, not just the worker's part: scanning, then the
// health score being calculated, then ready. The toast says "ready" only when
// there is a score to show, and the bar, the stage and the friendly line live
// here too — so leaving the dashboard and coming back continues exactly where
// it was instead of starting the animation again.

export const POLL_MS = 600
const STORAGE_KEY = "codesage.activeScans.v1"

/** How often the shared bar and friendly line are advanced. */
export const LIVE_TICK_MS = 100

/**
 * The job, from the user's side: the worker scanning, the score being
 * calculated, then ready to show.
 */
export type ScanJob = "scanning" | "scoring" | "ready"

export interface TrackedScan {
  key: string
  workspaceId: string
  repoId: string
  branch: string
  repoName?: string
  status: ScanStatus
  job: ScanJob
  /** Stop has been requested; the worker stops at its next stage boundary. */
  stopping: boolean
  /** When it started, for the elapsed clock (server time when known). */
  startedAt: number
  /**
   * The results the dashboard showed before this scan. It keeps showing them
   * — fully usable — until the user chooses "Show them". Absent for a branch
   * that had no results, which switches to the new ones by itself.
   */
  pinnedSnapshotId?: string
  /** When the score's wait began (job "scoring"). */
  scoringSince?: number
  /** The score has been pending longer than usual. */
  scoreSlow?: boolean
  /** The new report's headline numbers, once ready (absent if it came late). */
  health?: { score: number; grade: string; delta: number }
}

export type ScanEvent =
  | { type: "queued"; scan: TrackedScan }
  | { type: "attached"; scan: TrackedScan }
  /** Scan AND score are done. `report` is absent if the score came too late. */
  | { type: "finished"; scan: TrackedScan; report?: HealthReport }
  /** Nothing new on the branch since the last scan: no scan ran. */
  | { type: "up-to-date"; scan: TrackedScan }
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

/** What the progress UI draws for one job. Kept apart from `TrackedScan`,
 * because it changes ten times a second and only the small progress pieces
 * should redraw that often — never the whole dashboard. */
export interface ScanLive {
  /** 0–100 on the one bar for scan and score; undefined while queued. */
  bar: number | undefined
  /** The friendly line under the headline, and when it was chosen. */
  line: string
  lineAt: number
  /** The pool the line came from: `${mode}:${slow}`. */
  poolKey: string
  /** The stage the creep clock belongs to, and when it entered it. */
  stageKey: string
  stageAt: number
}

const scans = new Map<string, TrackedScan>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()
const listeners = new Set<() => void>()
const eventListeners = new Set<(event: ScanEvent) => void>()
let snapshot: TrackedScan[] = []

const live = new Map<string, ScanLive>()
const liveListeners = new Set<() => void>()
let ticker: ReturnType<typeof setInterval> | undefined
let lastTick = 0

export const scanKey = (workspaceId: string, repoId: string, branch: string) =>
  `${workspaceId}:${repoId}:${branch}`

export const isActivePhase = (phase: ScanStatus["phase"]) =>
  phase === "queued" || phase === "running"

/** Scanning or scoring: work still going on. A ready job is waiting for a look. */
export const isJobActive = (scan: Pick<TrackedScan, "job">) =>
  scan.job !== "ready"

// ── store plumbing ──────────────────────────────────────────────────────────

function changed() {
  snapshot = [...scans.values()]
  persist()
  for (const listener of listeners) listener()
  syncTicker()
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

function subscribeLive(listener: () => void) {
  liveListeners.add(listener)
  return () => {
    liveListeners.delete(listener)
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

type Persisted = Pick<
  TrackedScan,
  "key" | "workspaceId" | "repoId" | "branch" | "repoName" | "startedAt"
> & { scanId: string }

function persist() {
  const store = storage()
  if (!store) return
  // A ready job is only waiting for a look; after a refresh the dashboard
  // simply shows the new results, so it is not worth keeping.
  const saved: Persisted[] = snapshot
    .filter((scan) => scan.status.scan_id && isJobActive(scan))
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
  // A new scan id is a new job: its clock and bar start again.
  const same =
    existing &&
    (!existing.status.scan_id || existing.status.scan_id === status.scan_id)
  const scan: TrackedScan = {
    key,
    ...target,
    repoName: target.repoName ?? existing?.repoName,
    status,
    job: "scanning",
    stopping: same ? existing.stopping : false,
    startedAt: same ? existing.startedAt : startedAtOf(status),
    pinnedSnapshotId: same ? existing.pinnedSnapshotId : undefined,
  }
  if (!same) live.delete(key)
  scans.set(key, scan)
  ensureLive(scan)
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
  live.delete(key)
  if (scans.delete(key)) changed()
}

// ── the shared bar and friendly line ────────────────────────────────────────

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)"

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(REDUCED_MOTION).matches
  )
}

/** Which headline and pool of lines the job is in right now. */
export function modeOf(scan: TrackedScan): PanelMode {
  if (scan.job !== "scanning") return "calculating"
  return scan.status.phase === "queued" ? "queued" : stageOf(scan.status)
}

/** Running well past its usual time — the panel then says so, kindly. */
export function slowOf(scan: TrackedScan, now = Date.now()) {
  if (scan.job !== "scanning") return Boolean(scan.scoreSlow)
  if (scan.status.phase === "queued") return false
  return isSlow(now - scan.startedAt, scan.status.typical_seconds)
}

function stageKeyOf(scan: TrackedScan) {
  return scan.job === "scanning"
    ? `${scan.status.scan_id}:${scan.status.phase}:${stageOf(scan.status)}`
    : "scoring"
}

/** A job gets a line (and a place on the bar) the moment it is tracked, so
 * its first frame is never blank. */
function ensureLive(scan: TrackedScan) {
  if (live.has(scan.key)) return
  const now = Date.now()
  const mode = modeOf(scan)
  const slow = slowOf(scan, now)
  live.set(scan.key, {
    bar: scan.status.phase === "running" ? 0 : undefined,
    line: pickLine(poolFor(mode, slow), undefined),
    lineAt: now,
    poolKey: `${mode}:${slow}`,
    stageKey: stageKeyOf(scan),
    stageAt: now,
  })
  notifyLive()
}

function notifyLive() {
  for (const listener of liveListeners) listener()
}

/**
 * One step for every job in progress: advance the bar (creep within the
 * stage, glide to real numbers, never backwards) and rotate the line.
 */
export function advanceLive(now = Date.now()) {
  const reduced = prefersReducedMotion()
  const dt = lastTick ? now - lastTick : LIVE_TICK_MS
  lastTick = now
  let dirty = false
  for (const scan of scans.values()) {
    if (!isJobActive(scan)) continue
    const current = live.get(scan.key)
    if (!current) continue
    const next: ScanLive = { ...current }

    const stageKey = stageKeyOf(scan)
    if (stageKey !== current.stageKey) {
      next.stageKey = stageKey
      next.stageAt = now
    }

    if (scan.job === "scoring") {
      const target = reduced
        ? SCAN_SHARE
        : scoringTarget(now - (scan.scoringSince ?? now))
      next.bar = nextShown(current.bar ?? 0, target, dt, reduced, SCAN_SHARE)
    } else if (scan.status.phase === "running") {
      const reported = toBar(reportedProgress(scan.status))
      const target = reduced
        ? reported
        : toBar(creepTarget(scan.status, now - next.stageAt))
      next.bar = nextShown(current.bar ?? 0, target, dt, reduced, reported)
    }

    const mode = modeOf(scan)
    const slow = slowOf(scan, now)
    const poolKey = `${mode}:${slow}`
    if (poolKey !== current.poolKey || now - current.lineAt >= LINE_ROTATE_MS) {
      next.line = pickLine(poolFor(mode, slow), current.line)
      next.poolKey = poolKey
      next.lineAt = now
    }

    if (
      next.bar !== current.bar ||
      next.line !== current.line ||
      next.stageKey !== current.stageKey
    ) {
      live.set(scan.key, next)
      dirty = true
    }
  }
  if (dirty) notifyLive()
}

/** The ticker runs only while some job is in progress. */
function syncTicker() {
  const busy = [...scans.values()].some(isJobActive)
  if (busy && !ticker) {
    lastTick = 0
    ticker = setInterval(() => advanceLive(), LIVE_TICK_MS)
  } else if (!busy && ticker) {
    clearInterval(ticker)
    ticker = undefined
  }
}

// ── polling the scan ────────────────────────────────────────────────────────

/**
 * One poll chain per scan, however many screens show it. Chained rather than
 * an interval, so a slow answer can never stack requests.
 */
function schedule(key: string, delay = POLL_MS) {
  if (timers.has(key)) return
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key)
      const scan = scans.get(key)
      void (scan?.job === "scoring" ? awaitScore(key) : poll(key))
    }, delay),
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
  if (next.phase === "done") {
    beginScoring(key)
    return
  }
  forget(key)
  if (next.phase === "cancelled") emit({ type: "cancelled", scan: current })
  else
    emit({
      type: "failed",
      scan: current,
      reason: scanFailureMessage(next),
    })
}

// ── the score's wait ────────────────────────────────────────────────────────

/**
 * The scan is done; the job is not. Keep the results the dashboard was
 * showing reachable under their own snapshot id, drop the stale "latest", and
 * wait for the new report.
 */
function beginScoring(key: string) {
  const scan = scans.get(key)
  if (!scan) return
  if (scan.job === "scoring") {
    void awaitScore(key)
    return
  }
  const epoch = readWorkspaceEpoch()
  const latest = readCached<HealthReport>(
    healthKey(epoch, scan.repoId, scan.branch),
  )?.data
  const pinned = scan.pinnedSnapshotId ?? latest?.snapshot_id
  const pinnedKey = pinned
    ? healthKey(epoch, scan.repoId, scan.branch, pinned)
    : undefined
  const pinnedReport =
    (pinnedKey ? readCached<HealthReport>(pinnedKey)?.data : undefined) ??
    (latest?.snapshot_id === pinned ? latest : undefined)

  // The pre-scan "latest" is stale now; the pinned results are not.
  forgetScanResults(scan.repoId, scan.branch)
  if (pinnedKey && pinnedReport) writeCached(pinnedKey, pinnedReport)

  update(key, {
    job: "scoring",
    scoringSince: Date.now(),
    scoreSlow: false,
    pinnedSnapshotId: pinned,
  })
  void awaitScore(key)
}

const isScorePending = (error: unknown) =>
  error instanceof ApiRequestError && error.code === "SCORE_PENDING"

async function awaitScore(key: string) {
  const scan = scans.get(key)
  if (!scan || scan.job !== "scoring") return
  if (readActiveWorkspaceId() !== scan.workspaceId) return

  const epoch = readWorkspaceEpoch()
  try {
    // `fresh`: never join a read that left before the scan finished — it
    // would answer with the old report.
    const report = await fetchShared(
      healthKey(epoch, scan.repoId, scan.branch),
      () => getHealthReport(scan.repoId, scan.branch),
      { fresh: true },
    )
    finishJob(key, report)
  } catch (caught) {
    const current = scans.get(key)
    if (!current || current.job !== "scoring") return
    const waited = Date.now() - (current.scoringSince ?? Date.now())
    if (isScorePending(caught)) {
      if (waited >= SCORE_TIMEOUT_MS) {
        finishJob(key, undefined)
        return
      }
      const slow = waited >= SCORE_SLOW_MS
      if (slow !== current.scoreSlow) update(key, { scoreSlow: slow })
      schedule(key, slow ? SCORE_SLOW_POLL_MS : SCORE_POLL_MS)
      return
    }
    if (caught instanceof ApiRequestError) {
      // A real answer that is not a report (the project was removed, say):
      // the scan itself did finish.
      finishJob(key, undefined)
      return
    }
    schedule(key, SCORE_POLL_MS) // the network blinked: ask again
  }
}

function finishJob(key: string, report: HealthReport | undefined) {
  const scan = scans.get(key)
  if (!scan) return
  const timer = timers.get(key)
  if (timer) clearTimeout(timer)
  timers.delete(key)
  const health = report
    ? {
        score: report.health_score,
        grade: report.grade,
        delta: report.delta,
      }
    : undefined
  // With results on screen from before, the job waits for "Show them". With
  // none (a first scan), there is nothing to lose: the dashboard just shows
  // the new results, so the job is done here.
  const waitsForALook =
    scan.pinnedSnapshotId !== undefined &&
    report !== undefined &&
    scan.pinnedSnapshotId !== report.snapshot_id
  const finished = waitsForALook
    ? update(key, { job: "ready", health, scoreSlow: false })
    : { ...scan, job: "ready" as const, health }
  if (!waitsForALook) forget(key)
  if (finished) emit({ type: "finished", scan: finished, report })
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
  if (existing && isJobActive(existing)) return

  const optimistic = track(target, {
    scan_id: "",
    phase: "queued",
    progress: 0,
    branch: target.branch,
  })
  emit({ type: "queued", scan: optimistic })

  try {
    const started = await apiStartScan(target.repoId, target.branch)
    // Nothing new on the branch: the API answers with the last finished scan
    // instead of queueing one. The results on screen are already current.
    if (started.phase === "done") {
      forget(key)
      emit({ type: "up-to-date", scan: { ...optimistic, status: started } })
      return
    }
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
  if (!scan?.status.scan_id || scan.job !== "scanning") return
  update(key, { stopping: true })
  try {
    await apiStopScan(scan.repoId, scan.status.scan_id)
  } catch {
    const current = update(key, { stopping: false })
    if (current) emit({ type: "stop-failed", scan: current })
  }
}

/**
 * "Show them": the user has seen that new results are ready. The dashboard
 * drops the pinned results and shows the new ones.
 */
export function acknowledgeScan(key: string) {
  const scan = scans.get(key)
  if (scan && scan.job === "ready") forget(key)
}

/**
 * The dashboard is showing these results while a scan of the same branch
 * runs: remember them, so they stay on screen until the user asks for the new
 * ones — even if the cached copy is dropped in the meantime.
 */
export function pinScanResults(key: string, report: HealthReport) {
  const scan = scans.get(key)
  if (!scan || scan.job !== "scanning" || scan.pinnedSnapshotId) return
  writeCached(
    healthKey(
      readWorkspaceEpoch(),
      scan.repoId,
      scan.branch,
      report.snapshot_id,
    ),
    report,
  )
  update(key, { pinnedSnapshotId: report.snapshot_id })
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
    if (
      scan.workspaceId === workspaceId &&
      scan.status.scan_id &&
      isJobActive(scan)
    ) {
      schedule(scan.key)
    }
  }
}

/** Tests only. */
export function resetScanCenter() {
  for (const timer of timers.values()) clearTimeout(timer)
  timers.clear()
  scans.clear()
  live.clear()
  eventListeners.clear()
  snapshot = []
  if (ticker) clearInterval(ticker)
  ticker = undefined
  lastTick = 0
  storage()?.removeItem(STORAGE_KEY)
  for (const listener of listeners) listener()
  notifyLive()
}

// ── hooks ───────────────────────────────────────────────────────────────────

const EMPTY: TrackedScan[] = []

/** Every job being followed in the active workspace, ready ones included. */
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

/** The job on one branch of one project, and the controls for it. */
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

/**
 * The bar and friendly line of one job. Only the small progress pieces call
 * this: it changes ten times a second.
 */
export function useScanLive(key: string | undefined): ScanLive | undefined {
  return useSyncExternalStore(
    subscribeLive,
    () => (key ? live.get(key) : undefined),
    () => undefined,
  )
}
