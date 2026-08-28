"use client"

import { useCallback, useEffect, useState } from "react"

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
   */
  reload: () => void
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
  key: string,
  fetcher: () => Promise<T>,
): QueryState<T> {
  const [result, setResult] = useState<{
    key: string
    data?: T
    error?: Error
  }>()
  // Bumping this re-runs the effect without changing the key.
  const [nonce, setNonce] = useState(0)
  const reload = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    let alive = true
    fetcher()
      .then((data) => {
        if (alive) setResult({ key, data })
      })
      .catch((error: unknown) => {
        if (alive)
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
  }
}
