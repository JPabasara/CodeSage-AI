"use client"

import { getProjects } from "@/lib/api/client"
import type { Repo } from "@/lib/types"
import { useQuery, type QueryState } from "./use-query"

/** The connected repositories, for the Projects screen. `reload()` after connecting one. */
export function useProjects(): QueryState<Repo[]> {
  return useQuery("projects", getProjects)
}
