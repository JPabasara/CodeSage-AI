"use client" // uses usePathname → must be a Client Component

import { useState, useSyncExternalStore } from "react"
import Link from "next/link"
import { useTheme } from "next-themes"
import { usePathname } from "next/navigation"
import {
  ChartColumn,
  CircleHelp,
  FolderGit2,
  LayoutDashboard,
  History,
  Lock,
  LogOut,
  Moon,
  SlidersHorizontal,
  Sun,
  PanelLeftClose,
  PanelLeftOpen,
  Users,
  type LucideIcon,
} from "lucide-react"
// shadcn/ui components are already Client Components.
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
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

const subscribeToHydration = () => () => {}
const clientHydrationSnapshot = () => true
const serverHydrationSnapshot = () => false

// What the whole workspace holds, then what one project shows.
const WORKSPACE_ITEMS: NavItem[] = [
  {
    href: "/overview",
    label: "Overview",
    icon: ChartColumn,
    isActive: (p) => p.startsWith("/overview"),
    tourTarget: "overview-nav",
  },
  {
    href: "/projects",
    label: "Projects",
    icon: FolderGit2,
    isActive: (p) => p.startsWith("/projects"),
    tourTarget: "projects-nav",
  },
  {
    href: "/profiles",
    label: "Scoring profiles",
    icon: SlidersHorizontal,
    isActive: (p) => p.startsWith("/profiles"),
    tourTarget: "profiles-nav",
  },
  {
    href: "/workspace",
    label: "Team & settings",
    icon: Users,
    isActive: (p) => p.startsWith("/workspace"),
    tourTarget: "workspace-nav",
  },
]

function projectItems(repoId: string | undefined): NavItem[] {
  return [
    {
      // With no project to name, the index says how to get one.
      href: repoId ? `/dashboard/${repoId}` : "/dashboard",
      label: "Dashboard",
      icon: LayoutDashboard,
      isActive: (p) => p.startsWith("/dashboard") && !p.endsWith("/history"),
    },
    {
      href: repoId ? `/dashboard/${repoId}/history` : "/dashboard/history",
      label: "Scan history",
      icon: History,
      isActive: (p) => p.endsWith("/history"),
    },
  ]
}

const SUPPORT_ITEM: NavItem = {
  href: "/help",
  label: "Support",
  icon: CircleHelp,
  isActive: (p) => p.startsWith("/help"),
  requiresWorkspace: false,
  tourTarget: "support-nav",
}

const groupLabel =
  "h-7 px-2 pt-2 text-[0.75rem] font-semibold tracking-[0.08em] text-muted-foreground uppercase"

export function AppRail() {
  const pathname = usePathname()
  const locked = useWorkspaceGate() === "none"
  const { data: repos } = useProjects()
  const { selectedProjectId } = useSelectedProject({
    availableRepoIds: repos?.map((repo) => repo.id),
    demoRepoId: DEMO_FALLBACK_ID,
  })
  const selectedRepo = repos?.find((repo) => repo.id === selectedProjectId)
  const { setOpenMobile, state, toggleSidebar } = useSidebar()
  const sidebarCollapsed = state === "collapsed"
  const SidebarStateIcon = sidebarCollapsed ? PanelLeftOpen : PanelLeftClose
  const [signingOut, setSigningOut] = useState(false)
  const themeMounted = useSyncExternalStore(
    subscribeToHydration,
    clientHydrationSnapshot,
    serverHydrationSnapshot,
  )
  const { resolvedTheme } = useTheme()
  const ThemeIcon = themeMounted && resolvedTheme === "dark" ? Moon : Sun
  const sidebarStateLabel = sidebarCollapsed
    ? "Expand sidebar"
    : "Collapse sidebar"

  return (
    // Offset below the fixed app bar on desktop; below `md` the rail is a sheet and ignores this.
    <Sidebar
      collapsible="icon"
      className="top-15 h-[calc(100svh-3.75rem)] border-sidebar-border/80"
    >
      <SidebarContent className="pt-2">
        <nav aria-label="Main navigation">
          <SidebarGroup>
            <SidebarGroupLabel className={groupLabel}>
              Workspace
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {WORKSPACE_ITEMS.map((item) => (
                  <RailItem
                    key={item.label}
                    item={item}
                    pathname={pathname}
                    locked={locked}
                    onNavigate={() => setOpenMobile(false)}
                  />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          {/* A project's own pages, once there is a project to show. */}
          {selectedProjectId || locked ? (
            <SidebarGroup>
              <SidebarGroupLabel className={groupLabel}>
                <span>Project</span>
                {selectedRepo ? (
                  <span className="ml-1.5 truncate font-medium tracking-normal text-sidebar-foreground normal-case">
                    · {selectedRepo.name}
                  </span>
                ) : null}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {projectItems(selectedProjectId).map((item) => (
                    <RailItem
                      key={item.label}
                      item={item}
                      pathname={pathname}
                      locked={locked}
                      onNavigate={() => setOpenMobile(false)}
                    />
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ) : null}
        </nav>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border/70">
        <SidebarMenu>
          <RailItem
            item={SUPPORT_ITEM}
            pathname={pathname}
            locked={locked}
            onNavigate={() => setOpenMobile(false)}
          />
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton tooltip="Theme" className="h-9 text-sm">
                  <ThemeIcon />
                  <span className="group-data-[collapsible=icon]:sr-only">
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
              <span className="group-data-[collapsible=icon]:sr-only">
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

function RailItem({
  item,
  pathname,
  locked,
  onNavigate,
}: Readonly<{
  item: NavItem
  pathname: string
  locked: boolean
  onNavigate: () => void
}>) {
  const Icon = item.icon
  const itemLocked = locked && item.requiresWorkspace !== false
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={item.isActive(pathname)}
        tooltip={item.label}
        className="h-9.5 text-sm data-[active=true]:font-semibold"
      >
        <Link
          href={item.href}
          data-tour={item.tourTarget}
          onClick={onNavigate}
          title={itemLocked ? "Create a workspace first" : undefined}
        >
          <Icon />
          <span className="group-data-[collapsible=icon]:sr-only">
            {item.label}
          </span>
          {itemLocked ? (
            <>
              <Lock
                className="ml-auto size-3.5! text-muted-foreground group-data-[collapsible=icon]:hidden"
                aria-hidden="true"
              />
              <span className="sr-only">(create a workspace first)</span>
            </>
          ) : null}
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}
