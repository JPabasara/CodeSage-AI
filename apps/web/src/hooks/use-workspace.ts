"use client"

import { useCallback, useEffect, useState } from "react"

import { getWorkspaces, switchWorkspace } from "@/lib/api/client"
import type { Workspace } from "@/lib/types"
import { useQuery, type MutableQueryState } from "./use-query"
import {
  invalidateWorkspaceScope,
  noteActiveWorkspace,
  useActiveWorkspaceId,
} from "./use-workspace-scope"

const WORKSPACES_CHANGED_EVENT = "codesage:workspaces-changed"

/**
 * Say that a workspace's own details changed — a rename, a new description.
 *
 * Reads are per hook instance, not a shared cache, so the Workspace screen
 * reloading its own copy left the rail's switcher showing the old name until
 * the next navigation. Renaming something and watching the name not change is
 * the kind of thing that reads as data loss.
 *
 * Switching and creating need no event: both bump the workspace epoch, which
 * changes every query key at once.
 */
export function publishWorkspacesChanged() {
  if (typeof window === "undefined") return
  window.dispatchEvent(new Event(WORKSPACES_CHANGED_EVENT))
}

/**
 * The workspaces this user can switch to, kept coherent across every mounted
 * consumer.
 *
 * Every summary carries the caller's role in that workspace and its project and
 * member counts, so the switcher and the Workspace screen both render from this
 * one read rather than asking per workspace.
 */
export function useWorkspaces(): MutableQueryState<Workspace[]> {
  const query = useQuery("workspaces", getWorkspaces)
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

/**
 * Switch the session to another workspace.
 *
 * The order matters and is the whole reason this is a hook rather than a call:
 *
 *  1. the server switches first — until it accepts, the session is still in the
 *     old workspace and any read would return the old workspace's data;
 *  2. then the scope is invalidated, which drops every cached read in one
 *     render, so nothing from the previous workspace is ever on screen under
 *     the new workspace's name;
 *  3. then the caller decides where to navigate.
 */
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

/**
 * Adopt a workspace this session has just created or joined.
 *
 * Same invalidation as a switch — a brand-new workspace is empty, and the
 * previous workspace's projects must not linger on the way in.
 */
export function adoptWorkspace(workspace: Workspace) {
  noteActiveWorkspace(workspace.workspace_id)
  invalidateWorkspaceScope()
}
