"use client"

import { useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

import { DashboardTopNav } from "@/components/layout/dashboard-topnav"
import { OverallHealthCard } from "@/components/dashboard/overall-health-card"
import { HealthGraphCard } from "@/components/dashboard/health-graph-card"
import { RefactorFirstList } from "@/components/dashboard/refactor-first-list"
import { FindingDetailPanel } from "@/components/dashboard/finding-detail-panel"
import { FileTree } from "@/components/dashboard/file-tree/file-tree"
import { Skeleton } from "@/components/ui/skeleton"
import { useBranches } from "@/hooks/use-branches"
import { useHealthReport } from "@/hooks/use-health-report"
import { useProjects } from "@/hooks/use-projects"
import { useScan } from "@/hooks/use-scan"
import type { Finding, TreeNode } from "@/lib/types"
import { healthColor } from "@/lib/utils"

export function DashboardView({ repoId }: Readonly<{ repoId: string }>) {
  // Data now arrives over the (mock) network instead of a static import.
  const { data: branches } = useBranches(repoId)

  // `repo_id` is a uuid in the contract, so the top nav cannot just print it —
  // "7c9e6679-7425-40de-…" is not a repository name. Look up the connected repo
  // and fall back to the id only while the list is still loading.
  const { data: repos } = useProjects()
  const repo = repos?.find((r) => r.id === repoId)
  const repoName = repo ? `${repo.owner}/${repo.name}` : repoId

  // A user pick wins; until then fall back to the repo's default branch, then
  // the first available one. Empty string only for the first render before
  // branches load (the mock treats it as the default branch).
  const [pickedBranch, setPickedBranch] = useState<string>()
  const activeBranch =
    pickedBranch ??
    branches?.find((b) => b.is_default)?.name ??
    branches?.[0]?.name ??
    ""

  const { data: report, loading, error } = useHealthReport(repoId, activeBranch)

  // The Scan button's state machine (start → poll progress → done/stop + toast).
  const {
    status: scanStatus,
    stopping,
    scan: runScan,
    stop: stopScan,
  } = useScan(repoId)

  // D-CR7: the selected finding lives in the URL, not in component state, so a
  // refresh restores detail mode and Back closes it. The fingerprint is stable
  // across scans, which is exactly what a shareable link needs.
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const selectedFingerprint = searchParams.get("finding") ?? undefined
  const selectedFinding: Finding | null =
    report?.findings.find((f) => f.fingerprint === selectedFingerprint) ?? null
  const detailMode = selectedFinding !== null
  // The file tree writes the hovered node here (FileTree → onHoverNode). In v1
  // Card B always shows repo health and ignores this, so only the setter is used
  // today (the value is intentionally discarded — no consumer, no unused var).
  // v2 flip (plan §2.3 / roadmap) is two edits, no rewrite:
  //   1. keep the value: const [hoveredNode, setHoveredNode] = useState<TreeNode | null>(null)
  //   2. feed Card B:    <HealthGraphCard history={hoveredNode?.history ?? report.history} />
  // …which also needs a per-node HealthPoint[] added to TreeNode (a v2 contract change).
  const [, setHoveredNode] = useState<TreeNode | null>(null)

  // push, not replace: Back should leave detail mode, the way it does in a mail
  // client. scroll: false keeps the dashboard where it is as the region swaps.
  const openFinding = (finding: Finding) =>
    router.push(`${pathname}?finding=${encodeURIComponent(finding.fingerprint)}`, {
      scroll: false,
    })

  const closeFinding = () => router.push(pathname, { scroll: false })

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
        repoName={repoName}
        branches={branches ?? []}
        activeBranch={activeBranch}
        onBranchChange={setPickedBranch}
        lastCommitSha={report.commit_sha}
        scannedAt={report.scanned_at}
        scan={{
          phase: scanStatus.phase,
          progress: scanStatus.progress,
          stopping,
          onScan: () => runScan(activeBranch),
          onStop: stopScan,
        }}
      />

      <div className="grid flex-1 gap-4 p-4 lg:grid-cols-2">
        <div className="flex min-h-0 flex-col gap-4">
          {/* The one region that swaps. Everything else stays put, which is the
              whole point of D-CR7: the tree and the list remain usable. */}
          {detailMode ? (
            <FindingDetailPanel finding={selectedFinding} onClose={closeFinding} />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <OverallHealthCard
                score={report.health_score}
                grade={report.grade}
                delta={report.delta}
                redIssueCount={report.red_issue_count}
                categoryBreakdown={report.category_breakdown}
              />
              <HealthGraphCard history={report.history} />
            </div>
          )}

          {/* Shrunk, not hidden, in detail mode — moving to the next finding is
              one click, with no close-and-reopen. */}
          <div className={detailMode ? "min-h-0 flex-1 overflow-y-auto" : undefined}>
            <RefactorFirstList
              findings={report.findings}
              onSelect={openFinding}
              selectedFingerprint={selectedFinding?.fingerprint}
            />
          </div>
        </div>

        <div className="max-h-[70vh] overflow-y-auto rounded-lg border p-2">
          <FileTree
            nodes={report.tree}
            colorFor={(node) => healthColor(node.health_score)}
            onHoverNode={setHoveredNode}
            selectedPath={selectedFinding?.file}
            onSelectNode={(node) => {
              const match = report.findings.find((f) => f.file === node.path)
              if (match) openFinding(match)
            }}
          />
        </div>
      </div>
    </div>
  )
}
