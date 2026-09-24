"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

import { Skeleton } from "@/components/ui/skeleton"
import { NoProjectState } from "@/components/projects/no-project-state"
import { useProjects } from "@/hooks/use-projects"
import { useSelectedProject } from "@/hooks/use-selected-project"

/**
 * `/dashboard` and `/dashboard/history` without a project: go to the project
 * this workspace was last on, or — with no projects at all — say how to get
 * one. This is where the rail points when there is no project to name.
 */
export function ProjectRedirect({
  page,
}: Readonly<{ page: "dashboard" | "history" }>) {
  const router = useRouter()
  const { data: repos } = useProjects()
  const { selectedProjectId } = useSelectedProject({
    availableRepoIds: repos?.map((repo) => repo.id),
  })
  const target =
    repos && selectedProjectId
      ? page === "history"
        ? `/dashboard/${selectedProjectId}/history`
        : `/dashboard/${selectedProjectId}`
      : undefined

  useEffect(() => {
    if (target) router.replace(target)
  }, [router, target])

  if (repos && repos.length === 0) return <NoProjectState page={page} />
  return (
    <div className="space-y-4 p-6" aria-busy="true">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-64 w-full" />
    </div>
  )
}
