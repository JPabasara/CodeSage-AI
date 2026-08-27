"use client"

import Link from "next/link"

import { Button } from "@/components/ui/button"
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

function ScanRow({ scan }: Readonly<{ scan: ScanSummary }>) {
  return (
    <TableRow>
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
    </TableRow>
  )
}

export function ScanHistory({ repoId }: Readonly<{ repoId: string }>) {
  const { data: scans, loading, error, reload } = useScanHistory(repoId)

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Scan History</h1>
        <p className="text-muted-foreground text-sm">
          Every stored snapshot for this repository, newest first. Scores are
          recalculated under the profile in force right now, so applying a
          different profile redraws this list.
        </p>
      </div>

      {error ? (
        <div className="space-y-3">
          <p className="text-destructive text-sm">
            Couldn’t load the scan history: {error.message}
          </p>
          <Button variant="outline" size="sm" onClick={reload}>
            Retry
          </Button>
        </div>
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
            </TableRow>
          </TableHeader>
          <TableBody>
            {scans.map((scan) => (
              <ScanRow key={scan.snapshot_id} scan={scan} />
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
