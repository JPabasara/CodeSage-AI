import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

const SURFACE = "rounded-md border bg-card"

function KpiSkeleton() {
  return (
    <div className={cn(SURFACE, "flex flex-col gap-3 px-4.5 py-4")}>
      <Skeleton className="h-3.5 w-24" />
      <Skeleton className="h-8 w-20" />
      <Skeleton className="h-3 w-36" />
    </div>
  )
}

function CardSkeleton({ height }: Readonly<{ height: string }>) {
  return (
    <div className={cn(SURFACE, "flex flex-col gap-3 p-4.5")}>
      <div className="space-y-1.5">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-44" />
      </div>
      <Skeleton className={cn("w-full", height)} />
    </div>
  )
}

/** The dashboard body while its report loads: same shape as the Overview tab. */
export function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <p className="sr-only">Loading the dashboard…</p>
      <div className="flex h-11 items-end gap-6 border-b pb-2.5">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-24" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiSkeleton />
        <KpiSkeleton />
        <KpiSkeleton />
        <KpiSkeleton />
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <CardSkeleton height="h-52" />
        <CardSkeleton height="h-52" />
      </div>
    </div>
  )
}

/** The whole page while the route itself loads: the header too. */
export function DashboardPageSkeleton() {
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2.5">
          <Skeleton className="h-7 w-52" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <Skeleton className="h-10.5 w-40" />
      </div>
      <DashboardSkeleton />
    </>
  )
}
