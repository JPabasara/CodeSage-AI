"use client"

import { useSyncExternalStore } from "react"

import { clearQueryCache } from "@/lib/query-cache"

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
  clearQueryCache()
  epoch += 1
  emit()
}

/**
 * Whether workspace-bound reads may run: `loading` until the session answers,
 * `none` for a signed-in user with no workspace, `ready` once there is one.
 *
 * While it is not `ready` no workspace-bound request is sent at all — each would
 * only answer 409 WORKSPACE_REQUIRED, and a screen of those reads as broken.
 */
export type WorkspaceGate = "loading" | "none" | "ready"

export function gateFor(workspaceId: string | null | undefined): WorkspaceGate {
  if (workspaceId === undefined) return "loading"
  return workspaceId === null ? "none" : "ready"
}

export function useWorkspaceGate(): WorkspaceGate {
  return gateFor(useActiveWorkspaceId())
}

const SESSION_STALE_EVENT = "codesage:session-stale"

/**
 * The API said WORKSPACE_REQUIRED where the app believed it had a workspace —
 * the membership went away in another tab, say. Lock the screens now, and ask
 * the session to re-read so the rest of the app learns the real answer.
 */
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

/**
 * The active workspace id, or undefined while the session is still loading.
 * Null is a real answer: signed in, with no workspace yet.
 */
export function useActiveWorkspaceId() {
  return useSyncExternalStore(subscribe, readActiveWorkspaceId, () => undefined)
}
