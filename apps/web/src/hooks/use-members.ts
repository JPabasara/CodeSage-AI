"use client"

import { getMembers } from "@/lib/api/client"
import type { MemberList } from "@/lib/types"
import { useQuery, type MutableQueryState } from "./use-query"

/**
 * The active workspace's members and pending invitations.
 *
 * Keyed through the workspace epoch like every read, so a switch drops the
 * previous workspace's people in the same render rather than after a fetch.
 */
export function useMembers(): MutableQueryState<MemberList> {
  return useQuery("members", getMembers)
}
