"use client"

import { useEffect, useState } from "react"

// Shared read-hook engine. Every data hook (useProjects, useHealthReport, …) is
// a one-liner over this, so the { data, loading, error } shape and the
// stale-request guard live in exactly one place.
export interface QueryState<T> {
  data?: T
  loading: boolean
  error?: Error
}

/**
 * Run `fetcher` whenever `key` changes and expose { data, loading, error }.
 *
 * `loading` is DERIVED (settled-key !== current-key), not stored — so there is
 * no synchronous setState inside the effect (which React 19's
 * react-hooks/set-state-in-effect rule forbids), and switching `key` clears
 * stale data instantly instead of flashing the previous result.
 *
 * `key` is the single source of truth for "what am I fetching," so it is the
 * only dependency; `fetcher` is a fresh closure each render and is intentionally
 * excluded.
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
  }, [key])

  const settled = result?.key === key
  return {
    data: settled ? result?.data : undefined,
    error: settled ? result?.error : undefined,
    loading: !settled,
  }
}
