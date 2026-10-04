"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowRight, GitBranch, History } from "lucide-react"

import { DeltaText, GradeBadge } from "@/components/dashboard/kpi-card"
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
import { useBranches } from "@/hooks/use-branches"
import { useProjectProfile } from "@/hooks/use-profiles"
import { useProjects } from "@/hooks/use-projects"
import { useScanHistory } from "@/hooks/use-scan-history"
import type { ScanSummary } from "@/lib/types"
import { gradeColor, healthColor, shortSha } from "@/lib/utils"
import { PAGE_CONTAINER } from "@/components/layout/page-container"

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

// One row's movement against the snapshot before it.
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
  return <DeltaText value={delta} />
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
    <tr
      tabIndex={0}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          open()
        }
      }}
      className="cursor-pointer border-b transition-colors last:border-b-0 hover:bg-muted/50 focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring"
      aria-label={`Open scan from ${scannedAt.toLocaleString()}`}
    >
      <td className="px-4 py-3 align-middle whitespace-nowrap">
        <time
          dateTime={scan.scanned_at}
          title={fullDateTime.format(scannedAt)}
          className="font-medium text-foreground-strong tabular-nums"
        >
          {shortDateTime.format(scannedAt)}
        </time>
      </td>
      <td className="px-4 py-3 align-middle">
        <span className="inline-flex h-6 max-w-40 items-center gap-1.5 rounded-sm border bg-card px-2 font-mono text-xs text-foreground">
          <GitBranch
            className="size-3 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <span className="truncate">{scan.branch}</span>
        </span>
      </td>
      <td className="hidden px-4 py-3 align-middle font-mono text-xs text-muted-foreground sm:table-cell">
        {shortSha(scan.commit_sha)}
      </td>
      <td className="px-4 py-3 align-middle">
        {/* The same grade colours, bar and helpers as the workspace overview. */}
        <span className="flex items-center gap-2.5">
          <GradeBadge
            grade={scan.grade}
            color={gradeColor(scan.grade)}
            size="sm"
          />
          <span className="w-7 text-right font-semibold text-foreground-strong tabular-nums">
            {Math.round(scan.health_score)}
          </span>
          <span
            aria-hidden="true"
            className="hidden h-1.5 w-20 overflow-hidden rounded-full bg-muted md:block"
          >
            <span
              className="block h-full rounded-full"
              style={{
                width: `${Math.max(2, scan.health_score)}%`,
                backgroundColor: healthColor(scan.health_score),
              }}
            />
          </span>
        </span>
      </td>
      <td className="px-4 py-3 align-middle">
        <Delta value={scan.delta} />
      </td>
      <td className="px-4 py-3 text-right align-middle">
        <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
          Open
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </span>
      </td>
    </tr>
  )
}

/** The table's row rhythm, so nothing jumps when the rows land. */
function ScanHistorySkeleton() {
  return (
    <div data-testid="scan-history-loading" aria-busy="true">
      <div className="h-9 border-y bg-muted/50" />
      {Array.from({ length: 4 }, (_, i) => (
        <div
          key={i}
          className="flex h-12 items-center gap-6 border-b px-4 last:border-0"
        >
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-4 w-14" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-8" />
          <Skeleton className="ml-auto h-4 w-10" />
        </div>
      ))}
    </div>
  )
}

const ALL = "all"

export function ScanHistory({ repoId }: Readonly<{ repoId: string }>) {
  // The project comes from the app bar; the branch is a filter on this page.
  const [branch, setBranch] = useState(ALL)
  const { data: branches } = useBranches(repoId)
  const {
    data: scans,
    loading,
    error,
    refetch,
  } = useScanHistory(repoId, branch === ALL ? undefined : branch)
  const { data: projectProfile } = useProjectProfile(repoId)
  const profileName = projectProfile?.effective.name

  return (
    <div className={PAGE_CONTAINER} data-tour="scan-history">
      <PageHeader
        title="Scan history"
        context={<ProjectContext repoId={repoId} />}
        description={
          profileName ? (
            <span data-testid="history-profile">
              Every stored snapshot, newest first. All scans are shown under the{" "}
              <strong className="font-medium text-foreground">
                {profileName}
              </strong>{" "}
              profile —{" "}
              {/* Underlined: a link inside a sentence can't rely on colour alone. */}
              <Link
                href="/profiles"
                className="text-primary underline underline-offset-4"
              >
                change it in Profiles
              </Link>
              .
            </span>
          ) : (
            "Every stored snapshot for this repository, newest first, scored under the profile in force now."
          )
        }
      />

      <section
        aria-labelledby="history-snapshots"
        className="rounded-md border bg-card"
      >
        <div className="flex flex-wrap items-start justify-between gap-3 px-4.5 pt-4 pb-3">
          <div>
            <h2
              id="history-snapshots"
              className="text-base font-semibold text-foreground-strong"
            >
              Snapshots
            </h2>
            <p className="text-xs text-muted-foreground">
              {scans && scans.length > 0
                ? `${scans.length} stored ${branch === ALL ? "across all branches" : `on ${branch}`}. Open one to see the dashboard as it was.`
                : "Open one to see the dashboard as it was."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {scans && scans.length > 0 ? (
              <Link
                href={dashboardLatestHref(repoId, scans[0]?.branch)}
                className="inline-flex items-center gap-1 rounded-sm text-[0.84375rem] font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              >
                Open latest scan
                <ArrowRight className="size-3.5" aria-hidden="true" />
              </Link>
            ) : null}
            <Select value={branch} onValueChange={setBranch}>
              <SelectTrigger className="h-8 w-44" aria-label="Filter by branch">
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
          </div>
        </div>

        {error ? (
          <ErrorState
            className="border-t px-4.5 py-5"
            title="Couldn’t load the scan history"
            detail={error.message}
            onRetry={refetch}
          />
        ) : loading ? (
          <ScanHistorySkeleton />
        ) : scans && scans.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-y bg-muted/50 text-left text-xs text-muted-foreground">
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Scanned
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Branch
                  </th>
                  <th
                    scope="col"
                    className="hidden px-4 py-2.5 font-medium sm:table-cell"
                  >
                    Commit
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Health
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Change
                  </th>
                  <th scope="col" className="px-4 py-2.5">
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {scans.map((scan) => (
                  <ScanRow key={scan.snapshot_id} repoId={repoId} scan={scan} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            className="rounded-none border-0 border-t border-solid"
            icon={<History />}
            title={
              branch === ALL ? "No scans yet" : `No scans on ${branch} yet`
            }
            description="Run one from the dashboard."
            action={
              <Button asChild variant="outline" size="sm">
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
      </section>
    </div>
  )
}
