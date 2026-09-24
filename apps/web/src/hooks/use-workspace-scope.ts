"use client"

import { useSyncExternalStore } from "react"

// Which workspace the app is currently looking at, and a counter that changes
// whenever that answer changes.
//
// This is a module store rather than a context because `useQuery` reads it, and
// every data hook in the app is a one-liner over `useQuery`. One store means a
// workspace switch reaches all of them at once, instead of each hook being
// remembered — or forgotten — individually.

/**
 * Bumped on every workspace switch. `useQuery` folds it into its cache key, so
 * a switch changes *every* key at once: each hook drops the data it holds in the
 * same render and re-reads under the new workspace.
 *
 * A counter rather than the workspace id because the id is not known on the
 * first render — it arrives with the session — and keying on it would make every
 * screen fetch twice on load, once under "unknown" and once under the real id.
 */
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

/**
 * Record what the server says the active workspace is. Called from `useSession`,
 * which is the one place that learns it first-hand.
 */
export function noteActiveWorkspace(workspaceId: string | null | undefined) {
  const next = workspaceId ?? null
  if (next === activeWorkspaceId) return
  activeWorkspaceId = next
  emit()
}

/**
 * Drop everything read under the previous workspace.
 *
 * Called after the server has accepted the switch, never before: bumping first
 * would send every screen to re-read a workspace the session is not yet in.
 */
export function invalidateWorkspaceScope() {
  epoch += 1
  emit()
}

/** Test-only: put the store back to its initial state between renders. */
export function resetWorkspaceScope() {
  epoch = 0
  activeWorkspaceId = undefined
  emit()
}

export function useWorkspaceEpoch() {
  return useSyncExternalStore(subscribe, readWorkspaceEpoch, () => 0)
}

/**
 * The active workspace id, or undefined while the session is still loading.
 * Null is a real answer: signed in, with no workspace yet.
 */
export function useActiveWorkspaceId() {
  return useSyncExternalStore(subscribe, readActiveWorkspaceId, () => undefined)
}
