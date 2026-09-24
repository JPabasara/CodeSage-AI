"use client"

import { ChevronLeft, ChevronRight, GitBranch, GitCommit } from "lucide-react"

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
import { TopBarPortal } from "@/components/layout/top-bar-slot"
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
  // The branch list loads on its own clock, and its Select is not rendered
  // until it has landed.
  //
  // Not merely disabled: a Radix Select that starts with no value and acquires
  // one has switched from uncontrolled to controlled, which React warns about
  // and which drops a selection made in between. A placeholder that becomes the
  // real control is honest about the same thing and cannot lose anything.
  const branchesReady = branches.length > 0 && Boolean(activeBranch)
  const formattedScanTime = scannedAt
    ? new Date(scannedAt).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : undefined
  const barButton =
    "text-topbar-foreground hover:bg-white/10 hover:text-topbar-foreground disabled:opacity-40 dark:hover:bg-white/10"

  // No second header row: everything the dashboard used to put in its own bar
  // now lives in the app bar, beside the project it belongs to. The state stays
  // here; the portals only decide where it is drawn.
  return (
    <>
      {/* The project picker already names the repository on screen; the page
          still needs its heading for screen readers. */}
      <h1 className="sr-only">{repoName}</h1>

      <TopBarPortal name="context">
        <span
          className="hidden text-topbar-foreground/35 md:inline"
          aria-hidden="true"
        >
          /
        </span>
        <div className="flex h-9 min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 text-topbar-foreground transition-colors hover:bg-white/10 md:flex-none">
          <GitBranch
            className="size-3.5 shrink-0 opacity-70"
            aria-hidden="true"
          />
          {branchesReady ? (
            <Select value={activeBranch} onValueChange={onBranchChange}>
              <SelectTrigger
                className="h-7 w-full min-w-0 border-0 bg-transparent px-0 text-sm font-medium text-inherit shadow-none focus:ring-0 md:w-auto md:max-w-40 dark:bg-transparent dark:hover:bg-transparent [&_svg]:text-current [&_svg]:opacity-60"
                aria-label="Branch"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="start" className="z-50">
                {branches.map((b) => (
                  <SelectItem key={b.name} value={b.name}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className="w-full text-xs opacity-75 md:w-24">
              Loading branches…
            </span>
          )}
        </div>

        {/* Snapshot facts: quiet text, shown where there is room for it. */}
        <span className="hidden min-w-0 items-center gap-2 text-xs text-topbar-foreground/75 lg:inline-flex">
          <span
            className="inline-flex items-center gap-1 font-mono"
            title={
              formattedScanTime
                ? `Last analyzed ${formattedScanTime}`
                : "Never scanned"
            }
          >
            <GitCommit className="size-3.5" aria-hidden="true" />
            {lastCommitSha ? `#${shortSha(lastCommitSha)}` : "No commit yet"}
          </span>
          <span className="hidden truncate 2xl:inline">
            {formattedScanTime
              ? `Last analyzed ${formattedScanTime}`
              : "Never scanned"}
          </span>
          <span className="rounded-full bg-white/12 px-2 py-0.5 font-medium text-topbar-foreground">
            {snapshotNavigation?.isHistorical
              ? "Historical snapshot"
              : "Live dashboard"}
          </span>
        </span>
      </TopBarPortal>

      <TopBarPortal name="actions">
        {snapshotNavigation ? (
          <div
            // Phones keep the bar for the workspace name; older scans are one
            // tap away in Scan History there.
            className="hidden items-center text-topbar-foreground md:flex"
            aria-label="Scan snapshot navigation"
          >
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className={barButton}
              aria-label="Older scan"
              title="Older scan"
              onClick={snapshotNavigation.onOlder}
              disabled={!snapshotNavigation.canGoOlder}
            >
              <ChevronLeft />
            </Button>
            <span className="flex min-w-10 items-center gap-1 px-1 text-xs font-medium tabular-nums">
              {snapshotNavigation.isLatest ? (
                <span className="opacity-90">Latest</span>
              ) : null}
              <span className="opacity-70">
                {snapshotNavigation.positionLabel ?? "Latest"}
              </span>
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className={barButton}
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
                variant="ghost"
                size="sm"
                className={barButton}
                onClick={snapshotNavigation.onLatest}
              >
                Latest scan
              </Button>
            ) : null}
          </div>
        ) : null}
        <ScanControl {...scan} onBar />
      </TopBarPortal>
    </>
  )
}
