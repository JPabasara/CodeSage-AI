import type { Metadata } from "next"
import { Suspense } from "react"

import { DashboardView } from "@/components/dashboard/dashboard-view"
import Loading from "./loading"

export const metadata: Metadata = { title: "Dashboard" }

export default async function Page({
  params,
}: Readonly<{ params: Promise<{ repoId: string }> }>) {
  const { repoId } = await params
  return (
    <Suspense fallback={<Loading />}>
      <DashboardView repoId={repoId} />
    </Suspense>
  )
}
