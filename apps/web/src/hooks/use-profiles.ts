"use client"

import { getProfiles, getProjectProfile } from "@/lib/api/client"
import type { ProjectProfile, ScoreProfile } from "@/lib/types"
import { useQuery, type MutableQueryState } from "./use-query"

// The workspace profile pool — three built-ins plus up to five custom profiles.
export function useProfilePool(): MutableQueryState<ScoreProfile[]> {
  return useQuery("profiles", getProfiles)
}

export function useProjectProfile(
  repoId: string | undefined,
): MutableQueryState<ProjectProfile | undefined> {
  return useQuery(
    repoId ? `projects/${repoId}/profile` : "projects/none",
    () => (repoId ? getProjectProfile(repoId) : Promise.resolve(undefined)),
  )
}
