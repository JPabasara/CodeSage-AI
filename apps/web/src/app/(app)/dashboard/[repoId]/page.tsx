import type { Metadata } from "next"
import { Suspense } from "react"

import { DashboardView } from "@/components/dashboard/dashboard-view"
import { Skeleton } from "@/components/ui/skeleton"

export const metadata: Metadata = { title: "Dashboard" }

export default async function Page({
  params,
}: Readonly<{ params: Promise<{ repoId: string }> }>) {
  const { repoId } = await params
  return (
    <Suspense fallback={<Skeleton className="m-4 h-64" />}>
      <DashboardView repoId={repoId} />
    </Suspense>
  )
}
