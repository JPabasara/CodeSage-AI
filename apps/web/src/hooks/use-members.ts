"use client"

import { getMembers } from "@/lib/api/client"
import type { MemberList } from "@/lib/types"
import { useQuery, type MutableQueryState } from "./use-query"

// The active workspace's members and pending invitations.
export function useMembers(): MutableQueryState<MemberList> {
  return useQuery("members", getMembers)
}
