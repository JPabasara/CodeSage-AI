"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { ApiRequestError } from "@/lib/api/client"
import {
  fetchShared,
  readCached,
  writeCached,
  forgetQueries,
} from "@/lib/query-cache"
import {
  noteWorkspaceMissing,
  useActiveWorkspaceId,
  useWorkspaceEpoch,
} from "./use-workspace-scope"

export interface QueryState<T> {
  data?: T
  loading: boolean
  error?: Error
  // Re-run the fetcher for the same key, after a write that changes what a read returns.
  reload: () => void
  refetch: () => void
}

export interface MutableQueryState<T> extends QueryState<T> {
  update: (updater: (current: T | undefined) => T | undefined) => void
}

// Run `fetcher` whenever `key` changes and expose { data, loading, error }.
export interface QueryOptions {
  scope?: "workspace" | "account"
  enabled?: boolean
}

export function useQuery<T>(
  requestedKey: string,
  fetcher: () => Promise<T>,
  options?: QueryOptions,
): MutableQueryState<T> {
  const workspaceId = useActiveWorkspaceId()
  const blocked =
    options?.enabled === false ||
    ((options?.scope ?? "workspace") === "workspace" && !workspaceId)

  const epoch = useWorkspaceEpoch()
  const key = `${epoch}:${requestedKey}`

  const [result, setResult] = useState<{
    key: string
    data?: T
    error?: Error
  }>()
  const cached = blocked ? undefined : readCached<T>(key)

  // Bumping this re-runs the effect without changing the key.
  const [nonce, setNonce] = useState(0)
  const revision = useRef(0)
  const fresh = useRef(false)
  const reload = useCallback(() => {
    fresh.current = true
    setNonce((n) => n + 1)
  }, [])

  // Same re-run, but the result — and the cached copy — is dropped first.
  const refetch = useCallback(() => {
    forgetQueries((requested) => requested === requestedKey)
    fresh.current = true
    setResult(undefined)
    setNonce((n) => n + 1)
  }, [requestedKey])

  const update = useCallback(
    (updater: (current: T | undefined) => T | undefined) => {
      revision.current += 1
      setResult((current) => {
        const data = updater(
          current?.key === key ? current.data : readCached<T>(key)?.data,
        )
        writeCached(key, data)
        return { key, data }
      })
    },
    [key],
  )

  useEffect(() => {
    if (blocked) return
    let alive = true
    const startedAtRevision = revision.current
    const skipJoin = fresh.current
    fresh.current = false
    fetchShared(key, fetcher, { fresh: skipJoin })
      .then((data) => {
        if (alive && startedAtRevision === revision.current) {
          setResult((current) =>
            current?.key === key && current.data === data && !current.error
              ? current
              : { key, data },
          )
        }
      })
      .catch((error: unknown) => {
        if (
          error instanceof ApiRequestError &&
          error.code === "WORKSPACE_REQUIRED"
        ) {
          noteWorkspaceMissing()
        }
        if (alive && startedAtRevision === revision.current)
          setResult({
            key,
            error: error instanceof Error ? error : new Error(String(error)),
          })
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce, blocked])

  const settled = result?.key === key
  const shown = settled ? result : cached && { key, data: cached.data }
  return {
    data: shown ? shown.data : undefined,
    error: settled ? result?.error : undefined,
    loading: !shown,
    reload,
    refetch,
    update,
  }
}
