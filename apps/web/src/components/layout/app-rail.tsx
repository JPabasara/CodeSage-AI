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
//shadcn/ui components are Client Components, so we can use them here without "use client" directive
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
 * They used to be pinned to `DEMO_REPO_ID`, which meant the rail quietly threw
 * you out of the project you were reading: open `web-store`, click "Dashboard",
 * and you were looking at `acme-payments` instead — with the rail still marked
 * active, so nothing said you had moved.
 *
 * The URL already knows the answer, so read it from there. Off a dashboard
 * route there is nothing to read and the demo id stays the fallback, because
 * these two rows still have to lead somewhere from /projects and /profiles.
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
  // Below `md` the rail is a MODAL sheet, and Next navigates without unmounting
  // it — so tapping a destination left you on the new page with the sheet still
  // covering it, and Radix marks everything behind a modal aria-hidden, so a
  // screen reader could not reach the page either. Closing on click rather than
  // on a pathname change also covers tapping the row you are already on.
  const { setOpenMobile } = useSidebar()

  // The API is the actual security boundary (SEC-10) — this is a UX fallback so
  // a signed-out visitor is not left staring at a shell with nothing on it,
  // whether or not the session has simply expired underneath them.
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
              A form the browser submits, not a fetch — and that is the fix.

              Sign-out has to end the session at Asgardeo too, and Asgardeo can only
              clear its own cookie if the browser actually goes there. So the API
              answers with a redirect and the browser must be free to follow it; a
              background fetch stays on this page and cannot.

              It also removes a quieter bug: the old code awaited a fetch and then
              pushed to /login regardless, so a 401 looked exactly like success. A
              form submit leaves no response to ignore. POST, not a link, because a
              GET is prefetchable and ending a session must not fire on a guess.

              Phase 8+ turns this into a real account menu.
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
