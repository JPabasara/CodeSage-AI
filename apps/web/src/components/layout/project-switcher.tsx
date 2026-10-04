"use client"

import { usePathname, useRouter } from "next/navigation"
import { FolderPlus } from "lucide-react"

import { Skeleton } from "@/components/ui/skeleton"
import {
  TopBarPicker,
  TopBarPickerAction,
} from "@/components/layout/top-bar-picker"
import { useProjects } from "@/hooks/use-projects"
import { cancelProjectPrefetch, prefetchProject } from "@/lib/prefetch-project"
import {
  repoIdFromDashboardPath,
  useSelectedProject,
} from "@/hooks/use-selected-project"
import type { LatestHealth } from "@/lib/types"
import { gradeColor } from "@/lib/utils"

// The pages that are about one project.
export function isProjectPage(pathname: string) {
  return pathname.startsWith("/dashboard/")
}

/** A project's latest grade and score, for its row in the picker. */
function HealthTag({ health }: Readonly<{ health?: LatestHealth | null }>) {
  if (!health) {
    return <span className="text-xs text-muted-foreground">Not scanned</span>
  }
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
      <span
        className="grid h-5 min-w-5 place-items-center rounded-sm px-1 text-[0.6875rem] font-semibold text-white"
        style={{ backgroundColor: gradeColor(health.grade) }}
      >
        {health.grade}
      </span>
      {Math.round(health.score)}
    </span>
  )
}

// Which project of the active workspace a page is about.
export function ProjectSwitcher({
  workspaceName,
}: Readonly<{
  /** For the list's heading; the top bar already knows it, so no second read. */
  workspaceName?: string
}>) {
  const router = useRouter()
  const pathname = usePathname()
  const { data: repos, loading } = useProjects()
  const { selectedProjectId, selectProject } = useSelectedProject({
    availableRepoIds: repos?.map((repo) => repo.id),
  })
  const activeId = repoIdFromDashboardPath(pathname) ?? selectedProjectId
  const active = repos?.find((repo) => repo.id === activeId)

  if (loading && !repos) {
    return <Skeleton className="h-9 w-32 bg-tb-hover" />
  }

  function onSelect(repoId: string) {
    if (repoId === activeId) return
    selectProject(repoId)
    if (pathname.startsWith("/dashboard/")) {
      router.push(
        pathname.endsWith("/history")
          ? `/dashboard/${repoId}/history`
          : `/dashboard/${repoId}`,
      )
    }
  }

  return (
    <TopBarPicker
      label="Project"
      heading={workspaceName ? `Projects in ${workspaceName}` : "Projects"}
      className="max-w-56"
      items={(repos ?? []).map((repo) => ({
        value: repo.id,
        label: repo.name,
        caption: `${repo.owner} · ${repo.default_branch}`,
        trailing: <HealthTag health={repo.latest_health} />,
      }))}
      activeValue={active?.id}
      activeLabel={active ? active.name : "No project"}
      onSelect={onSelect}
      onItemIntent={(repoId) => {
        const repo = repos?.find((item) => item.id === repoId)
        if (repo && repoId !== activeId) prefetchProject(repo, router.prefetch)
      }}
      onItemLeave={cancelProjectPrefetch}
      emptyMessage="No projects yet. Connect a repository to see it here."
      footer={(close) => (
        <TopBarPickerAction
          icon={<FolderPlus className="size-4" />}
          onSelect={() => {
            close()
            router.push("/projects")
          }}
        >
          Manage projects
        </TopBarPickerAction>
      )}
    />
  )
}
