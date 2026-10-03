"use client"

import { useCallback, useEffect, useState } from "react"

import { getWorkspaces, switchWorkspace } from "@/lib/api/client"
import type { Workspace } from "@/lib/types"
import { useQuery, type MutableQueryState } from "./use-query"
import { clearSelectedProjectId } from "./use-selected-project"
import {
  invalidateWorkspaceScope,
  noteActiveWorkspace,
  useActiveWorkspaceId,
} from "./use-workspace-scope"

const WORKSPACES_CHANGED_EVENT = "codesage:workspaces-changed"

// Say that a workspace's own details changed — a rename, a new description.
export function publishWorkspacesChanged() {
  if (typeof window === "undefined") return
  window.dispatchEvent(new Event(WORKSPACES_CHANGED_EVENT))
}

// The workspaces this user can switch to, kept coherent across every mounted consumer.
export function useWorkspaces(): MutableQueryState<Workspace[]> {
  const query = useQuery("workspaces", getWorkspaces, { scope: "account" })
  const { reload } = query

  useEffect(() => {
    const onChanged = () => reload()
    window.addEventListener(WORKSPACES_CHANGED_EVENT, onChanged)
    return () => window.removeEventListener(WORKSPACES_CHANGED_EVENT, onChanged)
  }, [reload])

  return query
}

/** The workspace this session is bound to, as the API reports it. */
export function useActiveWorkspace(workspaces: Workspace[] | undefined) {
  const activeId = useActiveWorkspaceId()
  return (
    workspaces?.find((workspace) => workspace.is_active) ??
    workspaces?.find((workspace) => workspace.workspace_id === activeId)
  )
}

// Switch the session to another workspace.
export function useWorkspaceSwitch() {
  const [switchingTo, setSwitchingTo] = useState<string>()

  const switchTo = useCallback(async (workspaceId: string) => {
    setSwitchingTo(workspaceId)
    try {
      const workspace = await switchWorkspace(workspaceId)
      noteActiveWorkspace(workspace.workspace_id)
      invalidateWorkspaceScope()
      return workspace
    } finally {
      setSwitchingTo(undefined)
    }
  }, [])

  return { switchTo, switchingTo }
}

// Adopt a workspace this session has just created or joined.
export function adoptWorkspace(workspace: Workspace) {
  noteActiveWorkspace(workspace.workspace_id)
  invalidateWorkspaceScope()
}

// Forget every browser-side reference to a workspace the API just deleted.
export function leaveDeletedWorkspace(workspaceId: string) {
  clearSelectedProjectId(workspaceId)
  noteActiveWorkspace(null)
  invalidateWorkspaceScope()
}
