import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"
import { AppRail } from "@/components/layout/app-rail"
import { AppTopBar } from "@/components/layout/app-top-bar"
import { TopBarSlotProvider } from "@/components/layout/top-bar-slot"
import { SessionGuard } from "@/components/layout/session-guard"
import { ScanCenter } from "@/components/layout/scan-center"
import { WorkspaceGate } from "@/components/workspace/no-workspace-state"
import { ProductTourProvider } from "@/components/tour/product-tour"

export default function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <TooltipProvider>
      <TopBarSlotProvider>
        {/* A column: the app bar across the top, the rail and the page below it. */}
        <SidebarProvider className="h-svh min-h-0 flex-col overflow-hidden">
          <ProductTourProvider>
            <SessionGuard />
            {/* Follows every scan across pages; says when one ends. */}
            <ScanCenter />
            <AppTopBar />
            <div className="flex min-h-0 flex-1">
              <AppRail />
              <SidebarInset className="min-h-0 overflow-hidden">
                <main
                  id="main-content"
                  tabIndex={-1}
                  className="min-h-0 flex-1 overflow-y-auto outline-none"
                >
                  <WorkspaceGate>{children}</WorkspaceGate>
                </main>
              </SidebarInset>
            </div>
          </ProductTourProvider>
        </SidebarProvider>
      </TopBarSlotProvider>
    </TooltipProvider>
  )
}
