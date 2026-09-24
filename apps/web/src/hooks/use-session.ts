"use client"

import { useEffect } from "react"

import { getSession } from "@/lib/api/client"
import type { Session } from "@/lib/types"
import { useQuery, type QueryState } from "./use-query"
import { noteActiveWorkspace, onSessionStale } from "./use-workspace-scope"

/** Who is signed in — powers the rail's identity display and the 401 bounce to /login. */
export function useSession(): QueryState<Session> {
  const query = useQuery("session", getSession, { scope: "account" })
  const { reload } = query
  const workspaceId = query.data?.workspace_id

  // The session is where the active workspace is learned first-hand, so this is
  // where the rest of the app is told. In an effect, not in render: the store is
  // shared, and writing to it while rendering would update other components
  // mid-render.
  useEffect(() => {
    if (query.data) noteActiveWorkspace(workspaceId ?? null)
  }, [query.data, workspaceId])

  // Something learned the workspace is gone; re-read who we are.
  useEffect(() => onSessionStale(reload), [reload])

  return query
}
