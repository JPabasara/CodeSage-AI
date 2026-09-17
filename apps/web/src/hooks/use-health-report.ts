"use client"

import { useCallback, useEffect, useState } from "react"

import { ApiRequestError, getHealthReport } from "@/lib/api/client"
import type { HealthReport } from "@/lib/types"
import type { QueryState } from "./use-query"

/**
 * How long to wait between asks while the score is still being computed.
 *
 * Scoring is a background task over an already-stored snapshot, so it finishes
 * in seconds. Two seconds is slow enough not to hammer the API and fast enough
 * that the dashboard looks like it loaded by itself.
 */
export const SCORE_POLL_MS = 2_000

/**
 * How long we keep waiting before calling it a failure.
 *
 * A give-up is not optional. A worker that died would otherwise leave the
 * dashboard on "calculating" forever, and a spinner that never resolves reads as
 * a hang rather than a fault — the user is given nothing to do about it. A
 * minute is far longer than scoring takes and short enough to notice.
 */
export const SCORE_TIMEOUT_MS = 60_000

const SCORE_TIMEOUT_MESSAGE =
  "The health score is taking longer than usual to calculate. Try again in a moment."

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
 * `reload` and `refetch` mean the same here as they do in `useQuery` — quiet and
 * loud. The dashboard uses the loud one for both of its cases, including the end
 * of a scan: those numbers are *known* to be stale, so leaving them up while a
 * fresh score is fetched would be a lie.
 */
export function useHealthReport(
  repoId: string,
  branch: string,
): HealthReportState {
  const key = `health:${repoId}:${branch}`

  const [result, setResult] = useState<{
    key: string
    data?: HealthReport
    error?: Error
    pending?: boolean
  }>()

  // Bumping this re-runs the effect without changing the key. Both forms also
  // restart the score-pending deadline, because the effect recomputes it.
  const [nonce, setNonce] = useState(0)
  const reload = useCallback(() => setNonce((n) => n + 1), [])
  const refetch = useCallback(() => {
    setResult(undefined)
    setNonce((n) => n + 1)
  }, [])

  useEffect(() => {
    // Everything the retry loop owns lives in the effect's own closure, so the
    // cleanup below is the single place polling can stop — one timer, one flag,
    // and no way for a stale branch to keep asking after the key changed.
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined

    // A wall clock, not an attempt count: the deadline is what we promise the
    // user, and a slow API must not silently buy itself extra tries. It resets
    // whenever the key changes or Retry is pressed — each is a fresh wait.
    const giveUpAt = Date.now() + SCORE_TIMEOUT_MS

    const ask = async () => {
      try {
        const data = await getHealthReport(repoId, branch)
        if (alive) setResult({ key, data })
      } catch (thrown: unknown) {
        if (!alive) return
        const error =
          thrown instanceof Error ? thrown : new Error(String(thrown))

        // Anything else — 404 on a never-scanned branch, a real 500 — is the
        // caller's to render. Only SCORE_PENDING is worth waiting out.
        if (!isScorePending(error)) {
          setResult({ key, error })
          return
        }

        if (Date.now() >= giveUpAt) {
          setResult({ key, error: new Error(SCORE_TIMEOUT_MESSAGE) })
          return
        }

        setResult({ key, pending: true })
        // Chained, not an interval: the next ask is scheduled by the answer to
        // the last one, so a slow response can never stack up requests.
        timer = setTimeout(() => void ask(), SCORE_POLL_MS)
      }
    }

    void ask()

    return () => {
      alive = false
      if (timer) clearTimeout(timer)
    }
  }, [key, nonce, repoId, branch])

  // `key` guards against a stale answer: a response for the previous branch is
  // dropped rather than rendered under the new one.
  const settled = result?.key === key
  return {
    data: settled ? result?.data : undefined,
    error: settled ? result?.error : undefined,
    pending: settled ? (result?.pending ?? false) : false,
    loading: !settled,
    reload,
    refetch,
  }
}
