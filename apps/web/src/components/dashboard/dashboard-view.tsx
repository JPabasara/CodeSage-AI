"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { FolderX, GitBranch, ScanSearch } from "lucide-react"
import { toast } from "sonner"

import { DashboardTopNav } from "@/components/layout/dashboard-topnav"
import { OverallHealthCard } from "@/components/dashboard/overall-health-card"
import { HealthGraphCard } from "@/components/dashboard/health-graph-card"
import { RefactorFirstList } from "@/components/dashboard/refactor-first-list"
import { FindingDetailPanel } from "@/components/dashboard/finding-detail-panel"
import { FileTree } from "@/components/dashboard/file-tree/file-tree"
import {
  DASHBOARD_GRID,
  DASHBOARD_LIST_SLOT,
  DASHBOARD_MAIN_COLUMN,
  DASHBOARD_TOP_ROW,
  DASHBOARD_TREE_SLOT,
  DashboardSkeleton,
} from "@/components/dashboard/dashboard-skeleton"
import { EmptyState } from "@/components/empty-state"
import { ErrorState } from "@/components/error-state"
import { Button } from "@/components/ui/button"
import { ApiRequestError } from "@/lib/api/client"
import { useBranches } from "@/hooks/use-branches"
import { useSelectedBranch } from "@/hooks/use-selected-branch"
import { useActiveWorkspaceId } from "@/hooks/use-workspace-scope"
import { useHealthReport } from "@/hooks/use-health-report"
import { useProjects } from "@/hooks/use-projects"
import { discoverScan, onScanEvent, useScanFor } from "@/hooks/use-scan-center"
import { useSession } from "@/hooks/use-session"
import { ScanStatusStrip } from "@/components/layout/scan-status-strip"
import { useScanHistory } from "@/hooks/use-scan-history"
import type { Finding, TreeNode } from "@/lib/types"
import { healthColor } from "@/lib/utils"

export function DashboardView({ repoId }: Readonly<{ repoId: string }>) {
  const { data: branches, error: branchesError } = useBranches(repoId)

  // `repo_id` is a uuid in the contract, so the top nav cannot just print it —
  // "7c9e6679-7425-40de-…" is not a repository name. Look up the connected repo
  // and fall back to the id only while the list is still loading.
  const { data: repos } = useProjects()
  const repo = repos?.find((r) => r.id === repoId)
  const reposLoaded = repos !== undefined
  const repoName = repo
    ? `${repo.owner}/${repo.name}`
    : reposLoaded
      ? "Project unavailable"
      : "Loading project"

  // A user pick wins; until then fall back to the repo's default branch, then
  // the first available one. Empty string until the branches load; nothing is
  // fetched for it (see `readsEnabled` below).
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const branchFromUrl = searchParams.get("branch") ?? undefined
  const snapshotId = searchParams.get("snapshot_id") ?? undefined
  const [pickedBranch, setPickedBranch] = useState<string>()
  const branchNames = branches?.map((branch) => branch.name)
  const branchIsAvailable = (branch: string | undefined) =>
    Boolean(branch && (!branchNames || branchNames.includes(branch)))
  const fallbackBranch =
    branches?.find((branch) => branch.is_default)?.name ?? branches?.[0]?.name
  // The branch this project was last looked at. Only trusted once the branch
  // list has landed and still contains it — a deleted branch falls back quietly.
  const workspaceId = useActiveWorkspaceId()
  const { storedBranch, rememberBranch } = useSelectedBranch(
    workspaceId,
    repoId,
  )
  const rememberedBranch =
    branchNames && storedBranch && branchNames.includes(storedBranch)
      ? storedBranch
      : undefined
  // The URL wins, then a pick made here, then the remembered one, then the
  // repository's default.
  const activeBranch =
    (branchIsAvailable(branchFromUrl)
      ? branchFromUrl
      : branchIsAvailable(pickedBranch)
        ? pickedBranch
        : (rememberedBranch ?? fallbackBranch)) ?? ""

  // Remember whatever the page settled on, once it is a real branch.
  const settledOnRealBranch = Boolean(branchNames?.includes(activeBranch))
  useEffect(() => {
    if (settledOnRealBranch) rememberBranch(activeBranch)
  }, [activeBranch, settledOnRealBranch, rememberBranch])

  // Resolve the branch first, then fetch once (13G). Asking before the branch
  // list landed meant a request for a guessed branch, and its 404 flashed "No
  // scans yet" at a project that has results. The one exception: if the branch
  // list itself failed, ask for the URL's branch or, without one, the
  // repository's default (the empty branch) rather than leave the page waiting
  // on a list that is not coming.
  const noBranches = branches !== undefined && branches.length === 0
  const branchResolved =
    settledOnRealBranch || (branchesError !== undefined && !branches)
  const projectGone = reposLoaded && !repo
  const readsEnabled = branchResolved && !projectGone

  const { data: scanHistory, reload: reloadHistory } = useScanHistory(
    repoId,
    activeBranch,
    { enabled: readsEnabled },
  )

  const {
    data: report,
    loading,
    pending: scorePending,
    error,
    refetch,
    reload: reloadReport,
  } = useHealthReport(repoId, activeBranch, snapshotId, {
    enabled: readsEnabled,
  })

  // The scan lives in the app-wide scan store, not in this page: leaving the
  // dashboard mid-scan and coming back shows it still running, with Stop.
  const { data: session } = useSession()
  const permissions = session?.permissions ?? []
  // Until the session answers, assume the button is usable rather than flash
  // a locked one at everyone.
  const canStartScan = !session || permissions.includes("scan:start")
  const canStopScan =
    !session ||
    permissions.includes("scan:cancel_own") ||
    permissions.includes("scan:cancel_any")
  const {
    scan: trackedScan,
    start: startTrackedScan,
    stop: stopTrackedScan,
  } = useScanFor(repoId, activeBranch, repo?.name)

  // A scan this tab never started — a teammate's, another tab's, one from
  // before a refresh on a cleared tab — is found and followed.
  useEffect(() => {
    if (!workspaceId || !activeBranch) return
    void discoverScan({
      workspaceId,
      repoId,
      branch: activeBranch,
      repoName: repo?.name,
    })
  }, [workspaceId, repoId, activeBranch, repo?.name])

  // When this branch's scan finishes, refresh the numbers in place — quietly,
  // with no skeleton; a score still being prepared shows as exactly that.
  useEffect(
    () =>
      onScanEvent((event) => {
        if (
          event.type === "finished" &&
          event.scan.repoId === repoId &&
          event.scan.branch === activeBranch
        ) {
          reloadReport()
          reloadHistory()
        }
      }),
    [repoId, activeBranch, reloadReport, reloadHistory],
  )

  // The selected finding lives in the URL, not in state, so a refresh restores
  // detail mode and Back closes it. Fingerprints are stable across scans, which
  // is what a shareable link needs.
  const selectedFingerprint = searchParams.get("finding") ?? undefined
  const selectedFinding: Finding | null =
    report?.findings.find((f) => f.fingerprint === selectedFingerprint) ?? null
  const detailMode = selectedFinding !== null
  // The file tree writes the hovered node here. Card B always shows repo health
  // today, so only the setter is used and the value is deliberately discarded.
  // Wiring it up later means keeping the value, passing it to Card B, and adding
  // a per-node history to TreeNode.
  const [, setHoveredNode] = useState<TreeNode | null>(null)
  const [treeSelectionNotice, setTreeSelectionNotice] = useState<string | null>(
    null,
  )

  const dashboardHref = (
    updates: Record<string, string | undefined | null>,
  ) => {
    const next = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined || value === null || value === "") {
        next.delete(key)
      } else {
        next.set(key, value)
      }
    }
    const query = next.toString()
    return query ? `${pathname}?${query}` : pathname
  }

  // push, not replace: Back should leave detail mode, the way it does in a mail
  // client. scroll: false keeps the dashboard where it is as the region swaps.
  const openFinding = (finding: Finding) => {
    setTreeSelectionNotice(null)
    router.push(dashboardHref({ finding: finding.fingerprint }), {
      scroll: false,
    })
  }

  const closeFinding = () => {
    setTreeSelectionNotice(null)
    router.push(dashboardHref({ finding: null }), { scroll: false })
  }

  const openSnapshot = (snapshot_id: string | null) => {
    setTreeSelectionNotice(null)
    router.push(
      dashboardHref({
        branch: activeBranch,
        snapshot_id,
        finding: null,
      }),
      { scroll: false },
    )
  }

  const currentSnapshotId = snapshotId ?? report?.snapshot_id
  const currentScanIndex =
    scanHistory?.findIndex((scan) => scan.snapshot_id === currentSnapshotId) ??
    -1
  const snapshotNavigation =
    scanHistory && scanHistory.length > 0
      ? {
          isHistorical: Boolean(snapshotId),
          isLatest: currentScanIndex === 0,
          positionLabel:
            currentScanIndex >= 0
              ? `${scanHistory.length - currentScanIndex}/${scanHistory.length}`
              : snapshotId
                ? "History"
                : "Latest",
          canGoOlder:
            currentScanIndex >= 0 && currentScanIndex < scanHistory.length - 1,
          canGoNewer: currentScanIndex > 0,
          showLatestButton: currentScanIndex > 0,
          onOlder: () => {
            if (currentScanIndex >= 0) {
              const older = scanHistory[currentScanIndex + 1]
              if (older) openSnapshot(older.snapshot_id)
            }
          },
          onNewer: () => {
            if (currentScanIndex > 0) {
              const newer = scanHistory[currentScanIndex - 1]
              if (newer) openSnapshot(newer.snapshot_id)
            }
          },
          onLatest: () => openSnapshot(null),
        }
      : undefined

  // A branch that has never been scanned answers 404. That is the first-run
  // state, not a failure, so it must not take the whole screen down. Only a
  // real read can say so: the report is not asked for until the branch is
  // resolved, so there is no guessed-branch 404 to mistake for it.
  const neverScanned =
    error instanceof ApiRequestError && error.code === "NOT_FOUND"

  // The top nav always renders above this. It used to live inside the success
  // branch, so a freshly connected repository (404, no snapshot) lost the very
  // Scan button that would produce the first one. Only the body below swaps.
  const body = () => {
    if (projectGone) {
      return (
        <EmptyState
          className="m-4 flex-1"
          icon={<FolderX />}
          title="Choose a project"
          description="This project is not connected to your workspace anymore. Select an available repository to open its dashboard."
          action={
            <Button asChild size="sm" variant="secondary">
              <Link href="/projects">View projects</Link>
            </Button>
          }
        />
      )
    }

    // The repository has no branches at all, so there is nothing to scan and
    // nothing to ask the report for.
    if (noBranches) {
      return (
        <EmptyState
          className="m-4 flex-1"
          icon={<GitBranch />}
          title="No scans yet"
          description="This repository has no branches yet. Push a branch, then run your first scan to see its health."
        />
      )
    }

    // Two different waits, one shape. `loading` is "the request is in flight"
    // — or held until the project and branch are known; `scorePending` is "the
    // snapshot is stored and the API is still scoring it" (503 SCORE_PENDING).
    // The second only ever follows a scan, so it earns a sentence — an
    // unlabelled skeleton right after "Scan complete" reads as a stall. The
    // hook keeps asking; nothing here has to.
    //
    // A quiet reload after a scan keeps the report on screen, so neither of
    // these shows then.
    if (!reposLoaded || loading || scorePending) {
      return (
        <DashboardSkeleton
          notice={
            scorePending ? (
              <div
                // polite, not assertive: it is progress, and it must not
                // interrupt a screen reader mid-sentence.
                role="status"
                aria-live="polite"
                className="flex flex-col justify-center gap-1 rounded-lg border bg-card p-4 text-sm"
              >
                <p className="font-medium text-foreground">
                  Calculating your health score…
                </p>
                <p className="text-muted-foreground">
                  Your scan finished. Scoring it against the active profile
                  takes a few seconds.
                </p>
              </div>
            ) : undefined
          }
        />
      )
    }

    if (neverScanned) {
      return (
        <EmptyState
          className="m-4 flex-1"
          icon={<ScanSearch />}
          title="No scans yet"
          description={`${
            activeBranch
              ? `Nothing has been analyzed on ${activeBranch} yet.`
              : "This repository has not been analyzed yet."
          } Run your first scan to see its health.`}
        />
      )
    }

    // A genuine failure, and only a genuine failure, gets here — SCORE_PENDING
    // was handled above and a 404 is the empty state. Retry re-runs the read
    // from scratch, including a fresh score-pending budget.
    if (error) {
      return (
        <ErrorState
          title="Couldn’t load this dashboard"
          detail={error.message}
          onRetry={refetch}
          className="flex-1 items-center justify-center p-6 text-center"
        />
      )
    }

    if (!report) return null
    const findingFiles = new Set(report.findings.map((finding) => finding.file))

    return (
      <div className={DASHBOARD_GRID}>
        <div className={DASHBOARD_MAIN_COLUMN}>
          {/* The one region that swaps, so the tree and the list stay usable. */}
          {detailMode ? (
            <FindingDetailPanel
              finding={selectedFinding}
              onClose={closeFinding}
            />
          ) : (
            <div className={DASHBOARD_TOP_ROW}>
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
          <div className={DASHBOARD_LIST_SLOT}>
            <RefactorFirstList
              findings={report.findings}
              onSelect={openFinding}
              selectedFingerprint={selectedFinding?.fingerprint}
            />
          </div>
        </div>

        <div className={DASHBOARD_TREE_SLOT}>
          <FileTree
            nodes={report.tree}
            colorFor={(node) => healthColor(node.health_score)}
            hasFinding={(node) => findingFiles.has(node.path)}
            onHoverNode={setHoveredNode}
            onSelectNodeWithoutFinding={(node) => {
              const message = `${node.name} has no findings in this snapshot.`
              setTreeSelectionNotice(message)
              toast(message)
            }}
            selectionNotice={treeSelectionNotice}
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
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <DashboardTopNav
        repoName={repoName}
        branches={branches ?? []}
        branchesLoaded={branches !== undefined}
        activeBranch={activeBranch}
        onBranchChange={(branch) => {
          setTreeSelectionNotice(null)
          setPickedBranch(branch)
          router.push(
            dashboardHref({
              branch,
              snapshot_id: null,
              finding: null,
            }),
            { scroll: false },
          )
        }}
        lastCommitSha={report?.commit_sha}
        scannedAt={report?.scanned_at}
        snapshotLoading={!report && !error}
        snapshotNavigation={snapshotNavigation}
        scan={{
          phase: trackedScan?.status.phase ?? "idle",
          progress: trackedScan?.status.progress ?? 0,
          stopping: trackedScan?.stopping ?? false,
          // Only once there is a branch to scan.
          onScan: activeBranch ? startTrackedScan : undefined,
          // Stop lives in the status strip below the bar.
          showStop: false,
          lockedReason: canStartScan ? undefined : "Viewers can't start scans",
        }}
      />

      <ScanStatusStrip
        scan={trackedScan}
        canStop={canStopScan}
        onStop={stopTrackedScan}
      />

      {body()}
    </div>
  )
}
