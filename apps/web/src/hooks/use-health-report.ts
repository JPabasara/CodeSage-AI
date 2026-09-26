"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { ApiRequestError, getHealthReport } from "@/lib/api/client"
import { fetchShared, forgetQueries, readCached } from "@/lib/query-cache"
import type { HealthReport } from "@/lib/types"
import type { QueryState } from "./use-query"
import {
  noteWorkspaceMissing,
  useActiveWorkspaceId,
  useWorkspaceEpoch,
} from "./use-workspace-scope"

/**
 * How long to wait between asks while the score is still being computed.
 *
 * Scoring is a background task over an already-stored snapshot, so it finishes
 * in seconds. Two seconds is slow enough not to hammer the API and fast enough
 * that the dashboard looks like it loaded by itself.
 */
export const SCORE_POLL_MS = 2_000

/**
 * Past this the wait is "longer than usual": the panel says so kindly, and
 * asks come less often. It is not a failure — a large repository really can
 * take over a minute to score, and giving up here showed an error for a score
 * that arrived seconds later.
 */
export const SCORE_SLOW_MS = 60_000

/** How often to ask once the wait is slow. */
export const SCORE_SLOW_POLL_MS = 5_000

/**
 * How long we keep waiting before calling it a failure.
 *
 * A give-up is still not optional. A scoring worker that died would otherwise
 * leave the dashboard on "calculating" forever, and a spinner that never
 * resolves reads as a hang rather than a fault. Ten minutes is far past any
 * real score, so only a broken worker reaches it.
 */
export const SCORE_TIMEOUT_MS = 10 * 60_000

const SCORE_TIMEOUT_MESSAGE =
  "The health score still isn't ready. Try again in a moment."

export interface HealthReportState extends QueryState<HealthReport> {
  /**
   * The snapshot exists and its score is still being computed — the contract's
   * 503 `SCORE_PENDING`.
   *
   * Deliberately its own flag rather than an error: nothing has gone wrong, and
   * it resolves on its own. It is also distinct from `loading`, which means the
   * very first request has not answered yet.
   */
  pending: boolean
  /**
   * The score has been pending for longer than usual ({@link SCORE_SLOW_MS}).
   * Still waiting, not an error: the panel switches to its "taking longer"
   * lines.
   */
  pendingSlow: boolean
  /**
   * A `reload` is out and has not answered yet. The dashboard reloads only
   * when a scan finishes, so this is "the new numbers are on their way" — the
   * report on screen is known to be stale while it is true (13H.4).
   */
  refreshing: boolean
}

export interface HealthReportOptions {
  /**
   * `false` holds the read: nothing is sent and the state reads as loading.
   *
   * The dashboard sets this until its branch is resolved. Asking with a guessed
   * or empty branch first meant two requests for one page, and a first answer
   * (a 404 for the guess) that flashed "No scans yet" at a project that has
   * results. Defaults to `true`.
   */
  enabled?: boolean
}

/**
 * The cache key of one report. Shared with the scan store, which fetches the
 * new report when a scan's score is ready, so the dashboard finds it there.
 */
export function healthKey(
  epoch: number,
  repoId: string,
  branch: string,
  snapshotId?: string,
) {
  return `${epoch}:health:${repoId}:${branch}:${snapshotId ?? "latest"}`
}

const isScorePending = (error: unknown) =>
  error instanceof ApiRequestError && error.code === "SCORE_PENDING"

/**
 * The full dashboard payload for one repo + branch. Refetches on branch change,
 * and waits out an asynchronous score instead of reporting one as a failure.
 *
 * This is the one read hook that is not a one-liner over {@link useQuery}, and
 * the reason is FR-21: the API stores a snapshot first and scores it in a
 * background task, so `GET /health` has a third answer — 503 `SCORE_PENDING` —
 * that is neither data nor an error. `useQuery` has no way to say that, and it
 * is shared by every other read hook, none of which needs a retry loop.
 *
 * It shares `useQuery`'s app-wide cache (13H.3): coming back to the dashboard
 * shows the last report at once and revalidates it quietly. The cache is
 * cleared when a scan finishes, a profile changes or the workspace switches.
 *
 * `reload` and `refetch` mean the same here as they do in `useQuery` — quiet and
 * loud. The dashboard uses the loud one for both of its cases, including the end
 * of a scan: those numbers are *known* to be stale, so leaving them up while a
 * fresh score is fetched would be a lie.
 */
export function useHealthReport(
  repoId: string,
  branch: string,
  snapshotId?: string,
  options?: HealthReportOptions,
): HealthReportState {
  const enabled = options?.enabled ?? true
  const requestedKey = `health:${repoId}:${branch}:${snapshotId ?? "latest"}`
  const epoch = useWorkspaceEpoch()
  // The workspace epoch, as in `useQuery`: a switch changes the key, so one
  // workspace's report never shows under another's name. Built inline rather
  // than with `healthKey` (the React Compiler cannot keep this hook's
  // callbacks memoized across that call); a test pins the two to one format.
  const key = `${epoch}:${requestedKey}`

  const [result, setResult] = useState<{
    key: string
    data?: HealthReport
    error?: Error
    pending?: boolean
    slow?: boolean
  }>()

  // Bumping this re-runs the effect without changing the key. Both forms also
  // restart the score-pending deadline, because the effect recomputes it.
  const [nonce, setNonce] = useState(0)
  // Reload and Retry must send a new request, not join one already out.
  const fresh = useRef(false)
  const [refreshing, setRefreshing] = useState(false)
  const reload = useCallback(() => {
    fresh.current = true
    setRefreshing(true)
    setNonce((n) => n + 1)
  }, [])
  const refetch = useCallback(() => {
    forgetQueries((requested) => requested === requestedKey)
    fresh.current = true
    setResult(undefined)
    setNonce((n) => n + 1)
  }, [requestedKey])

  // The same gate as every other workspace-bound read: nothing is asked until
  // the session names a workspace.
  const blocked = !useActiveWorkspaceId()
  const cached = blocked || !enabled ? undefined : readCached<HealthReport>(key)

  useEffect(() => {
    if (blocked || !enabled) return
    // Everything the retry loop owns lives in the effect's own closure, so the
    // cleanup below is the single place polling can stop — one timer, one flag,
    // and no way for a stale branch to keep asking after the key changed.
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined

    // A wall clock, not an attempt count: the deadline is what we promise the
    // user, and a slow API must not silently buy itself extra tries. It resets
    // whenever the key changes or Retry is pressed — each is a fresh wait.
    const startedWaiting = Date.now()
    const giveUpAt = startedWaiting + SCORE_TIMEOUT_MS
    let skipJoin = fresh.current
    fresh.current = false

    const ask = async () => {
      try {
        const data = await fetchShared(
          key,
          () => getHealthReport(repoId, branch, snapshotId),
          { fresh: skipJoin },
        )
        skipJoin = false
        if (alive) setRefreshing(false)
        // Same report as on screen (same snapshot, same scores): keep the
        // state object, so nothing re-renders and no chart redraws.
        if (alive)
          setResult((current) =>
            current?.key === key && current.data === data
              ? current
              : { key, data },
          )
      } catch (thrown: unknown) {
        skipJoin = false
        if (!alive) return
        const error =
          thrown instanceof Error ? thrown : new Error(String(thrown))

        // Anything else — 404 on a never-scanned branch, a real 500 — is the
        // caller's to render. Only SCORE_PENDING is worth waiting out.
        if (
          error instanceof ApiRequestError &&
          error.code === "WORKSPACE_REQUIRED"
        ) {
          noteWorkspaceMissing()
        }
        if (!isScorePending(error)) {
          setRefreshing(false)
          setResult({ key, error })
          return
        }

        if (Date.now() >= giveUpAt) {
          setRefreshing(false)
          setResult({ key, error: new Error(SCORE_TIMEOUT_MESSAGE) })
          return
        }

        const slow = Date.now() - startedWaiting >= SCORE_SLOW_MS
        setResult({ key, pending: true, slow })
        // Chained, not an interval: the next ask is scheduled by the answer to
        // the last one, so a slow response can never stack up requests.
        timer = setTimeout(
          () => void ask(),
          slow ? SCORE_SLOW_POLL_MS : SCORE_POLL_MS,
        )
      }
    }

    void ask()

    return () => {
      alive = false
      if (timer) clearTimeout(timer)
    }
  }, [blocked, enabled, key, nonce, repoId, branch, snapshotId])

  // `key` guards against a stale answer: a response for the previous branch is
  // dropped rather than rendered under the new one. A held read is never
  // settled, so it reads as loading rather than as an empty answer.
  //
  // A newer answer in the app-wide cache wins over this hook's own: the scan
  // store fetches a finished scan's report while the user is elsewhere, and a
  // cache entry that differs from what this hook holds can only be newer —
  // a failed read drops its entry, it never leaves a stale one behind.
  const settled = enabled && result?.key === key
  const fromCache =
    cached !== undefined && (!settled || result?.data !== cached.data)
  const shown = fromCache
    ? { key, data: cached.data }
    : settled
      ? result
      : undefined
  const own = settled && !fromCache
  return {
    data: shown ? shown.data : undefined,
    error: own ? result?.error : undefined,
    pending: own ? (result?.pending ?? false) : false,
    pendingSlow: own ? Boolean(result?.pending && result.slow) : false,
    refreshing: enabled && refreshing,
    loading: !shown,
    reload,
    refetch,
  }
}
