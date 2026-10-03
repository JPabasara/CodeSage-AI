"use client"

import { useCallback, useSyncExternalStore } from "react"

// The branch last looked at, remembered per project.

export const SELECTED_BRANCH_KEY = "codesage.selectedBranch.v1"
const SELECTED_BRANCH_EVENT = "codesage:selected-branch"

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage
  } catch {
    return null
  }
}

function readMap(store: Storage): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(
      store.getItem(SELECTED_BRANCH_KEY) ?? "{}",
    )
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, string>)
      : {}
  } catch {
    return {} // corrupt value: behave as if nothing was remembered
  }
}

const keyFor = (workspaceId: string, repoId: string) =>
  `${workspaceId}:${repoId}`

export function readSelectedBranch(
  workspaceId: string | null | undefined,
  repoId: string,
  store: Storage | null = storage(),
): string | undefined {
  if (!workspaceId || !store) return undefined
  const value = readMap(store)[keyFor(workspaceId, repoId)]
  return typeof value === "string" && value ? value : undefined
}

export function writeSelectedBranch(
  workspaceId: string | null | undefined,
  repoId: string,
  branch: string,
  store: Storage | null = storage(),
) {
  if (!workspaceId || !store || !branch) return
  const map = readMap(store)
  const key = keyFor(workspaceId, repoId)
  if (map[key] === branch) return
  try {
    store.setItem(
      SELECTED_BRANCH_KEY,
      JSON.stringify({ ...map, [key]: branch }),
    )
  } catch {
    return // full or blocked: the choice is simply not remembered
  }
  window.dispatchEvent(new Event(SELECTED_BRANCH_EVENT))
}

function subscribe(listener: () => void) {
  window.addEventListener(SELECTED_BRANCH_EVENT, listener)
  window.addEventListener("storage", listener) // other tabs
  return () => {
    window.removeEventListener(SELECTED_BRANCH_EVENT, listener)
    window.removeEventListener("storage", listener)
  }
}

/** The remembered branch for one project, and a way to remember another. */
export function useSelectedBranch(
  workspaceId: string | null | undefined,
  repoId: string,
) {
  const stored = useSyncExternalStore(
    subscribe,
    () => readSelectedBranch(workspaceId, repoId),
    () => undefined,
  )
  const remember = useCallback(
    (branch: string) => writeSelectedBranch(workspaceId, repoId, branch),
    [workspaceId, repoId],
  )
  return { storedBranch: stored, rememberBranch: remember }
}
