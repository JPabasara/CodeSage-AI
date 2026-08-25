"use client"

import { getSession } from "@/lib/api/client"
import type { Session } from "@/lib/types"
import { useQuery, type QueryState } from "./use-query"

/** Who is signed in — powers the rail's identity display and the 401 bounce to /login. */
export function useSession(): QueryState<Session> {
  return useQuery("session", getSession)
}
