"use client" // uses usePathname → must be a Client Component

import { useEffect } from "react"
import Image from "next/image"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  FolderGit2,
  LayoutDashboard,
  History,
  SlidersHorizontal,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  UserRound,
  type LucideIcon,
} from "lucide-react"
// shadcn/ui components are already Client Components.
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { ThemeToggle } from "@/components/layout/theme-toggle"
import { ApiRequestError } from "@/lib/api/client"
import { DEMO_REPO_ID } from "@/lib/demo"
import { useSession } from "@/hooks/use-session"
import { useProjects } from "@/hooks/use-projects"
import { useSelectedProject } from "@/hooks/use-selected-project"

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

function navItems(repoId: string | undefined): NavItem[] {
  return [
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

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000"

export function AppRail() {
  const pathname = usePathname()
  const router = useRouter()
  const { data: session, error } = useSession()
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

  // The API is the actual security boundary; this is a UX fallback so a
  // signed-out visitor is not left staring at an empty shell.
  useEffect(() => {
    if (error instanceof ApiRequestError && error.status === 401) {
      router.push("/login")
    }
  }, [error, router])

  return (
    <Sidebar collapsible="icon" className="border-sidebar-border/80">
      <SidebarHeader className="px-2 py-4">
        <Link
          href="/projects"
          title="CodeSage AI"
          onClick={() => setOpenMobile(false)}
          className="flex min-w-0 items-center gap-2.5 rounded-md px-2 py-1.5 outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:h-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:py-0"
        >
          <Image
            src="/codesage-refactor-branch-mark.svg"
            alt=""
            width={32}
            height={32}
            className="size-8 shrink-0"
          />
          <span className="min-w-0 group-data-[collapsible=icon]:hidden">
            <span className="block truncate text-lg font-semibold leading-5">
              CodeSage AI
            </span>
            <span className="block truncate text-sm font-medium text-sidebar-foreground/55">
              Refactor-first analytics
            </span>
          </span>
        </Link>
      </SidebarHeader>

      <SidebarContent>
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
                        >
                          <Icon />
                          <span className="group-data-[collapsible=icon]:hidden">
                            {item.label}
                          </span>
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
          {session ? (
            <SidebarMenuItem>
              <div
                className="flex min-h-9 min-w-0 items-center gap-2 rounded-md border border-sidebar-border/70 bg-sidebar-accent/40 px-2 py-1.5 text-xs group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:min-h-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:border-0 group-data-[collapsible=icon]:p-0"
                title={session.email ?? undefined}
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-md bg-sidebar-primary/10 text-sidebar-primary">
                  <UserRound className="size-4" />
                </span>
                <span className="min-w-0 group-data-[collapsible=icon]:hidden">
                  <span className="block truncate font-medium text-sidebar-foreground">
                    {session.name ?? "Signed in"}
                  </span>
                  {session.email ? (
                    <span className="block truncate text-[0.625rem] text-sidebar-foreground/55">
                      {session.email}
                    </span>
                  ) : null}
                </span>
              </div>
            </SidebarMenuItem>
          ) : null}
          {/* FR-22's theme switch, in the account area the requirement names. */}
          <SidebarMenuItem>
            <ThemeToggle />
          </SidebarMenuItem>
          <SidebarMenuItem>
            {/*
              A form the browser submits, not a fetch. Sign-out has to end the
              session at the identity provider too, and it can only clear its own
              cookie if the browser actually goes there — so the API answers with
              a redirect the browser must be free to follow.

              POST, not a link: a GET is prefetchable, and ending a session must
              not fire on a guess.
            */}
            <form
              action={`${API_BASE}/api/auth/logout`}
              method="POST"
              className="min-w-0"
            >
              <SidebarMenuButton
                type="submit"
                tooltip="Sign out"
                className="min-w-0"
              >
                <LogOut />
                <span className="group-data-[collapsible=icon]:hidden">
                  Sign out
                </span>
              </SidebarMenuButton>
            </form>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
