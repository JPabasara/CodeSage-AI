"use client"

import {
  Activity,
  ChevronLeft,
  ChevronRight,
  Clock3,
  GitBranch,
  GitCommit,
} from "lucide-react"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  ScanControl,
  type ScanControlProps,
} from "@/components/layout/scan-control"
import { Button } from "@/components/ui/button"
import type { Branch } from "@/lib/types"
import { shortSha } from "@/lib/utils"

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

export type DashboardTopNavProps = {
  repoName: string
  branches: Branch[]
  activeBranch: string
  onBranchChange: (branch: string) => void
  /**
   * Snapshot metadata, absent until the branch has been scanned once.
   *
   * The nav renders above the report, so it has to survive having no report at
   * all. A freshly connected repository has no commit and no scan time.
   */
  lastCommitSha?: string
  scannedAt?: string
  scan: ScanControlProps
  snapshotNavigation?: SnapshotNavigation
}

export function DashboardTopNav({
  repoName,
  branches,
  activeBranch,
  onBranchChange,
  lastCommitSha,
  scannedAt,
  scan,
  snapshotNavigation,
}: Readonly<DashboardTopNavProps>) {
  // Branches load on their own clock. Before they land `activeBranch` is "",
  // which Radix renders as a blank trigger, so the placeholder must be explicit.
  const branchesReady = branches.length > 0
  const formattedScanTime = scannedAt
    ? new Date(scannedAt).toLocaleString()
    : undefined

  return (
    <header
      aria-label="Dashboard header"
      className="z-10 shrink-0 border-b bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/85"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className="h-5 w-px shrink-0 rounded-full bg-primary"
              aria-hidden="true"
            />
            <h1 className="truncate text-base font-semibold leading-6">
              {repoName}
            </h1>
            <span className="rounded-full border border-primary/45 px-2 py-0.5 text-[0.625rem] font-medium text-primary">
              {snapshotNavigation?.isHistorical
                ? "Historical snapshot"
                : "Live dashboard"}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-card px-2 py-1">
              <GitCommit className="size-3.5" aria-hidden="true" />
              {lastCommitSha ? (
                <span className="font-mono">#{shortSha(lastCommitSha)}</span>
              ) : (
                <span>No commit yet</span>
              )}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-card px-2 py-1">
              <Clock3 className="size-3.5" aria-hidden="true" />
              {formattedScanTime ? (
                <span>Last analyzed {formattedScanTime}</span>
              ) : (
                <span>Never scanned</span>
              )}
            </span>
          </div>
        </div>

        <nav aria-label="Dashboard controls" className="flex flex-wrap items-center gap-2">
          <div className="flex h-9 items-center gap-2 rounded-md border border-border/70 bg-card px-2">
            <GitBranch
              className="size-4 text-muted-foreground"
              aria-hidden="true"
            />
            <Select
              value={branchesReady && activeBranch ? activeBranch : undefined}
              onValueChange={onBranchChange}
              disabled={!branchesReady}
            >
              <SelectTrigger
                className="h-7 w-40 border-0 bg-transparent px-0 shadow-none focus:ring-0"
                aria-label="Branch"
              >
                <SelectValue
                  placeholder={
                    branchesReady ? "Select branch" : "Loading branches..."
                  }
                />
              </SelectTrigger>
              <SelectContent align="end" className="z-50">
                {branches.map((b) => (
                  <SelectItem key={b.name} value={b.name}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex min-h-9 items-center gap-2 rounded-md border border-border/70 bg-card px-2">
            <Activity className="size-4 text-primary" aria-hidden="true" />
            <ScanControl {...scan} />
          </div>

          {snapshotNavigation ? (
            <div
              className="flex min-h-9 items-center gap-1 rounded-md border border-border/70 bg-card px-1"
              aria-label="Scan snapshot navigation"
            >
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Older scan"
                title="Older scan"
                onClick={snapshotNavigation.onOlder}
                disabled={!snapshotNavigation.canGoOlder}
              >
                <ChevronLeft />
              </Button>
              <span className="flex min-w-14 flex-col items-center px-1 text-center leading-none">
                {snapshotNavigation.isLatest ? (
                  <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[0.55rem] font-semibold uppercase tracking-wide text-primary">
                    Latest
                  </span>
                ) : null}
                <span className="mt-0.5 text-[0.625rem] font-medium text-muted-foreground">
                  {snapshotNavigation.positionLabel ?? "Latest"}
                </span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Newer scan"
                title="Newer scan"
                onClick={snapshotNavigation.onNewer}
                disabled={!snapshotNavigation.canGoNewer}
              >
                <ChevronRight />
              </Button>
              {snapshotNavigation.showLatestButton ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={snapshotNavigation.onLatest}
                >
                  Latest scan
                </Button>
              ) : null}
            </div>
          ) : null}
        </nav>
      </div>
    </header>
  )
}
