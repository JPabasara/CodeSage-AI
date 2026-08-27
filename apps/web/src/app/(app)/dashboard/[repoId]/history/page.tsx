export default async function ScanHistoryPage({
  params,
}: Readonly<{ params: Promise<{ repoId: string }> }>) {
  const { repoId } = await params
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold">Scan History</h1>
      <p className="text-muted-foreground mt-2 text-sm">
        Past scans for <span className="font-mono">{repoId}</span> will appear
        here. (Placeholder.)
      </p>
    </div>
  )
}
