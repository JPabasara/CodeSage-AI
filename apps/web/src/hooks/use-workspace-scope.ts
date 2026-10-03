"use client"

import { useSyncExternalStore } from "react"

import { clearQueryCache } from "@/lib/query-cache"

// Bumped on every workspace switch.
let epoch = 0

/** The active workspace, once the session has said. Null means onboarding. */
let activeWorkspaceId: string | null | undefined

const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function readWorkspaceEpoch() {
  return epoch
}

export function readActiveWorkspaceId() {
  return activeWorkspaceId
}

// Record what the server says the active workspace is.
export function noteActiveWorkspace(workspaceId: string | null | undefined) {
  const next = workspaceId ?? null
  if (next === activeWorkspaceId) return
  activeWorkspaceId = next
  emit()
}

// Drop everything read under the previous workspace.
export function invalidateWorkspaceScope() {
  clearQueryCache()
  epoch += 1
  emit()
}

export type WorkspaceGate = "loading" | "none" | "ready"

export function gateFor(workspaceId: string | null | undefined): WorkspaceGate {
  if (workspaceId === undefined) return "loading"
  return workspaceId === null ? "none" : "ready"
}

export function useWorkspaceGate(): WorkspaceGate {
  return gateFor(useActiveWorkspaceId())
}

const SESSION_STALE_EVENT = "codesage:session-stale"

export function noteWorkspaceMissing() {
  noteActiveWorkspace(null)
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(SESSION_STALE_EVENT))
  }
}

export function onSessionStale(listener: () => void) {
  window.addEventListener(SESSION_STALE_EVENT, listener)
  return () => window.removeEventListener(SESSION_STALE_EVENT, listener)
}

/** Test-only: put the store back to its initial state between renders. */
export function resetWorkspaceScope() {
  clearQueryCache()
  epoch = 0
  activeWorkspaceId = undefined
  emit()
}

export function useWorkspaceEpoch() {
  return useSyncExternalStore(subscribe, readWorkspaceEpoch, () => 0)
}

// The active workspace id, or undefined while the session is still loading.
export function useActiveWorkspaceId() {
  return useSyncExternalStore(subscribe, readActiveWorkspaceId, () => undefined)
}
