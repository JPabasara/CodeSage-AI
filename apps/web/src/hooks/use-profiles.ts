"use client"

import { getActiveProfile, getProfiles } from "@/lib/api/client"
import type { ScoreProfile } from "@/lib/types"
import { useQuery, type QueryState } from "./use-query"

/** The presets available to seed the sliders from. */
export function useProfiles(): QueryState<ScoreProfile[]> {
  return useQuery("profiles", getProfiles)
}

/**
 * The profile actually in force.
 *
 * The Profiles screen reads this on load so the sliders open showing what is
 * really applied, rather than a client-side guess at which preset is selected.
 */
export function useActiveProfile(): QueryState<ScoreProfile> {
  return useQuery("profiles/active", getActiveProfile)
}
