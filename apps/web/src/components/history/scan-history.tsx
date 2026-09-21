"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { ErrorState } from "@/components/error-state"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useScanHistory } from "@/hooks/use-scan-history"
import type { ScanSummary } from "@/lib/types"
import { gradeColor, shortSha } from "@/lib/utils"

function dashboardSnapshotHref(repoId: string, scan: ScanSummary) {
  const qs = new URLSearchParams({
    branch: scan.branch,
    snapshot_id: scan.snapshot_id,
  })
  return `/dashboard/${repoId}?${qs}`
}

function dashboardLatestHref(repoId: string, branch?: string) {
  if (!branch) return `/dashboard/${repoId}`
  const qs = new URLSearchParams({ branch })
  return `/dashboard/${repoId}?${qs}`
}

/**
 * One row's movement against the snapshot before it.
 *
 * The oldest snapshot has nothing to compare against and the API sends 0 for it,
 * so "▲ +0" would be a claim the data does not make. An em dash says "no
 * previous scan" without inventing a direction.
 */
function Delta({ value }: Readonly<{ value: number }>) {
  const delta = Math.round(value)
  if (delta === 0) {
    return (
      <span className="text-muted-foreground">
        <span aria-hidden>—</span>
        <span className="sr-only">no change</span>
      </span>
    )
  }
  return (
    <span className="text-muted-foreground tabular-nums">
      {delta > 0 ? `▲ +${delta}` : `▼ ${delta}`}
    </span>
  )
}

function ScanRow({
  repoId,
  scan,
}: Readonly<{ repoId: string; scan: ScanSummary }>) {
  const router = useRouter()
  const href = dashboardSnapshotHref(repoId, scan)
  const open = () => router.push(href)

  return (
    <TableRow
      tabIndex={0}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          open()
        }
      }}
      className="cursor-pointer focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring"
      aria-label={`Open scan from ${new Date(scan.scanned_at).toLocaleString()}`}
    >
      <TableCell className="whitespace-nowrap">
        <time dateTime={scan.scanned_at}>
          {new Date(scan.scanned_at).toLocaleString()}
        </time>
      </TableCell>
      <TableCell>{scan.branch}</TableCell>
      <TableCell className="font-mono">{shortSha(scan.commit_sha)}</TableCell>
      <TableCell className="text-right tabular-nums">
        {Math.round(scan.health_score)}
      </TableCell>
      <TableCell>
        {/*
          The same colour rule as the dashboard's health card, from the same
          helper. A grade that is green on one screen and grey on the next reads
          as two different products.
        */}
        <span className="font-bold" style={{ color: gradeColor(scan.grade) }}>
          {scan.grade}
        </span>
      </TableCell>
      <TableCell className="text-right">
        <Delta value={scan.delta} />
      </TableCell>
      <TableCell className="text-right text-primary">Open</TableCell>
    </TableRow>
  )
}

export function ScanHistory({ repoId }: Readonly<{ repoId: string }>) {
  const { data: scans, loading, error, refetch } = useScanHistory(repoId)

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Scan History</h1>
          <p className="text-muted-foreground text-sm">
            Every stored snapshot for this repository, newest first. Scores are
            recalculated under the profile in force right now, so applying a
            different profile redraws this list.
          </p>
        </div>
        {scans && scans.length > 0 ? (
          <Button asChild variant="outline" size="sm">
            <Link href={dashboardLatestHref(repoId, scans[0]?.branch)}>
              Open latest scan
            </Link>
          </Button>
        ) : null}
      </div>

      {error ? (
        <ErrorState
          title="Couldn’t load the scan history"
          detail={error.message}
          onRetry={refetch}
        />
      ) : loading ? (
        <div className="space-y-2" data-testid="scan-history-loading">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : scans && scans.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Scanned</TableHead>
              <TableHead>Branch</TableHead>
              <TableHead>Commit</TableHead>
              <TableHead className="text-right">Score</TableHead>
              <TableHead>Grade</TableHead>
              <TableHead className="text-right">Change</TableHead>
              <TableHead className="text-right">Open</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {scans.map((scan) => (
              <ScanRow key={scan.snapshot_id} repoId={repoId} scan={scan} />
            ))}
          </TableBody>
        </Table>
      ) : (
        // A connected-but-never-scanned repository is the ordinary first-run
        // state, not a failure — so it gets the way forward, not an apology.
        <div className="rounded-md border p-6 text-center">
          <p className="text-muted-foreground text-sm">
            No scans yet — run one from the dashboard.
          </p>
          <Button asChild variant="outline" size="sm" className="mt-3">
            <Link href={`/dashboard/${repoId}`}>Go to dashboard</Link>
          </Button>
        </div>
      )}
    </div>
  )
}
