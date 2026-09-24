"use client"

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react"
import { usePathname } from "next/navigation"

import { useActiveWorkspaceId } from "./use-workspace-scope"

/**
 * Which project is selected, per workspace.
 *
 * It used to be one id under one key. That was wrong the moment a user could
 * belong to two workspaces: switching carried the previous workspace's project
 * across, and the dashboard either 404'd or — worse, before the API was
 * tenant-isolated — showed something from the workspace you had just left.
 *
 * The value is a map of workspace id → repository id, so each workspace
 * remembers its own project and none of them can answer for another.
 */
export const SELECTED_PROJECT_KEY = "codesage.selectedProjectId.v2"

/** The pre-workspace key. Read once, migrated if it fits, then removed. */
export const LEGACY_SELECTED_PROJECT_KEY = "codesage.selectedProjectId"

const SELECTED_PROJECT_EVENT = "codesage:selected-project"

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type SelectionMap = Record<string, string>

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage
  } catch {
    return null
  }
}

function emitSelectedProjectChanged() {
  if (typeof window === "undefined") return
  window.dispatchEvent(new Event(SELECTED_PROJECT_EVENT))
}

function subscribeSelectedProject(listener: () => void) {
  if (typeof window === "undefined") return () => {}

  const onSelectedProject = () => listener()
  const onStorage = (event: StorageEvent) => {
    // Both keys: another tab may still be on the old build, and its write is
    // the one thing that can put the legacy key back after a migration.
    if (
      event.key === SELECTED_PROJECT_KEY ||
      event.key === LEGACY_SELECTED_PROJECT_KEY
    ) {
      listener()
    }
  }

  window.addEventListener(SELECTED_PROJECT_EVENT, onSelectedProject)
  window.addEventListener("storage", onStorage)
  return () => {
    window.removeEventListener(SELECTED_PROJECT_EVENT, onSelectedProject)
    window.removeEventListener("storage", onStorage)
  }
}

export function isValidProjectId(value: string | null | undefined): boolean {
  return typeof value === "string" && UUID_PATTERN.test(value)
}

/** The whole map, with anything that is not a uuid pair dropped on the way out. */
function readMap(store: Storage | null): SelectionMap {
  if (!store) return {}
  try {
    const raw = store.getItem(SELECTED_PROJECT_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== "object" || parsed === null) return {}
    const clean: SelectionMap = {}
    for (const [workspaceId, repoId] of Object.entries(parsed)) {
      if (isValidProjectId(workspaceId) && isValidProjectId(repoId)) {
        clean[workspaceId] = repoId as string
      }
    }
    return clean
  } catch {
    // Corrupt JSON is the same as no preference: the app has to start anyway.
    return {}
  }
}

function writeMap(store: Storage | null, map: SelectionMap) {
  try {
    if (Object.keys(map).length === 0) store?.removeItem(SELECTED_PROJECT_KEY)
    else store?.setItem(SELECTED_PROJECT_KEY, JSON.stringify(map))
    emitSelectedProjectChanged()
  } catch {
    // Storage is a convenience, not the source of truth.
  }
}

export function readSelectedProjectId(
  workspaceId: string | null | undefined,
  store: Storage | null = storage(),
) {
  if (!workspaceId || !store) return undefined
  return readMap(store)[workspaceId]
}

export function writeSelectedProjectId(
  repoId: string,
  workspaceId: string | null | undefined,
  store: Storage | null = storage(),
) {
  if (!isValidProjectId(repoId)) return undefined
  // Without a workspace there is nothing to key the choice by. Returning the id
  // keeps the caller's flow intact — the selection is simply not remembered.
  if (!workspaceId || !store) return repoId
  writeMap(store, { ...readMap(store), [workspaceId]: repoId })
  return repoId
}

export function clearSelectedProjectId(
  workspaceId: string | null | undefined,
  store: Storage | null = storage(),
) {
  if (!workspaceId || !store) return
  const map = readMap(store)
  if (!(workspaceId in map)) return
  delete map[workspaceId]
  writeMap(store, map)
}

/**
 * Move a pre-workspace selection under the workspace it belongs to.
 *
 * The old key held one id and no hint of which workspace it came from, so the
 * only honest test is whether the active workspace actually contains that
 * repository. That means waiting for the project list: migrating on a guess
 * would hand one workspace's project to another, which is the bug this key
 * change exists to prevent.
 *
 * Either way the legacy key is removed once the question can be answered, so
 * this runs at most once per browser.
 */
export function migrateLegacySelection(
  workspaceId: string | null | undefined,
  availableRepoIds: readonly string[] | undefined,
  store: Storage | null = storage(),
) {
  if (!store || !workspaceId || !availableRepoIds) return
  let legacy: string | null = null
  try {
    legacy = store.getItem(LEGACY_SELECTED_PROJECT_KEY)
  } catch {
    return
  }
  if (legacy === null) return

  const belongsHere =
    isValidProjectId(legacy) && availableRepoIds.includes(legacy)
  // An existing choice for this workspace was made under the new key and is
  // more recent than anything the old one holds.
  if (belongsHere && readSelectedProjectId(workspaceId, store) === undefined) {
    writeSelectedProjectId(legacy, workspaceId, store)
  }
  try {
    store.removeItem(LEGACY_SELECTED_PROJECT_KEY)
  } catch {
    // Nothing to do: the read above already decided the outcome.
  }
  emitSelectedProjectChanged()
}

export function repoIdFromDashboardPath(pathname: string) {
  const encoded = /^\/dashboard\/([^/]+)(?:\/history)?$/.exec(pathname)?.[1]
  if (!encoded) return undefined
  try {
    const repoId = decodeURIComponent(encoded)
    return isValidProjectId(repoId) ? repoId : undefined
  } catch {
    return undefined
  }
}

export function resolveSelectedProjectId({
  urlRepoId,
  storedRepoId,
  availableRepoIds,
  demoRepoId,
  fallbackToFirstAvailable = true,
}: {
  urlRepoId?: string
  storedRepoId?: string
  availableRepoIds?: readonly string[]
  demoRepoId?: string
  fallbackToFirstAvailable?: boolean
}) {
  const available = availableRepoIds?.filter(isValidProjectId)
  const isAvailable = (repoId: string) =>
    !available || available.includes(repoId)

  if (urlRepoId && isAvailable(urlRepoId)) return urlRepoId
  if (storedRepoId && isAvailable(storedRepoId)) return storedRepoId
  if (fallbackToFirstAvailable && available && available.length > 0) {
    return available[0]
  }
  if (demoRepoId && isValidProjectId(demoRepoId)) return demoRepoId
  return undefined
}

export function useSelectedProject({
  availableRepoIds,
  demoRepoId,
  fallbackToFirstAvailable = true,
}: {
  availableRepoIds?: readonly string[]
  demoRepoId?: string
  fallbackToFirstAvailable?: boolean
} = {}) {
  const pathname = usePathname()
  const workspaceId = useActiveWorkspaceId()
  const urlRepoId = repoIdFromDashboardPath(pathname)
  const storedRepoId = useSyncExternalStore(
    subscribeSelectedProject,
    () => readSelectedProjectId(workspaceId),
    () => undefined,
  )

  // Runs once per browser, as soon as there is both a workspace and a project
  // list to judge the old value against.
  useEffect(() => {
    migrateLegacySelection(workspaceId, availableRepoIds)
  }, [availableRepoIds, workspaceId])

  const selectedProjectId = useMemo(
    () =>
      resolveSelectedProjectId({
        urlRepoId,
        storedRepoId,
        availableRepoIds,
        demoRepoId,
        fallbackToFirstAvailable,
      }),
    [
      availableRepoIds,
      demoRepoId,
      fallbackToFirstAvailable,
      storedRepoId,
      urlRepoId,
    ],
  )

  useEffect(() => {
    if (urlRepoId) {
      writeSelectedProjectId(urlRepoId, workspaceId)
      return
    }
    if (!selectedProjectId) return
    if (selectedProjectId !== storedRepoId) {
      writeSelectedProjectId(selectedProjectId, workspaceId)
    }
  }, [selectedProjectId, storedRepoId, urlRepoId, workspaceId])

  const selectProject = useCallback(
    (repoId: string) => writeSelectedProjectId(repoId, workspaceId),
    [workspaceId],
  )

  const clearProject = useCallback(
    () => clearSelectedProjectId(workspaceId),
    [workspaceId],
  )

  return {
    selectedProjectId,
    selectProject,
    clearProject,
  }
}
