import {
  SidebarProvider,
  SidebarInset,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import Image from "next/image"
import { TooltipProvider } from "@/components/ui/tooltip"
import { AppRail } from "@/components/layout/app-rail"
import { SessionGuard } from "@/components/layout/session-guard"
import { WorkspaceGate } from "@/components/workspace/no-workspace-state"

export default function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <TooltipProvider>
      <SidebarProvider className="h-svh min-h-0 overflow-hidden">
        {/* Renders nothing. It decides whether this visitor belongs in the app
            shell at all: signed out goes to /login. Signed in with no
            workspace stays — WorkspaceGate below shows each page's locked
            card instead of its content. */}
        <SessionGuard />
        <AppRail />
        <SidebarInset className="h-svh min-h-0 overflow-hidden">
          {/*
            THE APP HAD NO NAVIGATION BELOW `md`. Under 768px the rail stops
            being a column and becomes a Sheet that starts closed, and Radix
            does not even mount its contents until something opens it — so
            every rail link was absent from the page, not merely off-screen.
            `SidebarProvider` binds Ctrl/Cmd+B, which is not a control a phone
            has. Nothing else in the tree rendered a `SidebarTrigger`, so
            whichever screen you landed on was the only screen you could reach.

            Hidden from `md` up, where the rail is already open and this bar
            would only cost a row of vertical space above the dashboard.
          */}
          <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3 md:hidden">
            <SidebarTrigger />
            <Image
              src="/codesage-refactor-branch-mark.svg"
              alt=""
              width={24}
              height={24}
              className="size-6"
            />
            <span className="text-sm font-semibold">CodeSage AI</span>
          </header>
          <main
            id="main-content"
            tabIndex={-1}
            className="min-h-0 flex-1 overflow-y-auto outline-none"
          >
            <WorkspaceGate>{children}</WorkspaceGate>
          </main>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  )
}
