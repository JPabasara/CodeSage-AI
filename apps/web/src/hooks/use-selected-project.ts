"use client"

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react"
import { usePathname } from "next/navigation"

export const SELECTED_PROJECT_KEY = "codesage.selectedProjectId"
const SELECTED_PROJECT_EVENT = "codesage:selected-project"

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
    if (event.key === SELECTED_PROJECT_KEY) listener()
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

export function readSelectedProjectId(store: Storage | null = storage()) {
  if (!store) return undefined
  try {
    const value = store.getItem(SELECTED_PROJECT_KEY)
    if (isValidProjectId(value)) return value ?? undefined
    if (value) store.removeItem(SELECTED_PROJECT_KEY)
  } catch {
    return undefined
  }
  return undefined
}

export function writeSelectedProjectId(
  repoId: string,
  store: Storage | null = storage(),
) {
  if (!isValidProjectId(repoId)) return undefined
  try {
    store?.setItem(SELECTED_PROJECT_KEY, repoId)
    emitSelectedProjectChanged()
  } catch {
    // Storage is a convenience, not the source of truth.
  }
  return repoId
}

export function clearSelectedProjectId(store: Storage | null = storage()) {
  try {
    store?.removeItem(SELECTED_PROJECT_KEY)
    emitSelectedProjectChanged()
  } catch {
    // Nothing to clear when storage is unavailable.
  }
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
  const urlRepoId = repoIdFromDashboardPath(pathname)
  const storedRepoId = useSyncExternalStore(
    subscribeSelectedProject,
    () => readSelectedProjectId(),
    () => undefined,
  )

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
      writeSelectedProjectId(urlRepoId)
      return
    }
    if (!selectedProjectId) return
    if (selectedProjectId !== storedRepoId) {
      writeSelectedProjectId(selectedProjectId)
    }
  }, [selectedProjectId, storedRepoId, urlRepoId])

  const selectProject = useCallback((repoId: string) => {
    return writeSelectedProjectId(repoId)
  }, [])

  const clearProject = useCallback(() => {
    clearSelectedProjectId()
  }, [])

  return {
    selectedProjectId,
    selectProject,
    clearProject,
  }
}
