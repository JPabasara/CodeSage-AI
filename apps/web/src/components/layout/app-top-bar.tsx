"use client"

import { Suspense } from "react"
import Image from "next/image"
import Link from "next/link"
import { usePathname } from "next/navigation"

import { SidebarTrigger } from "@/components/ui/sidebar"
import { AccountMenu } from "@/components/layout/account-menu"
import { BranchSwitcher } from "@/components/layout/branch-switcher"
import {
  isProjectPage,
  ProjectSwitcher,
} from "@/components/layout/project-switcher"
import { TopBarSeparator } from "@/components/layout/top-bar-picker"
import { ActivityMenu } from "@/components/layout/activity-menu"
import { WorkspaceSwitcher } from "@/components/layout/workspace-switcher"
import { repoIdFromDashboardPath } from "@/hooks/use-selected-project"
import { useActiveWorkspace, useWorkspaces } from "@/hooks/use-workspace"
import { useWorkspaceGate } from "@/hooks/use-workspace-scope"

/**
 * Where you are, never what you do: the brand, the context path
 * (Workspace / Project / Branch), work in progress and the account. Page
 * actions live in each page's header, so this bar is the same on every page.
 */
export function AppTopBar() {
  const pathname = usePathname()
  const { data: workspaces, loading } = useWorkspaces()
  const workspace = useActiveWorkspace(workspaces)
  const ready = useWorkspaceGate() === "ready"
  const repoId = repoIdFromDashboardPath(pathname)
  const showProject = ready && isProjectPage(pathname)
  // The branch belongs to the dashboard; Scan History filters branches itself.
  const showBranch = showProject && repoId && !pathname.endsWith("/history")

  return (
    <header
      data-testid="app-top-bar"
      className="z-20 shrink-0 bg-tb-bg text-tb-fg shadow-[inset_0_-1px_0_var(--tb-line)]"
    >
      <div className="flex min-h-15 flex-wrap items-stretch md:h-15 md:flex-nowrap">
        {/* The brand zone lines up with the rail below it. */}
        <div className="order-1 flex h-15 shrink-0 items-center gap-1 pr-1 pl-2 md:w-(--sidebar-width) md:bg-tb-brand md:px-3 md:shadow-[inset_-1px_0_0_var(--tb-line)]">
          <SidebarTrigger className="text-tb-fg hover:bg-tb-hover hover:text-tb-fg md:hidden" />
          <Link
            href="/overview"
            className="flex items-center gap-2.5 rounded-md px-1.5 py-1 outline-none focus-visible:ring-2 focus-visible:ring-tb-focus"
          >
            <Image
              src="/codesage-refactor-branch-mark.svg"
              alt=""
              width={30}
              height={30}
              className="size-7.5"
              priority
            />
            <span className="hidden text-base font-semibold tracking-tight sm:inline">
              CodeSage
            </span>
          </Link>
        </div>

        <nav
          aria-label="Context"
          className="order-1 flex h-15 min-w-0 flex-1 items-center pl-1 md:flex-none md:pl-3"
        >
          <WorkspaceSwitcher workspaces={workspaces} loading={loading} />
        </nav>

        {/* The project and branch: a second row on phones, the same path from md up. */}
        {showProject ? (
          <div className="order-3 flex w-full min-w-0 items-center border-t border-tb-line px-1 pb-1 md:order-2 md:w-auto md:border-0 md:p-0">
            <TopBarSeparator className="hidden md:inline" />
            <ProjectSwitcher workspaceName={workspace?.name} />
            {showBranch ? (
              <>
                <TopBarSeparator />
                <Suspense fallback={null}>
                  <BranchSwitcher repoId={repoId} />
                </Suspense>
              </>
            ) : null}
          </div>
        ) : null}

        <div className="order-2 ml-auto flex h-15 shrink-0 items-center gap-2 pr-3 pl-2 md:order-3 md:pr-4">
          {ready ? <ActivityMenu /> : null}
          <AccountMenu />
        </div>
      </div>
    </header>
  )
}
