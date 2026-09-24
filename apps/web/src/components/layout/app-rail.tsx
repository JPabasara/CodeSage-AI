"use client" // uses usePathname → must be a Client Component

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Building2,
  FolderGit2,
  LayoutDashboard,
  History,
  Lock,
  SlidersHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  type LucideIcon,
} from "lucide-react"
// shadcn/ui components are already Client Components.
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { DEMO_REPO_ID } from "@/lib/demo"
import { useProjects } from "@/hooks/use-projects"
import { useSelectedProject } from "@/hooks/use-selected-project"
import { useWorkspaceGate } from "@/hooks/use-workspace-scope"

type NavItem = {
  href: string
  label: string
  icon: LucideIcon
  isActive: (pathname: string) => boolean
}

const MOCKING_MODE = process.env.NEXT_PUBLIC_API_MOCKING
const DEMO_FALLBACK_ID =
  MOCKING_MODE === "enabled" || MOCKING_MODE === "e2e"
    ? DEMO_REPO_ID
    : undefined

// Workspace first: it is the container everything below it belongs to.
function navItems(repoId: string | undefined): NavItem[] {
  return [
    {
      href: "/workspace",
      label: "Workspace",
      icon: Building2,
      isActive: (p) => p.startsWith("/workspace"),
    },
    {
      href: "/projects",
      label: "Projects",
      icon: FolderGit2,
      isActive: (p) => p.startsWith("/projects"),
    },
    {
      href: repoId ? `/dashboard/${repoId}` : "/projects",
      label: "Dashboard",
      icon: LayoutDashboard,
      isActive: (p) => p.startsWith("/dashboard") && !p.endsWith("/history"),
    },
    {
      href: repoId ? `/dashboard/${repoId}/history` : "/projects",
      label: "Scan History",
      icon: History,
      isActive: (p) => p.endsWith("/history"),
    },
    {
      href: "/profiles",
      label: "Profiles",
      icon: SlidersHorizontal,
      isActive: (p) => p.startsWith("/profiles"),
    },
  ]
}

export function AppRail() {
  const pathname = usePathname()
  // With no workspace every page is a "create one first" card; the rail says
  // so up front, but keeps each link so the user can see what is there.
  const locked = useWorkspaceGate() === "none"
  const { data: repos } = useProjects()
  const { selectedProjectId } = useSelectedProject({
    availableRepoIds: repos?.map((repo) => repo.id),
    demoRepoId: DEMO_FALLBACK_ID,
  })
  const nav = navItems(selectedProjectId)
  // Below `md` the rail is a modal sheet and Next navigates without unmounting
  // it, so tapping a destination left the sheet covering the new page — and
  // everything behind a modal is aria-hidden. Closing on click rather than on a
  // pathname change also covers tapping the row you are already on.
  const { setOpenMobile, state, toggleSidebar } = useSidebar()
  const sidebarCollapsed = state === "collapsed"
  const SidebarStateIcon = sidebarCollapsed ? PanelLeftOpen : PanelLeftClose
  const sidebarStateLabel = sidebarCollapsed
    ? "Expand sidebar"
    : "Collapse sidebar"

  return (
    // Offset below the fixed app bar on desktop; below `md` the rail is a sheet
    // and ignores this.
    <Sidebar
      collapsible="icon"
      className="top-14 h-[calc(100svh-3.5rem)] border-sidebar-border/80"
    >
      <SidebarContent className="pt-2">
        <nav aria-label="Main navigation">
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {nav.map((item) => {
                  const Icon = item.icon
                  return (
                    <SidebarMenuItem key={item.label}>
                      <SidebarMenuButton
                        asChild
                        isActive={item.isActive(pathname)}
                        size="lg"
                        tooltip={item.label}
                        className="text-sm"
                      >
                        <Link
                          href={item.href}
                          onClick={() => setOpenMobile(false)}
                          title={
                            locked ? "Create a workspace first" : undefined
                          }
                        >
                          <Icon />
                          <span className="group-data-[collapsible=icon]:hidden">
                            {item.label}
                          </span>
                          {locked ? (
                            <>
                              <Lock
                                className="ml-auto size-3.5! text-muted-foreground group-data-[collapsible=icon]:hidden"
                                aria-hidden="true"
                              />
                              <span className="sr-only">
                                (create a workspace first)
                              </span>
                            </>
                          ) : null}
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </nav>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border/70">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              type="button"
              onClick={toggleSidebar}
              tooltip={sidebarStateLabel}
              aria-label={sidebarStateLabel}
              title={sidebarStateLabel}
              className="hidden md:flex"
            >
              <SidebarStateIcon />
              <span className="group-data-[collapsible=icon]:hidden">
                {sidebarStateLabel}
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
