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

// How long to wait between asks while the score is still being computed.
export const SCORE_POLL_MS = 2_000

// Past this the wait is "longer than usual": the panel says so kindly, and asks come less often.
export const SCORE_SLOW_MS = 60_000

export const SCORE_SLOW_POLL_MS = 5_000

// How long we keep waiting before calling it a failure.
export const SCORE_TIMEOUT_MS = 10 * 60_000

const SCORE_TIMEOUT_MESSAGE =
  "The health score still isn't ready. Try again in a moment."

export interface HealthReportState extends QueryState<HealthReport> {
  // The snapshot exists and its score is still being computed — the contract's 503 `SCORE_PENDING`.
  pending: boolean
  // The score has been pending for longer than usual ({@link SCORE_SLOW_MS}).
  pendingSlow: boolean
  refreshing: boolean
}

export interface HealthReportOptions {
  enabled?: boolean
}

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

// The full dashboard payload for one repo + branch.
export function useHealthReport(
  repoId: string,
  branch: string,
  snapshotId?: string,
  options?: HealthReportOptions,
): HealthReportState {
  const enabled = options?.enabled ?? true
  const requestedKey = `health:${repoId}:${branch}:${snapshotId ?? "latest"}`
  const epoch = useWorkspaceEpoch()
  const key = `${epoch}:${requestedKey}`

  const [result, setResult] = useState<{
    key: string
    data?: HealthReport
    error?: Error
    pending?: boolean
    slow?: boolean
  }>()

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

  const blocked = !useActiveWorkspaceId()
  const cached = blocked || !enabled ? undefined : readCached<HealthReport>(key)

  useEffect(() => {
    if (blocked || !enabled) return
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined

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

        // Anything else — 404 on a never-scanned branch, a real 500 — is the caller's to render.
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
