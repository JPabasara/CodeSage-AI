"use client"

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
import type { Branch } from "@/lib/types"
import { shortSha } from "@/lib/utils"

export type DashboardTopNavProps = {
  repoName: string
  branches: Branch[]
  activeBranch: string
  onBranchChange: (branch: string) => void
  /**
   * Snapshot metadata, ABSENT until the branch has been scanned once.
   *
   * The nav renders above the report now (J-CR9), so it has to survive having no
   * report at all — a freshly connected repository has no commit and no scan
   * time, and the old required props rendered "Invalid Date" and threw inside
   * shortSha() when handed undefined.
   */
  lastCommitSha?: string
  scannedAt?: string
  scan: ScanControlProps
}

export function DashboardTopNav({
  repoName,
  branches,
  activeBranch,
  onBranchChange,
  lastCommitSha,
  scannedAt,
  scan,
}: Readonly<DashboardTopNavProps>) {
  // Branches load on their own clock. Before they land `activeBranch` is "",
  // which Radix renders as a blank trigger — indistinguishable from a broken
  // dropdown now that the nav is on screen from the first paint.
  const branchesReady = branches.length > 0

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="font-semibold">{repoName}</span>
        <Select
          value={activeBranch}
          onValueChange={onBranchChange}
          disabled={!branchesReady}
        >
          <SelectTrigger className="w-40" aria-label="Branch">
            <SelectValue
              placeholder={
                branchesReady ? "Select branch" : "Loading branches…"
              }
            />
          </SelectTrigger>
          <SelectContent>
            {branches.map((b) => (
              <SelectItem key={b.name} value={b.name}>
                {b.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <ScanControl {...scan} />
      </div>

      <div className="text-muted-foreground text-right text-xs">
        {scannedAt ? (
          <>
            <div>Last analyzed {new Date(scannedAt).toLocaleString()}</div>
            {lastCommitSha ? (
              <div className="font-mono">#{shortSha(lastCommitSha)}</div>
            ) : null}
          </>
        ) : (
          <div>Never scanned</div>
        )}
      </div>
    </div>
  )
}
