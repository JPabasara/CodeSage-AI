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

// Shared read-hook engine. Every data hook (useProjects, useHealthReport, …) is
// a one-liner over this, so the { data, loading, error } shape and the
// stale-request guard live in exactly one place.
export interface QueryState<T> {
  data?: T
  loading: boolean
  error?: Error
  /**
   * Re-run the fetcher for the same key, after a write that changes what a read
   * returns. Deliberately does not flip `loading` back on — the existing data
   * stays on screen, because a list that blanked to skeletons on every add would
   * read as a bug.
   *
   * Quiet on purpose. Behind a Retry button use {@link refetch} instead.
   */
  reload: () => void
  /**
   * Re-run the fetcher and *show* it: data and error are cleared first, so
   * `loading` flips back on and the screen returns to its skeleton.
   *
   * This is what a **Retry** button needs. With `reload` the press produces no
   * visible change at all — the old error simply stays until the new answer
   * lands — so the button reads as dead and gets pressed again and again.
   *
   * The two are separate rather than one function with a flag because the
   * choice is not a preference: a silent reload after "project connected" is
   * right, and a silent reload behind Retry is a bug.
   */
  refetch: () => void
}

export interface MutableQueryState<T> extends QueryState<T> {
  /**
   * Apply a local write immediately. Any older request still in flight is
   * ignored, so it cannot put pre-write data back on screen.
   */
  update: (updater: (current: T | undefined) => T | undefined) => void
}

/**
 * Run `fetcher` whenever `key` changes and expose { data, loading, error }.
 *
 * `loading` is derived, not stored, so there is no setState inside the effect and
 * switching `key` clears stale data instantly instead of flashing the old result.
 *
 * `key` is the only dependency; `fetcher` is a fresh closure each render and is
 * excluded on purpose.
 */
export interface QueryOptions {
  /**
   * `workspace` (the default): the read belongs to the active workspace, so it
   * waits until the session names one and is never sent without one.
   * `account`: the read works without a workspace — the session itself, and the
   * list of workspaces the user can pick from.
   */
  scope?: "workspace" | "account"
  /**
   * `false` holds the read until the caller knows what to ask — the
   * dashboard's branch, say. Nothing is sent and the state reads as loading.
   * Defaults to `true`.
   */
  enabled?: boolean
}

export function useQuery<T>(
  requestedKey: string,
  fetcher: () => Promise<T>,
  options?: QueryOptions,
): MutableQueryState<T> {
  // Until there is a workspace, a workspace-bound read has nothing to ask about:
  // it stays `loading` and sends nothing. That is what keeps a new user's first
  // screen free of 409s rather than full of error states.
  const workspaceId = useActiveWorkspaceId()
  const blocked =
    options?.enabled === false ||
    ((options?.scope ?? "workspace") === "workspace" && !workspaceId)

  // Every read in this app is workspace-scoped, so the workspace is part of the
  // key rather than something each hook has to remember to invalidate. A switch
  // bumps the epoch, which changes this key, which clears `data` in the same
  // render — that is what stops one workspace's projects, profiles or findings
  // appearing for a moment under another workspace's name.
  const epoch = useWorkspaceEpoch()
  const key = `${epoch}:${requestedKey}`

  const [result, setResult] = useState<{
    key: string
    data?: T
    error?: Error
  }>()
  // The app-wide cache (13H.3): a page mounting again shows the last answer
  // at once and refreshes it quietly, instead of starting from a skeleton. A
  // held read shows nothing — it has not decided what to ask yet.
  const cached = blocked ? undefined : readCached<T>(key)

  // Bumping this re-runs the effect without changing the key.
  const [nonce, setNonce] = useState(0)
  const revision = useRef(0)
  // Set by reload and refetch: the next request must be a new one, not a join
  // onto a request that left before the write that asked for it.
  const fresh = useRef(false)
  const reload = useCallback(() => {
    fresh.current = true
    setNonce((n) => n + 1)
  }, [])

  // Same re-run, but the result — and the cached copy — is dropped first.
  // Nothing is left to show, which is the single switch that turns `loading`
  // back on.
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
          // The same answer as on screen keeps the same state object, so a
          // quiet revalidation that changed nothing re-renders nothing.
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
