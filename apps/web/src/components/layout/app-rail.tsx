"use client"; // uses usePathname → must be a Client Component

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  FolderGit2,
  LayoutDashboard,
  History,
  SlidersHorizontal,
  LogOut,
  type LucideIcon,
} from "lucide-react";
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
} from "@/components/ui/sidebar";
import { ApiRequestError } from "@/lib/api/client";
import { DEMO_REPO_ID } from "@/lib/demo";
import { useSession } from "@/hooks/use-session";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  isActive: (pathname: string) => boolean;
};

const NAV: NavItem[] = [
  {
    href: "/projects",
    label: "Projects",
    icon: FolderGit2,
    isActive: (p) => p.startsWith("/projects"),
  },
  {
    // Hardcoded until a project picker exists; the rail has no way to know which
    // project you last opened. It is the demo repository's real id, so it points
    // at something the mock (and later the API) will actually serve.
    href: `/dashboard/${DEMO_REPO_ID}`,
    label: "Dashboard",
    icon: LayoutDashboard,
    isActive: (p) => p.startsWith("/dashboard") && !p.endsWith("/history"),
  },
  {
    href: `/dashboard/${DEMO_REPO_ID}/history`,
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
];

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

export function AppRail() {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session, error } = useSession();

  // The API is the actual security boundary (SEC-10) — this is a UX fallback so
  // a signed-out visitor is not left staring at a shell with nothing on it,
  // whether or not the session has simply expired underneath them.
  useEffect(() => {
    if (error instanceof ApiRequestError && error.status === 401) {
      router.push("/login");
    }
  }, [error, router]);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-3 py-2 text-sm font-semibold">Code Sage AI</SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.map((item) => {
                const Icon = item.icon;
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={item.isActive(pathname)} tooltip={item.label}>
                      <Link href={item.href}>
                        <Icon />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
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
  );
}
