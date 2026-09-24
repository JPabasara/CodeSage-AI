import type { ReactNode } from "react"

import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

/**
 * The dashboard's grid, shared by the loaded page and its skeleton so the two
 * cannot drift apart: a wide left column (health, trend, then the ranked list)
 * and the file tree on the right. Below `lg` it is one column that scrolls.
 */
export const DASHBOARD_GRID =
  "grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 lg:grid-cols-[minmax(0,1.18fr)_minmax(19rem,0.82fr)] lg:overflow-hidden"
export const DASHBOARD_MAIN_COLUMN =
  "@container flex flex-col gap-4 lg:min-h-0 lg:overflow-hidden"
/** Health and trend side by side once the column has room for both. */
export const DASHBOARD_TOP_ROW = "grid shrink-0 gap-4 @2xl:grid-cols-2"
export const DASHBOARD_LIST_SLOT = "flex-1 lg:min-h-0 lg:overflow-hidden"
export const DASHBOARD_TREE_SLOT =
  "max-lg:h-[32rem] lg:min-h-0 lg:overflow-hidden"

const SURFACE = "rounded-lg border bg-card"

/** A card's header: a 15px title line and a caption line. */
function HeaderLines({ title = "w-28", caption = "w-40" }) {
  return (
    <div className="space-y-1">
      <div className="flex h-6 items-center">
        <Skeleton className={cn("h-3.5", title)} />
      </div>
      <div className="flex h-5 items-center">
        <Skeleton className={cn("h-3", caption)} />
      </div>
    </div>
  )
}

function HealthCardSkeleton() {
  return (
    <div className={cn(SURFACE, "flex flex-col gap-3 p-4")}>
      <HeaderLines title="w-24" caption="w-20" />
      <div className="flex h-32 items-center justify-between gap-4">
        <div className="space-y-3">
          <div className="flex items-end gap-2.5">
            <Skeleton className="h-9 w-8" />
            <Skeleton className="h-5 w-16" />
          </div>
          <Skeleton className="h-3 w-36" />
        </div>
        {/* The donut: a ring, as it will be. */}
        <div className="size-30 shrink-0 animate-pulse rounded-full border-[14px] border-muted motion-reduce:animate-none" />
      </div>
    </div>
  )
}

function TrendCardSkeleton() {
  return (
    <div className={cn(SURFACE, "flex flex-col gap-3 p-4")}>
      <HeaderLines title="w-24" caption="w-32" />
      <Skeleton className="h-32 w-full" />
    </div>
  )
}

function ListSkeleton() {
  return (
    <div
      className={cn(SURFACE, "flex h-full min-h-0 flex-col overflow-hidden")}
    >
      <div className="shrink-0 space-y-3 border-b px-4 py-3">
        <div className="flex h-6 items-center gap-2">
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="h-5 w-8" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-7 w-60" />
          <Skeleton className="h-7 w-36" />
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-hidden p-3">
        {["w-3/4", "w-2/3", "w-4/5", "w-1/2", "w-3/5"].map((width) => (
          <div key={width} className="space-y-3 rounded-md border p-3">
            <div className="flex items-center gap-1.5">
              <Skeleton className="h-5 w-6" />
              <Skeleton className="h-5 w-14" />
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-5 w-10" />
            </div>
            <Skeleton className={cn("h-3.5", width)} />
          </div>
        ))}
      </div>
    </div>
  )
}

// Indent (in rows' depth) and name width for each placeholder row.
const TREE_ROWS: [number, string][] = [
  [0, "w-16"],
  [1, "w-24"],
  [2, "w-36"],
  [2, "w-28"],
  [1, "w-20"],
  [2, "w-40"],
  [2, "w-32"],
  [2, "w-24"],
  [1, "w-16"],
  [2, "w-36"],
  [0, "w-20"],
  [1, "w-28"],
]

function TreeSkeleton() {
  return (
    <div
      className={cn(SURFACE, "flex h-full min-h-0 flex-col overflow-hidden")}
    >
      <div className="shrink-0 space-y-2 border-b px-4 py-3">
        <HeaderLines title="w-32" caption="w-56" />
        <Skeleton className="h-3 w-44" />
      </div>
      <div className="min-h-0 flex-1 space-y-0.5 overflow-hidden p-2">
        {TREE_ROWS.map(([depth, width], index) => (
          <div
            key={index}
            className="relative flex h-8 items-center gap-2 pr-2"
            style={{ paddingLeft: depth * 14 + 12 }}
          >
            <Skeleton className="absolute inset-y-0 left-0 w-1 rounded-sm" />
            <Skeleton className="size-4" />
            <Skeleton className={cn("h-3", width)} />
            <Skeleton className="ml-auto h-3 w-8" />
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * The loading dashboard, in the shape of the loaded one: health and trend
 * cards on top, the ranked list below them, the file tree on the right. The
 * page fills in place rather than jumping from two grey blocks to a layout.
 *
 * `notice` takes the health card's slot — "Calculating your health score…"
 * sits exactly where the score is about to appear.
 */
export function DashboardSkeleton({
  notice,
}: Readonly<{ notice?: ReactNode }>) {
  return (
    <div className={DASHBOARD_GRID} aria-busy="true">
      <p className="sr-only">Loading the dashboard…</p>
      <div className={DASHBOARD_MAIN_COLUMN}>
        <div className={DASHBOARD_TOP_ROW}>
          {notice ?? <HealthCardSkeleton />}
          <TrendCardSkeleton />
        </div>
        <div className={DASHBOARD_LIST_SLOT}>
          <ListSkeleton />
        </div>
      </div>
      <div className={DASHBOARD_TREE_SLOT}>
        <TreeSkeleton />
      </div>
    </div>
  )
}
