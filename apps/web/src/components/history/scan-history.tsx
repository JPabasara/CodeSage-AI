"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { GitBranch, History } from "lucide-react"

import { EmptyState } from "@/components/empty-state"
import { ErrorState } from "@/components/error-state"
import { GitHubMark } from "@/components/icons/github-mark"
import { PageHeader } from "@/components/layout/page-header"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useBranches } from "@/hooks/use-branches"
import { useProjects } from "@/hooks/use-projects"
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

// Short in the row, absolute and complete on hover.
const shortDateTime = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
})

const fullDateTime = new Intl.DateTimeFormat(undefined, {
  dateStyle: "full",
  timeStyle: "long",
})

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
      {delta > 0 ? `▲ +${delta}` : `▼ −${Math.abs(delta)}`}
    </span>
  )
}

/** The project this page is about, named beside the title. */
function ProjectContext({ repoId }: Readonly<{ repoId: string }>) {
  const { data: repos, error } = useProjects()
  if (error) return null
  if (!repos) return <Skeleton className="h-5 w-40" />
  const repo = repos.find((r) => r.id === repoId)
  if (!repo) return null
  const label = `${repo.owner}/${repo.name}`
  return (
    <span
      className="inline-flex min-w-0 items-center gap-1.5 rounded-md border bg-card px-2 py-0.5 text-xs font-medium text-foreground"
      title={label}
    >
      <GitHubMark className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="sr-only">Project: </span>
      <span className="truncate">{label}</span>
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
  const scannedAt = new Date(scan.scanned_at)

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
      aria-label={`Open scan from ${scannedAt.toLocaleString()}`}
    >
      <TableCell className="tabular-nums">
        <time dateTime={scan.scanned_at} title={fullDateTime.format(scannedAt)}>
          {shortDateTime.format(scannedAt)}
        </time>
      </TableCell>
      <TableCell>
        <span className="inline-flex max-w-40 items-center gap-1 rounded-sm border bg-muted/40 px-1.5 py-0.5 font-mono text-xs">
          <GitBranch
            className="size-3 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <span className="truncate">{scan.branch}</span>
        </span>
      </TableCell>
      <TableCell className="font-mono text-xs text-muted-foreground">
        {shortSha(scan.commit_sha)}
      </TableCell>
      <TableCell className="text-right font-medium tabular-nums">
        {Math.round(scan.health_score)}
      </TableCell>
      <TableCell>
        {/*
          The same colour rule as the dashboard's health card, from the same
          helper. A grade that is green on one screen and grey on the next reads
          as two different products.
        */}
        <span
          className="font-semibold"
          style={{ color: gradeColor(scan.grade) }}
        >
          {scan.grade}
        </span>
      </TableCell>
      <TableCell className="text-right">
        <Delta value={scan.delta} />
      </TableCell>
      <TableCell className="text-right text-xs font-medium text-primary">
        Open
      </TableCell>
    </TableRow>
  )
}

/** The table's frame and row rhythm, so nothing jumps when the rows land. */
function ScanHistorySkeleton() {
  return (
    <div
      className="overflow-hidden rounded-lg border bg-card"
      data-testid="scan-history-loading"
    >
      <div className="h-9 border-b bg-muted/40" />
      {Array.from({ length: 4 }, (_, i) => (
        <div
          key={i}
          className="flex h-11 items-center gap-6 border-b px-4 last:border-0"
        >
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-14" />
          <Skeleton className="ml-auto h-4 w-8" />
          <Skeleton className="h-4 w-6" />
          <Skeleton className="h-4 w-10" />
        </div>
      ))}
    </div>
  )
}

const ALL = "all"

export function ScanHistory({ repoId }: Readonly<{ repoId: string }>) {
  // The project comes from the app bar; the branch is a filter on this page.
  // "All branches" asks the API with no branch, which the contract defines as
  // every branch.
  const [branch, setBranch] = useState(ALL)
  const { data: branches } = useBranches(repoId)
  const {
    data: scans,
    loading,
    error,
    refetch,
  } = useScanHistory(repoId, branch === ALL ? undefined : branch)

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 sm:p-6">
      <PageHeader
        title="Scan History"
        context={<ProjectContext repoId={repoId} />}
        description="Every stored snapshot for this repository, newest first, scored under the profile in force now."
        aside={
          <>
            <Select value={branch} onValueChange={setBranch}>
              <SelectTrigger className="w-44" aria-label="Filter by branch">
                <GitBranch
                  className="size-4 text-muted-foreground"
                  aria-hidden="true"
                />
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                <SelectItem value={ALL}>All branches</SelectItem>
                {(branches ?? []).map((b) => (
                  <SelectItem key={b.name} value={b.name}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {scans && scans.length > 0 ? (
              <Button asChild variant="outline">
                <Link href={dashboardLatestHref(repoId, scans[0]?.branch)}>
                  Open latest scan
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      {error ? (
        <ErrorState
          title="Couldn’t load the scan history"
          detail={error.message}
          onRetry={refetch}
        />
      ) : loading ? (
        <ScanHistorySkeleton />
      ) : scans && scans.length > 0 ? (
        <div className="overflow-hidden rounded-lg border bg-card">
          <Table className="text-sm [&_td:first-child]:pl-4 [&_td:last-child]:pr-4 [&_th:first-child]:pl-4 [&_th:last-child]:pr-4">
            <TableHeader className="bg-muted/40">
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-9 text-xs text-muted-foreground">
                  Scanned
                </TableHead>
                <TableHead className="h-9 text-xs text-muted-foreground">
                  Branch
                </TableHead>
                <TableHead className="h-9 text-xs text-muted-foreground">
                  Commit
                </TableHead>
                <TableHead className="h-9 text-right text-xs text-muted-foreground">
                  Score
                </TableHead>
                <TableHead className="h-9 text-xs text-muted-foreground">
                  Grade
                </TableHead>
                <TableHead className="h-9 text-right text-xs text-muted-foreground">
                  Change
                </TableHead>
                <TableHead className="h-9 text-right text-xs text-muted-foreground">
                  Open
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {scans.map((scan) => (
                <ScanRow key={scan.snapshot_id} repoId={repoId} scan={scan} />
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        // A connected-but-never-scanned repository is the ordinary first-run
        // state, not a failure — so it gets the way forward, not an apology.
        <EmptyState
          icon={<History />}
          title={branch === ALL ? "No scans yet" : `No scans on ${branch} yet`}
          description="Run one from the dashboard."
          action={
            <Button asChild variant="outline">
              <Link
                href={
                  branch === ALL
                    ? `/dashboard/${repoId}`
                    : `/dashboard/${repoId}?${new URLSearchParams({ branch })}`
                }
              >
                Go to dashboard
              </Link>
            </Button>
          }
        />
      )}
    </div>
  )
}
