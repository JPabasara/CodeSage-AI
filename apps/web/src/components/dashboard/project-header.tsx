"use client"

import Link from "next/link"
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  GitBranch,
  GitCommit,
  History,
  SlidersHorizontal,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  ScanControl,
  type ScanControlProps,
} from "@/components/layout/scan-control"
import { absoluteTime, relativeTime, shortSha } from "@/lib/utils"

export type SnapshotNavigation = {
  isHistorical: boolean
  isLatest: boolean
  positionLabel?: string
  canGoOlder: boolean
  canGoNewer: boolean
  showLatestButton: boolean
  onOlder: () => void
  onNewer: () => void
  onLatest: () => void
}

export type ProjectHeaderProps = {
  repoName: string
  owner?: string
  repoUrl?: string
  branch: string
  /** Snapshot facts, absent until the branch has been scanned once. */
  commitSha?: string
  scannedAt?: string
  profileName?: string
  snapshotNavigation?: SnapshotNavigation
  scan: ScanControlProps
  /** The snapshot is still loading: say nothing yet rather than "Never scanned". */
  loading?: boolean
}

const metaItem = "inline-flex min-w-0 items-center gap-1.5"
const metaLink =
  "inline-flex items-center gap-1.5 rounded-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"

/**
 * What this dashboard is about, and the one thing to do on it: the project,
 * the snapshot it shows, older scans, and Scan.
 */
export function ProjectHeader({
  repoName,
  owner,
  repoUrl,
  branch,
  commitSha,
  scannedAt,
  profileName,
  snapshotNavigation,
  scan,
  loading = false,
}: Readonly<ProjectHeaderProps>) {
  const scanned = relativeTime(scannedAt)
  const sourceUrl =
    repoUrl && commitSha
      ? `${repoUrl.replace(/\/$/, "")}/tree/${commitSha}`
      : repoUrl

  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="min-w-0 space-y-2">
        <h1 className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 text-xl font-semibold tracking-tight text-foreground-strong">
          <span className="truncate">{repoName}</span>
          {owner ? (
            <span className="text-base font-medium text-muted-foreground">
              {owner}
            </span>
          ) : null}
        </h1>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[0.84375rem] text-muted-foreground">
          {branch ? (
            <span className={metaItem}>
              <GitBranch className="size-3.5" aria-hidden="true" />
              <span className="sr-only">Branch </span>
              <span className="font-mono">{branch}</span>
            </span>
          ) : null}
          {loading ? (
            <Skeleton className="h-4 w-44" />
          ) : (
            <>
              <span
                className={metaItem}
                title={
                  scannedAt
                    ? `Last analyzed ${absoluteTime(scannedAt)}`
                    : undefined
                }
              >
                <GitCommit className="size-3.5" aria-hidden="true" />
                <span className="font-mono">
                  {commitSha ? `#${shortSha(commitSha)}` : "No commit yet"}
                </span>
              </span>
              <span className={metaItem} title={absoluteTime(scannedAt)}>
                <Clock className="size-3.5" aria-hidden="true" />
                {scanned ? `Scanned ${scanned}` : "Never scanned"}
              </span>
            </>
          )}
          {snapshotNavigation?.isHistorical ? (
            <span className="inline-flex items-center gap-1.5 rounded-sm bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
              <History className="size-3.5" aria-hidden="true" />
              Historical snapshot
            </span>
          ) : null}
          {profileName ? (
            <Link
              href="/profiles"
              data-testid="scored-with"
              title="Scores are weighed by this profile. Change it in Scoring profiles."
              className={metaLink}
            >
              <SlidersHorizontal className="size-3.5" aria-hidden="true" />
              Scored with {profileName}
            </Link>
          ) : null}
          {sourceUrl ? (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={metaLink}
            >
              <ExternalLink className="size-3.5" aria-hidden="true" />
              View on GitHub
            </a>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        {snapshotNavigation ? (
          <div
            role="group"
            aria-label="Scan snapshot navigation"
            className="flex h-10.5 items-center rounded-md border bg-card"
          >
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-full w-9 rounded-r-none"
              aria-label="Older scan"
              title="Older scan"
              onClick={snapshotNavigation.onOlder}
              disabled={!snapshotNavigation.canGoOlder}
            >
              <ChevronLeft />
            </Button>
            <span className="flex min-w-24 items-center justify-center gap-1 px-1 text-[0.84375rem] font-medium tabular-nums">
              {snapshotNavigation.positionLabel ?? "Latest"}
              {snapshotNavigation.isLatest ? (
                <span className="text-xs font-normal text-muted-foreground">
                  <span aria-hidden="true">· </span>
                  <span>Latest</span>
                </span>
              ) : null}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-full w-9 rounded-l-none"
              aria-label="Newer scan"
              title="Newer scan"
              onClick={snapshotNavigation.onNewer}
              disabled={!snapshotNavigation.canGoNewer}
            >
              <ChevronRight />
            </Button>
          </div>
        ) : null}
        {snapshotNavigation?.showLatestButton ? (
          <Button
            type="button"
            variant="outline"
            className="h-10.5 px-3.5 text-sm"
            onClick={snapshotNavigation.onLatest}
          >
            Latest scan
          </Button>
        ) : null}
        <div data-tour="scan-action">
          <ScanControl {...scan} size="lg" />
        </div>
      </div>
    </header>
  )
}
