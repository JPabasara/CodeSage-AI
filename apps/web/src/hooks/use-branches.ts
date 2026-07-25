"use client"

import { getBranches } from "@/lib/api/client"
import type { Branch } from "@/lib/types"
import { useQuery, type QueryState } from "./use-query"

/** Branches for a repo, for the dashboard top-nav selector. */
export function useBranches(repoId: string): QueryState<Branch[]> {
  return useQuery(`branches:${repoId}`, () => getBranches(repoId))
}
