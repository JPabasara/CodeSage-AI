"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { FolderX, GitBranch, ScanSearch } from "lucide-react"
import { toast } from "sonner"

import { DashboardTopNav } from "@/components/layout/dashboard-topnav"
import { OverallHealthCard } from "@/components/dashboard/overall-health-card"
import { HealthGraphCard } from "@/components/dashboard/health-graph-card"
import { RefactorFirstList } from "@/components/dashboard/refactor-first-list"
import { FindingDetailPanel } from "@/components/dashboard/finding-detail-panel"
import {
  DashboardViewModeBar,
  dashboardViewPreferenceKey,
  isDashboardViewMode,
  type DashboardViewMode,
} from "@/components/dashboard/dashboard-view-mode-bar"
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
import { ApiRequestError, setFindingStatus } from "@/lib/api/client"
import { useBranches } from "@/hooks/use-branches"
import { useSelectedBranch } from "@/hooks/use-selected-branch"
import { useActiveWorkspaceId } from "@/hooks/use-workspace-scope"
import { useHealthReport } from "@/hooks/use-health-report"
import { useProjects } from "@/hooks/use-projects"
import {
  acknowledgeScan,
  discoverScan,
  isJobActive,
  onScanEvent,
  pinScanResults,
  useScanFor,
} from "@/hooks/use-scan-center"
import { useSession } from "@/hooks/use-session"
import { ScanStatusStrip } from "@/components/layout/scan-status-strip"
import { ScanProgressPanel } from "@/components/dashboard/scan-progress-panel"
import { useScanHistory } from "@/hooks/use-scan-history"
import type { Finding, FindingStatus, TreeNode } from "@/lib/types"
import { SCAN_SHARE, toBar } from "@/lib/scan-progress"
import { healthColor } from "@/lib/utils"

export function DashboardView({ repoId }: Readonly<{ repoId: string }>) {
  const { data: branches, error: branchesError } = useBranches(repoId)

  const { data: repos } = useProjects()
  const repo = repos?.find((r) => r.id === repoId)
  const reposLoaded = repos !== undefined
  const repoName = repo
    ? `${repo.owner}/${repo.name}`
    : reposLoaded
      ? "Project unavailable"
      : "Loading project"

  // A user pick wins; until then fall back to the repo's default branch, then the first available one.
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
  // The branch this project was last looked at.
  const workspaceId = useActiveWorkspaceId()
  const { storedBranch, rememberBranch } = useSelectedBranch(
    workspaceId,
    repoId,
  )
  const rememberedBranch =
    branchNames && storedBranch && branchNames.includes(storedBranch)
      ? storedBranch
      : undefined
  // The URL wins, then a pick made here, then the remembered one, then the repository's default.
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
    scan: trackedScan,
    start: startTrackedScan,
    stop: stopTrackedScan,
  } = useScanFor(repoId, activeBranch, repo?.name)
  const jobActive = Boolean(trackedScan && isJobActive(trackedScan))

  // Once the scan is done, "latest" is the new snapshot.
  const pinnedSnapshotId =
    trackedScan && trackedScan.job !== "scanning"
      ? trackedScan.pinnedSnapshotId
      : undefined
  const readSnapshotId = snapshotId ?? pinnedSnapshotId

  const {
    data: report,
    loading,
    pending: scorePending,
    pendingSlow: scorePendingSlow,
    error,
    refetch,
  } = useHealthReport(repoId, activeBranch, readSnapshotId, {
    enabled: readsEnabled,
  })
  const [animateCharts] = useState(() => report === undefined)

  const { data: session } = useSession()
  const permissions = session?.permissions ?? []
  // Until the session answers, assume the button is usable rather than flash a locked one at everyone.
  const canStartScan = !session || permissions.includes("scan:start")
  const canStopScan =
    !session ||
    permissions.includes("scan:cancel_own") ||
    permissions.includes("scan:cancel_any")
  const canTriage =
    permissions.includes("finding:triage") ||
    session?.role === "org-admin" ||
    session?.role === "manager" ||
    session?.role === "developer"
  const [findingStatusOverrides, setFindingStatusOverrides] = useState<
    Record<string, FindingStatus>
  >({})
  const [statusBusyFingerprint, setStatusBusyFingerprint] = useState<string>()
  const viewPreferenceKey =
    session?.user_id && workspaceId
      ? dashboardViewPreferenceKey(session.user_id, workspaceId)
      : undefined
  const [chosenView, setChosenView] = useState<{
    key: string | undefined
    mode: DashboardViewMode
  }>(() => ({
    key: undefined,
    mode: searchParams.get("finding") ? "findings-detail" : "overview",
  }))
  const storedView =
    viewPreferenceKey && typeof window !== "undefined"
      ? window.localStorage.getItem(viewPreferenceKey)
      : null
  const viewMode =
    chosenView.key === viewPreferenceKey
      ? chosenView.mode
      : searchParams.get("finding")
        ? "findings-detail"
        : isDashboardViewMode(storedView)
          ? storedView
          : "overview"

  const trackedKey = trackedScan?.key
  const trackedJob = trackedScan?.job
  useEffect(() => {
    if (trackedKey && trackedJob === "scanning" && report && !snapshotId) {
      pinScanResults(trackedKey, report)
    }
  }, [trackedKey, trackedJob, report, snapshotId])

  useEffect(() => {
    if (!workspaceId || !activeBranch) return
    void discoverScan({
      workspaceId,
      repoId,
      branch: activeBranch,
      repoName: repo?.name,
    })
  }, [workspaceId, repoId, activeBranch, repo?.name])

  const showJobCard = Boolean(
    trackedScan &&
    (trackedScan.job === "ready" || (jobActive && (loading || report))),
  )
  const showNewResults = () => {
    if (!trackedScan) return
    acknowledgeScan(trackedScan.key)
    // Viewing an older snapshot? The new results are the latest one.
    if (snapshotId) {
      router.push(dashboardHref({ snapshot_id: null, finding: null }), {
        scroll: false,
      })
    }
  }

  useEffect(
    () =>
      onScanEvent((event) => {
        if (
          event.type === "finished" &&
          event.scan.repoId === repoId &&
          event.scan.branch === activeBranch
        ) {
          reloadHistory()
        }
      }),
    [repoId, activeBranch, reloadHistory],
  )

  const displayedFindings = useMemo(
    () =>
      report?.findings.map((finding) => ({
        ...finding,
        status:
          findingStatusOverrides[
            `${report.snapshot_id}:${finding.fingerprint}`
          ] ?? finding.status,
      })) ?? [],
    [report, findingStatusOverrides],
  )
  const selectedFingerprint = searchParams.get("finding") ?? undefined
  const selectedFinding: Finding | null =
    displayedFindings.find((f) => f.fingerprint === selectedFingerprint) ?? null
  // The file tree writes the hovered node here.
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

  const rememberViewMode = (next: DashboardViewMode) => {
    setChosenView({ key: viewPreferenceKey, mode: next })
    if (viewPreferenceKey) window.localStorage.setItem(viewPreferenceKey, next)
  }

  const openFinding = (finding: Finding) => {
    setTreeSelectionNotice(null)
    rememberViewMode("findings-detail")
    router.push(dashboardHref({ finding: finding.fingerprint }), {
      scroll: false,
    })
  }

  const closeFinding = () => {
    setTreeSelectionNotice(null)
    rememberViewMode("findings")
    router.push(dashboardHref({ finding: null }), { scroll: false })
  }

  const chooseViewMode = (next: DashboardViewMode) => {
    if (
      next === "findings-detail" &&
      !selectedFinding &&
      displayedFindings[0]
    ) {
      openFinding(displayedFindings[0])
      return
    }
    rememberViewMode(next)
  }

  const changeFindingStatus = async (
    finding: Finding,
    status: FindingStatus,
  ) => {
    if (!report || !canTriage) return
    const snapshotIdForWrite = report.snapshot_id
    const overrideKey = `${snapshotIdForWrite}:${finding.fingerprint}`
    const previousStatus = finding.status
    setStatusBusyFingerprint(finding.fingerprint)
    setFindingStatusOverrides((current) => ({
      ...current,
      [overrideKey]: status,
    }))
    try {
      await setFindingStatus(snapshotIdForWrite, finding.fingerprint, status)
      toast.success(
        status === "done" ? "Finding marked as done." : "Finding reopened.",
      )
    } catch (thrown: unknown) {
      setFindingStatusOverrides((current) => ({
        ...current,
        [overrideKey]: previousStatus,
      }))
      toast.error(
        thrown instanceof Error
          ? thrown.message
          : "Could not update the finding. Try again.",
      )
    } finally {
      setStatusBusyFingerprint(undefined)
    }
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

  // A branch that has never been scanned answers 404.
  const neverScanned =
    error instanceof ApiRequestError && error.code === "NOT_FOUND"

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

    if (jobActive && trackedScan && !loading && !report) {
      return <ScanProgressPanel kind="job" scan={trackedScan} size="full" />
    }

    // A score being recalculated with no scan behind it — after a profile change.
    if (scorePending && !report) {
      return <ScanProgressPanel kind="calculating" slow={scorePendingSlow} />
    }

    if (!reposLoaded || loading) {
      return <DashboardSkeleton />
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
    const findingFiles = new Set(
      displayedFindings.map((finding) => finding.file),
    )
    const findingPanel = () => (
      <RefactorFirstList
        findings={displayedFindings}
        onSelect={openFinding}
        selectedFingerprint={selectedFinding?.fingerprint}
        canTriage={canTriage}
        statusBusyFingerprint={statusBusyFingerprint}
        onStatusChange={changeFindingStatus}
        includeTestFindingsByDefault={report.include_test_findings ?? false}
        repoId={repoId}
        treeNodes={report.tree}
      />
    )
    const treePanel = () => (
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
          const match = displayedFindings.find((f) => f.file === node.path)
          if (match) openFinding(match)
        }}
      />
    )
    const viewBar = (
      <DashboardViewModeBar value={viewMode} onChange={chooseViewMode} />
    )

    if (viewMode === "findings") {
      return (
        <div className="flex min-h-0 flex-1 flex-col" data-view-mode={viewMode}>
          <div className="min-h-0 flex-1 overflow-y-auto p-4 lg:overflow-hidden">
            {findingPanel()}
          </div>
          {viewBar}
        </div>
      )
    }

    if (viewMode === "findings-tree") {
      return (
        <div className="flex min-h-0 flex-1 flex-col" data-view-mode={viewMode}>
          <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(19rem,0.65fr)] lg:overflow-hidden">
            <div className="min-h-0">{findingPanel()}</div>
            <div className="h-[32rem] min-h-0 lg:h-auto">{treePanel()}</div>
          </div>
          {viewBar}
        </div>
      )
    }

    if (viewMode === "findings-detail") {
      return (
        <div className="flex min-h-0 flex-1 flex-col" data-view-mode={viewMode}>
          <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(20rem,0.95fr)] lg:overflow-hidden">
            <div className="min-h-0">{findingPanel()}</div>
            <div className="min-h-64">
              <FindingDetailPanel
                finding={selectedFinding}
                hasFindings={displayedFindings.length > 0}
                onClose={closeFinding}
                canTriage={canTriage}
                statusBusy={
                  statusBusyFingerprint === selectedFinding?.fingerprint
                }
                onStatusChange={changeFindingStatus}
              />
            </div>
          </div>
          {viewBar}
        </div>
      )
    }

    return (
      <div className="flex min-h-0 flex-1 flex-col" data-view-mode={viewMode}>
        <div className={DASHBOARD_GRID}>
          <div className={DASHBOARD_MAIN_COLUMN}>
            {/* Overview keeps the health summary above the ranked list. */}
            <div className={DASHBOARD_TOP_ROW}>
              <OverallHealthCard
                score={report.health_score}
                grade={report.grade}
                delta={report.delta}
                redIssueCount={report.red_issue_count}
                categoryBreakdown={report.category_breakdown}
                animate={animateCharts}
              />
              <HealthGraphCard history={report.history} />
            </div>

            <div className={DASHBOARD_LIST_SLOT}>{findingPanel()}</div>
          </div>

          <div className={DASHBOARD_TREE_SLOT}>{treePanel()}</div>
        </div>
        {viewBar}
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
        profileName={report?.profile}
        scan={{
          phase:
            trackedScan && jobActive
              ? trackedScan.job === "scoring"
                ? "running"
                : trackedScan.status.phase
              : "idle",
          scoring: trackedScan?.job === "scoring",
          // Only the screen-reader summary reads this, in quarters: the bar itself lives in the panel.
          progress: trackedScan
            ? trackedScan.job === "scoring"
              ? SCAN_SHARE
              : Math.floor(toBar(trackedScan.status.progress))
            : 0,
          stopping: trackedScan?.stopping ?? false,
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

      {trackedScan && showJobCard ? (
        <ScanProgressPanel
          kind="job"
          scan={trackedScan}
          size="compact"
          onShow={showNewResults}
        />
      ) : null}

      <div className="flex min-h-0 flex-1" data-tour="dashboard-results">
        {body()}
      </div>
    </div>
  )
}
