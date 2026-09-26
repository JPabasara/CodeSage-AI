"use client"

import { useEffect, useSyncExternalStore } from "react"

import { ACTIVITY_STALE_EVENT, getActivity } from "@/lib/api/client"
import type { Activity } from "@/lib/types"
import {
  readActiveWorkspaceId,
  readWorkspaceEpoch,
  useWorkspaceEpoch,
} from "./use-workspace-scope"

// What is running in the workspace right now, whoever started it — for the
// Activity menu in the top bar.
//
// One poll for the whole app, and only while something is listening. It asks
// often while work is in progress and rarely while the workspace is quiet, and
// not at all while the tab is hidden: this runs on every page, all day.

/** How often to ask while something is running. */
export const ACTIVITY_BUSY_MS = 4_000
/** How often to ask while the workspace is quiet. */
export const ACTIVITY_IDLE_MS = 20_000

let state: { epoch: number; data: Activity } | undefined
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setTimeout> | undefined
let inFlight = false

function notify() {
  for (const listener of listeners) listener()
}

function isBusy(data: Activity | undefined) {
  return Boolean(data && (data.scans.length > 0 || data.rescoring.length > 0))
}

function schedule(delay: number) {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => void poll(), delay)
}

async function poll() {
  timer = undefined
  if (listeners.size === 0 || inFlight) return
  const hidden = typeof document !== "undefined" && document.hidden
  if (hidden || !readActiveWorkspaceId()) {
    schedule(ACTIVITY_IDLE_MS)
    return
  }
  const epoch = readWorkspaceEpoch()
  inFlight = true
  try {
    const data = await getActivity()
    // A workspace switch while the request was out: the answer is about the
    // workspace we just left.
    if (epoch === readWorkspaceEpoch()) {
      state = { epoch, data }
      notify()
    }
  } catch {
    // The menu keeps its last answer; the next poll tries again.
  } finally {
    inFlight = false
  }
  if (listeners.size > 0) {
    schedule(isBusy(state?.data) ? ACTIVITY_BUSY_MS : ACTIVITY_IDLE_MS)
  }
}

/** Ask now — something just changed what the answer would be. */
export function refreshActivity() {
  if (listeners.size === 0) return
  if (timer) clearTimeout(timer)
  timer = undefined
  void poll()
}

function onVisible() {
  if (!document.hidden) refreshActivity()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (listeners.size === 1) {
    window.addEventListener(ACTIVITY_STALE_EVENT, refreshActivity)
    document.addEventListener("visibilitychange", onVisible)
    void poll()
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      if (timer) clearTimeout(timer)
      timer = undefined
      window.removeEventListener(ACTIVITY_STALE_EVENT, refreshActivity)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }
}

/** Tests only. */
export function resetActivity() {
  if (timer) clearTimeout(timer)
  timer = undefined
  state = undefined
  inFlight = false
  notify()
}

/**
 * What is running in the active workspace, or undefined before the first
 * answer. An answer about another workspace is never returned.
 */
export function useActivity(): Activity | undefined {
  const epoch = useWorkspaceEpoch()
  const current = useSyncExternalStore(
    subscribe,
    () => state,
    () => undefined,
  )
  // A workspace switch: ask about the new one straight away.
  useEffect(() => {
    refreshActivity()
  }, [epoch])
  return current && current.epoch === epoch ? current.data : undefined
}
