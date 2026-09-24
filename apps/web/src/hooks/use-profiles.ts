"use client"

import { getProfiles, getProjectProfile } from "@/lib/api/client"
import type { ProjectProfile, ScoreProfile } from "@/lib/types"
import { useQuery, type MutableQueryState } from "./use-query"

/**
 * The workspace profile pool — three built-ins plus up to five custom profiles.
 *
 * There is no separate read for the workspace default: every entry carries
 * `is_active`, so the default is a property of the pool rather than a second
 * request that could disagree with it.
 *
 * `update` is what a write uses to put the server's own response on screen
 * immediately; `reload` then reconciles the counts (`usage_count`, and which row
 * is `is_active`) that only the server can recompute.
 */
export function useProfilePool(): MutableQueryState<ScoreProfile[]> {
  return useQuery("profiles", getProfiles)
}

/**
 * What one project is scored with: the effective profile, the workspace default
 * and the override if there is one.
 *
 * `repoId` may be undefined — a workspace with no connected projects has nothing
 * to ask about. That resolves to `undefined` data rather than skipping the hook,
 * because a hook cannot be called conditionally.
 */
export function useProjectProfile(
  repoId: string | undefined,
): MutableQueryState<ProjectProfile | undefined> {
  return useQuery(
    repoId ? `projects/${repoId}/profile` : "projects/none",
    () => (repoId ? getProjectProfile(repoId) : Promise.resolve(undefined)),
  )
}
