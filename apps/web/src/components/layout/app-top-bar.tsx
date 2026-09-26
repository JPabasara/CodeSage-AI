"use client"

import Image from "next/image"
import Link from "next/link"
import { usePathname } from "next/navigation"

import { SidebarTrigger } from "@/components/ui/sidebar"
import { AccountMenu } from "@/components/layout/account-menu"
import {
  isProjectPage,
  ProjectSwitcher,
} from "@/components/layout/project-switcher"
import { TopBarSlot } from "@/components/layout/top-bar-slot"
import { ActivityMenu } from "@/components/layout/activity-menu"
import { WorkspaceSwitcher } from "@/components/layout/workspace-switcher"
import { useWorkspaces } from "@/hooks/use-workspace"
import { useWorkspaceGate } from "@/hooks/use-workspace-scope"

/**
 * The fixed app bar on every signed-in page: brand, the workspace (always), the
 * project (on pages about one project), the page's own controls, the account.
 *
 * Deep mint with white text in both themes. Below `md` it wraps: the project and
 * the page's context controls move to a second row, and the menu button opens
 * the rail as a sheet.
 */
export function AppTopBar() {
  const pathname = usePathname()
  const { data: workspaces, loading } = useWorkspaces()
  const ready = useWorkspaceGate() === "ready"
  const showProject = ready && isProjectPage(pathname)

  return (
    <header
      data-testid="app-top-bar"
      className="z-20 shrink-0 bg-topbar text-topbar-foreground"
    >
      <div className="flex min-h-14 flex-wrap items-center gap-x-2 gap-y-2 px-3 py-2.5 md:h-14 md:flex-nowrap md:py-0">
        <div className="order-1 flex min-w-0 flex-1 items-center gap-2 md:flex-none">
          <SidebarTrigger className="text-topbar-foreground hover:bg-white/15 hover:text-topbar-foreground md:hidden" />
          <Link
            href="/projects"
            className="flex shrink-0 items-center gap-2 rounded-md px-1 py-1 outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          >
            <Image
              src="/codesage-refactor-branch-mark.svg"
              alt=""
              width={28}
              height={28}
              className="size-7"
            />
            <span className="hidden text-sm font-semibold tracking-tight sm:inline">
              CodeSage
            </span>
          </Link>
          <span
            className="mx-1 hidden h-5 w-px bg-white/20 sm:block"
            aria-hidden="true"
          />
          <WorkspaceSwitcher workspaces={workspaces} loading={loading} />
        </div>

        {/* Row two on phones, inline from `md` up. */}
        <div className="order-3 flex w-full min-w-0 items-center gap-2 md:order-2 md:w-auto">
          {showProject ? (
            <>
              <span
                className="hidden text-topbar-foreground/35 md:inline"
                aria-hidden="true"
              >
                /
              </span>
              <ProjectSwitcher />
            </>
          ) : null}
          <TopBarSlot
            name="context"
            className="flex min-w-0 flex-1 items-center gap-2 empty:hidden md:flex-none"
          />
        </div>

        <div className="order-2 flex shrink-0 items-center gap-2 md:order-3 md:ml-auto">
          {ready ? <ActivityMenu /> : null}
          <TopBarSlot
            name="actions"
            className="flex items-center gap-2 empty:hidden"
          />
          <AccountMenu />
        </div>
      </div>
    </header>
  )
}
