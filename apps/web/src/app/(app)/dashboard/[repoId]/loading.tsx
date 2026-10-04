import { DashboardPageSkeleton } from "@/components/dashboard/dashboard-skeleton"
import { PAGE_CONTAINER } from "@/components/layout/page-container"
import { cn } from "@/lib/utils"

// The same frame the dashboard draws, so switching project goes straight to it.
export default function Loading() {
  return (
    <div className={cn(PAGE_CONTAINER, "gap-4")}>
      <DashboardPageSkeleton />
    </div>
  )
}
