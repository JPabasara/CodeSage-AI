import {
  SidebarProvider,
  SidebarInset,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"
import { AppRail } from "@/components/layout/app-rail"

export default function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppRail />
        <SidebarInset>
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
          <header className="flex h-12 items-center gap-2 border-b px-3 md:hidden">
            <SidebarTrigger />
            <span className="text-sm font-semibold">Code Sage AI</span>
          </header>
          {children}
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  )
}
