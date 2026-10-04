"use client"

import { GitBranch } from "lucide-react"

import { Skeleton } from "@/components/ui/skeleton"
import { TopBarPicker } from "@/components/layout/top-bar-picker"
import { useActiveBranch, useChangeBranch } from "@/hooks/use-active-branch"
import { relativeTime } from "@/lib/utils"

// Which branch of the project the dashboard shows. Dashboard pages only.
export function BranchSwitcher({ repoId }: Readonly<{ repoId: string }>) {
  const { branches, activeBranch } = useActiveBranch(repoId)
  const changeBranch = useChangeBranch(repoId)

  if (!branches) {
    return (
      <Skeleton
        className="h-9 w-28 bg-tb-hover"
        aria-label="Loading branches"
      />
    )
  }

  return (
    <TopBarPicker
      tourTarget="branch-selector"
      label="Branch"
      ariaLabel="Branch"
      icon={<GitBranch />}
      mono
      heading="Branches"
      items={branches.map((branch) => {
        const committed = relativeTime(branch.head_commit_at)
        return {
          value: branch.name,
          label: branch.name,
          mono: true,
          caption: [
            branch.is_default ? "Default branch" : undefined,
            committed ? `Last commit ${committed}` : undefined,
          ]
            .filter(Boolean)
            .join(" · "),
        }
      })}
      activeValue={activeBranch}
      activeLabel={activeBranch || "No branches"}
      onSelect={(branch) => {
        if (branch !== activeBranch) changeBranch(branch)
      }}
      emptyMessage="This repository has no branches yet."
      className="max-w-56"
    />
  )
}
