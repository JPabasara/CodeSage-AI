"use client"

import { getScanHistory } from "@/lib/api/client"
import type { ScanSummary } from "@/lib/types"
import { useQuery, type QueryState } from "./use-query"

/**
 * Every stored snapshot for one repository, newest first (FR-19).
 *
 * Scoped by repository and nothing else. The branch is a column on each row, not
 * a filter on the page: the contract keeps deltas per branch, so a second branch
 * picker here could sit on a different branch than the dashboard's and quietly
 * show a set of numbers that disagrees with it.
 *
 * `health_score`, `grade` and `delta` are derived by the API on every request
 * under the active profile, so changing a profile re-ranks this list too — which
 * is why nothing here is cached beyond the query key.
 */
export function useScanHistory(repoId: string): QueryState<ScanSummary[]> {
  return useQuery(`scans:${repoId}`, () => getScanHistory(repoId))
}
