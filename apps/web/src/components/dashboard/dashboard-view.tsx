"use client"

import { useState } from "react"

import { DashboardTopNav } from "@/components/layout/dashboard-topnav"
import { OverallHealthCard } from "@/components/dashboard/overall-health-card"
import { HealthGraphCard } from "@/components/dashboard/health-graph-card"
import { RefactorFirstList } from "@/components/dashboard/refactor-first-list"
import { FindingDetailPanel } from "@/components/dashboard/finding-detail-panel"
import { FileTree } from "@/components/dashboard/file-tree/file-tree"
import { Skeleton } from "@/components/ui/skeleton"
import { useBranches } from "@/hooks/use-branches"
import { useHealthReport } from "@/hooks/use-health-report"
import { useScan } from "@/hooks/use-scan"
import type { Finding, TreeNode } from "@/lib/types"
import { healthColor } from "@/lib/utils"

export function DashboardView({ repoId }: Readonly<{ repoId: string }>) {
  // Data now arrives over the (mock) network instead of a static import.
  const { data: branches } = useBranches(repoId)

  // A user pick wins; until then fall back to the repo's default branch, then
  // the first available one. Empty string only for the first render before
  // branches load (the mock treats it as the default branch).
  const [pickedBranch, setPickedBranch] = useState<string>()
  const activeBranch =
    pickedBranch ??
    branches?.find((b) => b.isDefault)?.name ??
    branches?.[0]?.name ??
    ""

  const { data: report, loading, error } = useHealthReport(repoId, activeBranch)

  // The Scan button's state machine (start → poll progress → done/stop + toast).
  const { status: scanStatus, scan: runScan, stop: stopScan } = useScan(repoId)

  const [selectedFinding, setSelectedFinding] = useState<Finding | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  // The file tree writes the hovered node here (FileTree → onHoverNode). In v1
  // Card B always shows repo health and ignores this, so only the setter is used
  // today (the value is intentionally discarded — no consumer, no unused var).
  // v2 flip (plan §2.3 / roadmap) is two edits, no rewrite:
  //   1. keep the value: const [hoveredNode, setHoveredNode] = useState<TreeNode | null>(null)
  //   2. feed Card B:    <HealthGraphCard history={hoveredNode?.history ?? report.history} />
  // …which also needs a per-node HealthPoint[] added to TreeNode (a v2 contract change).
  const [, setHoveredNode] = useState<TreeNode | null>(null)

  const openFinding = (finding: Finding) => {
    setSelectedFinding(finding)
    setDetailOpen(true)
  }

  // Minimal loading/error handling so the swap is safe; Phase 11 adds the full
  // skeleton/empty/error treatment per the Definition of Done.
  if (error) {
    return (
      <div className="text-destructive p-6 text-sm">
        Couldn’t load this dashboard: {error.message}
      </div>
    )
  }

  if (loading || !report) {
    return (
      <div className="space-y-4 p-4">
        <Skeleton className="h-12 w-full" />
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <DashboardTopNav
        repoName={repoId}
        branches={branches ?? []}
        activeBranch={activeBranch}
        onBranchChange={setPickedBranch}
        lastCommitSha={report.commitSha}
        scannedAt={report.scannedAt}
        scan={{
          phase: scanStatus.phase,
          progress: scanStatus.progress,
          onScan: () => runScan(activeBranch),
          onStop: stopScan,
        }}
      />

      <div className="grid flex-1 gap-4 p-4 lg:grid-cols-2">
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <OverallHealthCard
              score={report.healthScore}
              grade={report.grade}
              delta={report.delta}
              redIssueCount={report.redIssueCount}
              categoryBreakdown={report.categoryBreakdown}
            />
            <HealthGraphCard history={report.history} />
          </div>
          <RefactorFirstList
            findings={report.findings}
            onSelect={openFinding}
            selectedFingerprint={selectedFinding?.fingerprint}
          />
        </div>

        <div className="rounded-lg border p-2">
          <FileTree
            nodes={report.tree}
            colorFor={(node) => healthColor(node.healthScore)}
            onHoverNode={setHoveredNode}
            onSelectNode={(node) => {
              const match = report.findings.find((f) => f.file === node.path)
              if (match) openFinding(match)
            }}
          />
        </div>
      </div>

      <FindingDetailPanel
        finding={selectedFinding}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />
    </div>
  )
}
