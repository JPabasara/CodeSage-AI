"use client"; // uses usePathname → must be a Client Component

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  FolderGit2,
  LayoutDashboard,
  History,
  SlidersHorizontal,
  Users,
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
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  isActive: (pathname: string) => boolean;
  badge?: string;
};

const NAV: NavItem[] = [
  {
    href: "/projects",
    label: "Projects",
    icon: FolderGit2,
    isActive: (p) => p.startsWith("/projects"),
  },
  {
    // hardcoded id until Phase 9 wires the actually-selected project
    href: "/dashboard/demo-repo",
    label: "Dashboard",
    icon: LayoutDashboard,
    isActive: (p) => p.startsWith("/dashboard") && !p.endsWith("/history"),
  },
  {
    href: "/dashboard/demo-repo/history",
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
  {
    href: "/team",
    label: "Team",
    icon: Users,
    badge: "v2",
    isActive: (p) => p.startsWith("/team"),
  },
];

export function AppRail() {
  const pathname = usePathname();

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
                    {item.badge ? <SidebarMenuBadge>{item.badge}</SidebarMenuBadge> : null}
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            {/* stub for now — Phase 8+ turns this into a real menu (Sign out / Settings / Billing) */}
            <SidebarMenuButton tooltip="Account">
              <LogOut />
              <span>Account</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
