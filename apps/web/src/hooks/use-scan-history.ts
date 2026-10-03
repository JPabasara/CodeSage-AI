"use client"

import { getScanHistory } from "@/lib/api/client"
import type { ScanSummary } from "@/lib/types"
import { useQuery, type QueryState } from "./use-query"

export interface ScanHistoryOptions {
  enabled?: boolean
}

// Every stored snapshot for one repository, newest first.
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
