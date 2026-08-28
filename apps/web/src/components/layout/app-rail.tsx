"use client" // uses usePathname → must be a Client Component

import { useEffect } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  FolderGit2,
  LayoutDashboard,
  History,
  SlidersHorizontal,
  LogOut,
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
import { ApiRequestError } from "@/lib/api/client"
import { DEMO_REPO_ID } from "@/lib/demo"
import { useSession } from "@/hooks/use-session"

type NavItem = {
  href: string
  label: string
  icon: LucideIcon
  isActive: (pathname: string) => boolean
}

/**
 * Which project the rail's dashboard rows point at.
 *
 * Pinning them to one id used to throw you out of the project you were reading:
 * open one repo, click Dashboard, and you were looking at another. The URL
 * already knows the answer, so read it from there. Off a dashboard route the
 * demo id stays the fallback, because these rows still have to lead somewhere.
 */
function currentRepoId(pathname: string): string {
  return /^\/dashboard\/([^/]+)/.exec(pathname)?.[1] ?? DEMO_REPO_ID
}

function navItems(repoId: string): NavItem[] {
  return [
    {
      href: "/projects",
      label: "Projects",
      icon: FolderGit2,
      isActive: (p) => p.startsWith("/projects"),
    },
    {
      href: `/dashboard/${repoId}`,
      label: "Dashboard",
      icon: LayoutDashboard,
      isActive: (p) => p.startsWith("/dashboard") && !p.endsWith("/history"),
    },
    {
      href: `/dashboard/${repoId}/history`,
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
  const nav = navItems(currentRepoId(pathname))
  // Below `md` the rail is a modal sheet and Next navigates without unmounting
  // it, so tapping a destination left the sheet covering the new page — and
  // everything behind a modal is aria-hidden. Closing on click rather than on a
  // pathname change also covers tapping the row you are already on.
  const { setOpenMobile } = useSidebar()

  // The API is the actual security boundary; this is a UX fallback so a
  // signed-out visitor is not left staring at an empty shell.
  useEffect(() => {
    if (error instanceof ApiRequestError && error.status === 401) {
      router.push("/login")
    }
  }, [error, router])

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-3 py-2 text-sm font-semibold">
        Code Sage AI
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {nav.map((item) => {
                const Icon = item.icon
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={item.isActive(pathname)}
                      tooltip={item.label}
                    >
                      <Link
                        href={item.href}
                        onClick={() => setOpenMobile(false)}
                      >
                        <Icon />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          {session ? (
            <SidebarMenuItem>
              <div
                className="text-muted-foreground truncate px-2 py-1.5 text-xs"
                title={session.email ?? undefined}
              >
                {session.name ?? session.email ?? "Signed in"}
              </div>
            </SidebarMenuItem>
          ) : null}
          <SidebarMenuItem>
            {/*
              A form the browser submits, not a fetch. Sign-out has to end the
              session at the identity provider too, and it can only clear its own
              cookie if the browser actually goes there — so the API answers with
              a redirect the browser must be free to follow.

              POST, not a link: a GET is prefetchable, and ending a session must
              not fire on a guess.
            */}
            <form action={`${API_BASE}/api/auth/logout`} method="POST">
              <SidebarMenuButton type="submit" tooltip="Sign out">
                <LogOut />
                <span>Sign out</span>
              </SidebarMenuButton>
            </form>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
