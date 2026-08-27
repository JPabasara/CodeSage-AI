import { ScanHistory } from "@/components/history/scan-history"

export default async function ScanHistoryPage({
  params,
}: Readonly<{ params: Promise<{ repoId: string }> }>) {
  const { repoId } = await params
  return <ScanHistory repoId={repoId} />
}
