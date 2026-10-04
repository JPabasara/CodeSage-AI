"use client"

import { useCallback } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

import { useBranches } from "./use-branches"
import { useProjects } from "./use-projects"
import { useSelectedBranch } from "./use-selected-branch"
import { useActiveWorkspaceId } from "./use-workspace-scope"

/**
 * The branch a project's dashboard shows, worked out the same way wherever it
 * is asked: the dashboard itself and the branch picker in the top bar.
 *
 * The URL wins, then the branch last looked at, then the repository's default.
 * Until the branch list lands, the remembered or default branch is used so the
 * report can load alongside it.
 */
export function useActiveBranch(repoId: string) {
  const { data: branches, error: branchesError } = useBranches(repoId)
  const { data: repos } = useProjects()
  const repo = repos?.find((item) => item.id === repoId)
  const searchParams = useSearchParams()
  const branchFromUrl = searchParams.get("branch") ?? undefined
  const workspaceId = useActiveWorkspaceId()
  const { storedBranch, rememberBranch } = useSelectedBranch(
    workspaceId,
    repoId,
  )

  const branchNames = branches?.map((branch) => branch.name)
  const urlBranchAvailable = Boolean(
    branchFromUrl && (!branchNames || branchNames.includes(branchFromUrl)),
  )
  const rememberedBranch =
    branchNames && storedBranch && branchNames.includes(storedBranch)
      ? storedBranch
      : undefined
  const defaultBranch =
    branches?.find((branch) => branch.is_default)?.name ?? branches?.[0]?.name
  const likelyBranch = branches
    ? undefined
    : (storedBranch ?? repo?.default_branch)
  const activeBranch =
    (urlBranchAvailable
      ? branchFromUrl
      : (rememberedBranch ?? defaultBranch ?? likelyBranch)) ?? ""
  const settledOnRealBranch = Boolean(branchNames?.includes(activeBranch))

  return {
    branches,
    branchesError,
    activeBranch,
    settledOnRealBranch,
    rememberBranch,
  }
}

/** Open another branch of the dashboard: the latest snapshot, no finding open. */
export function useChangeBranch(repoId: string) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const workspaceId = useActiveWorkspaceId()
  const { rememberBranch } = useSelectedBranch(workspaceId, repoId)

  return useCallback(
    (branch: string) => {
      rememberBranch(branch)
      const next = new URLSearchParams(searchParams.toString())
      next.set("branch", branch)
      next.delete("snapshot_id")
      next.delete("finding")
      const base = pathname.startsWith(`/dashboard/${repoId}`)
        ? pathname
        : `/dashboard/${repoId}`
      router.push(`${base}?${next.toString()}`, { scroll: false })
    },
    [pathname, repoId, rememberBranch, router, searchParams],
  )
}
