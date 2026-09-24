"use client"

import { usePathname, useRouter } from "next/navigation"
import { FolderGit2, FolderPlus } from "lucide-react"

import { Skeleton } from "@/components/ui/skeleton"
import {
  TopBarPicker,
  TopBarPickerAction,
} from "@/components/layout/top-bar-picker"
import { useProjects } from "@/hooks/use-projects"
import {
  repoIdFromDashboardPath,
  useSelectedProject,
} from "@/hooks/use-selected-project"

/**
 * The pages that are about one project. Elsewhere this control is hidden —
 * Profiles included: it configures every project from its own rail, so the
 * dashboard's project has no say there.
 */
export function isProjectPage(pathname: string) {
  return pathname.startsWith("/dashboard/")
}

/**
 * Which project of the active workspace a page is about.
 *
 * Switching keeps the kind of page: the Dashboard of one project becomes the
 * Dashboard of another, and History stays History. A bare URL is used on
 * purpose — the branch, a snapshot id and an open finding all belonged to the
 * project being left.
 */
export function ProjectSwitcher() {
  const router = useRouter()
  const pathname = usePathname()
  const { data: repos, loading } = useProjects()
  const { selectedProjectId, selectProject } = useSelectedProject({
    availableRepoIds: repos?.map((repo) => repo.id),
  })
  const activeId = repoIdFromDashboardPath(pathname) ?? selectedProjectId
  const active = repos?.find((repo) => repo.id === activeId)

  if (loading && !repos) {
    return (
      <Skeleton className="h-9 min-w-0 flex-1 bg-white/15 md:w-36 md:flex-none" />
    )
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
      icon={<FolderGit2 className="size-4" />}
      className="min-w-0 flex-1 md:w-auto md:max-w-48 md:flex-none"
      items={(repos ?? []).map((repo) => ({
        value: repo.id,
        label: repo.name,
        caption: repo.owner,
      }))}
      activeValue={active?.id}
      activeLabel={active ? active.name : "No project"}
      activeCaption={active?.owner}
      onSelect={onSelect}
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
