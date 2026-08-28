import { Suspense } from "react"

import { DashboardView } from "@/components/dashboard/dashboard-view"
import { Skeleton } from "@/components/ui/skeleton"

export default async function Page({
  params,
}: Readonly<{ params: Promise<{ repoId: string }> }>) {
  const { repoId } = await params
  return (
    // The selected finding lives in the URL, so DashboardView reads
    // useSearchParams() — a client hook Next requires a Suspense boundary
    // around, or the build refuses to prerender this route.
    <Suspense fallback={<Skeleton className="m-4 h-64" />}>
      <DashboardView repoId={repoId} />
    </Suspense>
  )
}
