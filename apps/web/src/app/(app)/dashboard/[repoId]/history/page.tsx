import type { Metadata } from "next"

import { ScanHistory } from "@/components/history/scan-history"

export const metadata: Metadata = { title: "Scan history" }

export default async function ScanHistoryPage({
  params,
}: Readonly<{ params: Promise<{ repoId: string }> }>) {
  const { repoId } = await params
  return <ScanHistory repoId={repoId} />
}
