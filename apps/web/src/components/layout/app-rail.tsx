"use client" // uses usePathname → must be a Client Component

import { useState } from "react"
import Link from "next/link"
import { useTheme } from "next-themes"
import { usePathname } from "next/navigation"
import {
  Building2,
  BookOpen,
  ChevronDown,
  ExternalLink,
  FolderGit2,
  LayoutDashboard,
  History,
  Lock,
  LifeBuoy,
  LogOut,
  Moon,
  SlidersHorizontal,
  Sun,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
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
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SignOutDialog,
  ThemeRadioItems,
} from "@/components/layout/account-menu"
import { DEMO_REPO_ID } from "@/lib/demo"
import { useProjects } from "@/hooks/use-projects"
import { useSelectedProject } from "@/hooks/use-selected-project"
import { useWorkspaceGate } from "@/hooks/use-workspace-scope"

type NavItem = {
  href: string
  label: string
  icon: LucideIcon
  isActive: (pathname: string) => boolean
  requiresWorkspace?: boolean
  tourTarget?: string
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
      tourTarget: "workspace-nav",
    },
    {
      href: "/projects",
      label: "Projects",
      icon: FolderGit2,
      isActive: (p) => p.startsWith("/projects"),
      tourTarget: "projects-nav",
    },
    {
      // With no project to name, the index says how to get one.
      href: repoId ? `/dashboard/${repoId}` : "/dashboard",
      label: "Dashboard",
      icon: LayoutDashboard,
      isActive: (p) => p.startsWith("/dashboard") && !p.endsWith("/history"),
    },
    {
      href: repoId ? `/dashboard/${repoId}/history` : "/dashboard/history",
      label: "Scan History",
      icon: History,
      isActive: (p) => p.endsWith("/history"),
    },
    {
      href: "/profiles",
      label: "Profiles",
      icon: SlidersHorizontal,
      isActive: (p) => p.startsWith("/profiles"),
      tourTarget: "profiles-nav",
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
  const [signingOut, setSigningOut] = useState(false)
  const [supportOpen, setSupportOpen] = useState(false)
  const { resolvedTheme } = useTheme()
  // The icon follows what is on screen, so "System default" shows sun or moon.
  const ThemeIcon = resolvedTheme === "dark" ? Moon : Sun
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
                  const itemLocked = locked && item.requiresWorkspace !== false
                  return (
                    <SidebarMenuItem key={item.label}>
                      <SidebarMenuButton
                        asChild
                        isActive={item.isActive(pathname)}
                        tooltip={item.label}
                        className="h-9 text-sm"
                      >
                        <Link
                          href={item.href}
                          data-tour={item.tourTarget}
                          onClick={() => setOpenMobile(false)}
                          title={
                            itemLocked ? "Create a workspace first" : undefined
                          }
                        >
                          <Icon />
                          <span className="group-data-[collapsible=icon]:hidden">
                            {item.label}
                          </span>
                          {itemLocked ? (
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
                <SidebarMenuItem
                  onMouseEnter={() => setSupportOpen(true)}
                  onMouseLeave={() => setSupportOpen(false)}
                  onFocusCapture={() => setSupportOpen(true)}
                  onBlurCapture={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget)) {
                      setSupportOpen(false)
                    }
                  }}
                >
                  <SidebarMenuButton
                    type="button"
                    isActive={pathname.startsWith("/support")}
                    tooltip="Support"
                    className="h-9 text-sm"
                    data-tour="support-nav"
                    aria-expanded={supportOpen}
                    aria-controls="support-navigation"
                    onClick={() => setSupportOpen((open) => !open)}
                  >
                    <LifeBuoy />
                    <span className="group-data-[collapsible=icon]:hidden">
                      Support
                    </span>
                    <ChevronDown
                      aria-hidden="true"
                      className={`ml-auto transition-transform group-data-[collapsible=icon]:hidden ${supportOpen ? "rotate-180" : ""}`}
                    />
                  </SidebarMenuButton>
                  {supportOpen ? (
                    <SidebarMenuSub id="support-navigation">
                      <SidebarMenuSubItem>
                        <SidebarMenuSubButton asChild>
                          <Link
                            href="/guide"
                            target="_blank"
                            rel="noreferrer"
                            onClick={() => setOpenMobile(false)}
                          >
                            <BookOpen aria-hidden="true" />
                            <span>Product Guide</span>
                            <ExternalLink
                              className="ml-auto"
                              aria-hidden="true"
                            />
                          </Link>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                      <SidebarMenuSubItem>
                        <SidebarMenuSubButton
                          asChild
                          isActive={pathname.startsWith("/support")}
                        >
                          <Link
                            href="/support"
                            onClick={() => setOpenMobile(false)}
                          >
                            <Play aria-hidden="true" />
                            <span>New User Trial</span>
                          </Link>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    </SidebarMenuSub>
                  ) : null}
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </nav>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border/70">
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton tooltip="Theme" className="h-9 text-sm">
                  <ThemeIcon />
                  <span className="group-data-[collapsible=icon]:hidden">
                    Theme
                  </span>
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="right" align="end" className="w-44">
                <DropdownMenuLabel className="text-xs text-muted-foreground">
                  Theme
                </DropdownMenuLabel>
                <ThemeRadioItems />
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              type="button"
              tooltip="Sign out"
              className="h-9 text-sm"
              onClick={() => {
                setOpenMobile(false)
                setSigningOut(true)
              }}
            >
              <LogOut />
              <span className="group-data-[collapsible=icon]:hidden">
                Sign out…
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              type="button"
              onClick={toggleSidebar}
              tooltip={sidebarStateLabel}
              aria-label={sidebarStateLabel}
              title={sidebarStateLabel}
              className="hidden h-9 text-sm md:flex"
            >
              <SidebarStateIcon />
              <span className="group-data-[collapsible=icon]:hidden">
                {sidebarStateLabel}
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <SignOutDialog open={signingOut} onOpenChange={setSigningOut} />
      </SidebarFooter>
    </Sidebar>
  )
}
