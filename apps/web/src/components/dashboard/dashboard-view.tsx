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
import { ApiRequestError } from "@/lib/api/client"
import { useBranches } from "@/hooks/use-branches"
import { useHealthReport } from "@/hooks/use-health-report"
import { useProjects } from "@/hooks/use-projects"
import { useScan } from "@/hooks/use-scan"
import type { Finding, TreeNode } from "@/lib/types"
import { healthColor } from "@/lib/utils"

export function DashboardView({ repoId }: Readonly<{ repoId: string }>) {
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

  const {
    data: report,
    loading,
    error,
    reload,
  } = useHealthReport(repoId, activeBranch)

  // The Scan button's state machine (start → poll progress → done/stop + toast).
  const {
    status: scanStatus,
    stopping,
    scan: runScan,
    stop: stopScan,
  } = useScan(repoId, reload)

  // The selected finding lives in the URL, not in state, so a refresh restores
  // detail mode and Back closes it. Fingerprints are stable across scans, which
  // is what a shareable link needs.
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const selectedFingerprint = searchParams.get("finding") ?? undefined
  const selectedFinding: Finding | null =
    report?.findings.find((f) => f.fingerprint === selectedFingerprint) ?? null
  const detailMode = selectedFinding !== null
  // The file tree writes the hovered node here. Card B always shows repo health
  // today, so only the setter is used and the value is deliberately discarded.
  // Wiring it up later means keeping the value, passing it to Card B, and adding
  // a per-node history to TreeNode.
  const [, setHoveredNode] = useState<TreeNode | null>(null)

  // push, not replace: Back should leave detail mode, the way it does in a mail
  // client. scroll: false keeps the dashboard where it is as the region swaps.
  const openFinding = (finding: Finding) =>
    router.push(
      `${pathname}?finding=${encodeURIComponent(finding.fingerprint)}`,
      {
        scroll: false,
      },
    )

  const closeFinding = () => router.push(pathname, { scroll: false })

  // A branch that has never been scanned answers 404. That is the first-run
  // state, not a failure, so it must not take the whole screen down.
  const neverScanned =
    error instanceof ApiRequestError && error.code === "NOT_FOUND"

  // The top nav always renders above this. It used to live inside the success
  // branch, so a freshly connected repository (404, no snapshot) lost the very
  // Scan button that would produce the first one. Only the body below swaps.
  const body = () => {
    if (loading) {
      return (
        <div className="space-y-4 p-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Skeleton className="h-64 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        </div>
      )
    }

    if (neverScanned) {
      return (
        <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-1 p-6 text-center text-sm">
          <p className="text-foreground font-medium">No scans yet</p>
          <p>
            {activeBranch
              ? `Nothing has been analyzed on ${activeBranch} yet.`
              : "This repository has not been analyzed yet."}{" "}
            Run your first scan to see its health.
          </p>
        </div>
      )
    }

    if (error) {
      return (
        <div className="text-destructive p-6 text-sm">
          Couldn’t load this dashboard: {error.message}
        </div>
      )
    }

    if (!report) return null

    return (
      <div className="grid flex-1 gap-4 p-4 lg:grid-cols-2">
        <div className="flex min-h-0 flex-col gap-4">
          {/* The one region that swaps, so the tree and the list stay usable. */}
          {detailMode ? (
            <FindingDetailPanel
              finding={selectedFinding}
              onClose={closeFinding}
            />
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
          <div
            className={
              detailMode ? "min-h-0 flex-1 overflow-y-auto" : undefined
            }
          >
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
    )
  }

  return (
    <div className="flex h-full flex-col">
      <DashboardTopNav
        repoName={repoName}
        branches={branches ?? []}
        activeBranch={activeBranch}
        onBranchChange={setPickedBranch}
        lastCommitSha={report?.commit_sha}
        scannedAt={report?.scanned_at}
        scan={{
          phase: scanStatus.phase,
          progress: scanStatus.progress,
          stopping,
          onScan: () => runScan(activeBranch),
          onStop: stopScan,
        }}
      />

      {body()}
    </div>
  )
}
