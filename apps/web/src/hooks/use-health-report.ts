"use client"

import { getHealthReport } from "@/lib/api/client"
import type { HealthReport } from "@/lib/types"
import { useQuery, type QueryState } from "./use-query"

/** The full dashboard payload for one repo + branch. Refetches on branch change. */
export function useHealthReport(
  repoId: string,
  branch: string,
): QueryState<HealthReport> {
  return useQuery(`health:${repoId}:${branch}`, () =>
    getHealthReport(repoId, branch),
  )
}
