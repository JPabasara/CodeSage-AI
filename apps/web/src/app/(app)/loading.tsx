import { PAGE_CONTAINER } from "@/components/layout/page-container"
import { Skeleton } from "@/components/ui/skeleton"

// Shown the moment a rail link is clicked, while the page itself loads.
export default function Loading() {
  return (
    <div className={PAGE_CONTAINER} aria-busy="true">
      <p className="sr-only">Loading…</p>
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  )
}
