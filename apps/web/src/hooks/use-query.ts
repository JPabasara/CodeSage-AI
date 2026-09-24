"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { useWorkspaceEpoch } from "./use-workspace-scope"

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
export function useQuery<T>(
  requestedKey: string,
  fetcher: () => Promise<T>,
): MutableQueryState<T> {
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
  // Bumping this re-runs the effect without changing the key.
  const [nonce, setNonce] = useState(0)
  const revision = useRef(0)
  const reload = useCallback(() => setNonce((n) => n + 1), [])

  // Same re-run, but the result is dropped first. `settled` then goes false,
  // which is the single switch that turns `loading` back on.
  const refetch = useCallback(() => {
    setResult(undefined)
    setNonce((n) => n + 1)
  }, [])

  const update = useCallback(
    (updater: (current: T | undefined) => T | undefined) => {
      revision.current += 1
      setResult((current) => ({
        key,
        data: updater(current?.key === key ? current.data : undefined),
      }))
    },
    [key],
  )

  useEffect(() => {
    let alive = true
    const startedAtRevision = revision.current
    fetcher()
      .then((data) => {
        if (alive && startedAtRevision === revision.current) {
          setResult({ key, data })
        }
      })
      .catch((error: unknown) => {
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
  }, [key, nonce])

  const settled = result?.key === key
  return {
    data: settled ? result?.data : undefined,
    error: settled ? result?.error : undefined,
    loading: !settled,
    reload,
    refetch,
    update,
  }
}
