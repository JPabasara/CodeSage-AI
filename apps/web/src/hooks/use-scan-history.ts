"use client"

import { getScanHistory } from "@/lib/api/client"
import type { ScanSummary } from "@/lib/types"
import { useQuery, type QueryState } from "./use-query"

export interface ScanHistoryOptions {
  /**
   * `false` holds the read until the caller knows what to ask for — the
   * dashboard's branch, say. Nothing is sent and the state reads as loading.
   * Defaults to `true`.
   */
  enabled?: boolean
}

/**
 * Every stored snapshot for one repository, newest first.
 *
 * Scoped by repository and nothing else. Branch is a column, not a page filter:
 * deltas are kept per branch, so a second branch picker here could sit on a
 * different branch than the dashboard and quietly disagree with it.
 *
 * Scores are derived per request under the active profile, so changing a profile
 * re-ranks this list too — which is why nothing is cached beyond the query key.
 */
export function useScanHistory(
  repoId: string,
  branch?: string,
  options?: ScanHistoryOptions,
): QueryState<ScanSummary[]> {
  return useQuery(
    `scans:${repoId}:${branch ?? "default"}`,
    () => getScanHistory(repoId, branch),
    { enabled: options?.enabled ?? true },
  )
}
