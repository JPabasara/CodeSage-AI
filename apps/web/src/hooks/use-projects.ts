"use client"

import { useEffect } from "react"

import { getProjects } from "@/lib/api/client"
import type { Repo } from "@/lib/types"
import { useQuery, type MutableQueryState } from "./use-query"

const PROJECTS_CHANGED_EVENT = "codesage:projects-changed"

type ProjectsChanged =
  | { type: "connected"; repo: Repo }
  | { type: "removed"; repoId: string; remaining: Repo[] }

function publishProjectsChanged(detail: ProjectsChanged) {
  if (typeof window === "undefined") return
  window.dispatchEvent(
    new CustomEvent<ProjectsChanged>(PROJECTS_CHANGED_EVENT, { detail }),
  )
}

export function publishProjectConnected(repo: Repo) {
  publishProjectsChanged({ type: "connected", repo })
}

export function publishProjectRemoved(repoId: string, remaining: Repo[]) {
  publishProjectsChanged({ type: "removed", repoId, remaining })
}

/** Connected repositories kept coherent across every mounted project consumer. */
export function useProjects(): MutableQueryState<Repo[]> {
  const query = useQuery("projects", getProjects)
  const { reload, update } = query

  useEffect(() => {
    function onProjectsChanged(event: Event) {
      const change = (event as CustomEvent<ProjectsChanged>).detail
      if (change.type === "removed") {
        update(() =>
          change.remaining.filter((repo) => repo.id !== change.repoId),
        )
      } else {
        update((current) => [
          change.repo,
          ...(current ?? []).filter((repo) => repo.id !== change.repo.id),
        ])
      }

      // Reconcile every mounted consumer with the server after the immediate
      // update. This keeps the AppRail and Projects page on one coherent list.
      reload()
    }

    window.addEventListener(PROJECTS_CHANGED_EVENT, onProjectsChanged)
    return () =>
      window.removeEventListener(PROJECTS_CHANGED_EVENT, onProjectsChanged)
  }, [reload, update])

  return query
}
