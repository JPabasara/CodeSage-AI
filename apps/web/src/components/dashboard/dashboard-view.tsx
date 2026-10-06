"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { FolderX, GitBranch } from "lucide-react"
import { toast } from "sonner"

import { ProjectHeader } from "@/components/dashboard/project-header"
import { DashboardOverview } from "@/components/dashboard/dashboard-overview"
import { RefactorFirstList } from "@/components/dashboard/refactor-first-list"
import { FindingDetailPanel } from "@/components/dashboard/finding-detail-panel"
import { FileDetailPanel } from "@/components/dashboard/file-detail-panel"
import {
  DashboardTabs,
  dashboardPanelId,
  dashboardTabId,
  isDashboardTab,
  readStoredDashboardTab,
  storeDashboardTab,
  type DashboardTab,
} from "@/components/dashboard/dashboard-tabs"
import {
  javaBannerKey,
  JavaScopeBanner,
} from "@/components/dashboard/java-scope-banner"
import { FileTree } from "@/components/dashboard/file-tree/file-tree"
import { DashboardSkeleton } from "@/components/dashboard/dashboard-skeleton"
import { FirstScanCard } from "@/components/dashboard/first-scan-card"
import { PAGE_CONTAINER } from "@/components/layout/page-container"
import { EmptyState } from "@/components/empty-state"
import { ErrorState } from "@/components/error-state"
import { Button } from "@/components/ui/button"
import { ApiRequestError, setFindingStatus } from "@/lib/api/client"
import { useActiveBranch } from "@/hooks/use-active-branch"
import { useActiveWorkspaceId } from "@/hooks/use-workspace-scope"
import { useHealthReport } from "@/hooks/use-health-report"
import { useProjects } from "@/hooks/use-projects"
import {
  acknowledgeScan,
  discoverScan,
  isJobActive,
  isStopping,
  onScanEvent,
  pinScanResults,
  useScanFor,
  useScanLive,
} from "@/hooks/use-scan-center"
import { useSession } from "@/hooks/use-session"
import { ScanProgressCard } from "@/components/dashboard/scan-progress-card"
import { ScanProgressPanel } from "@/components/dashboard/scan-progress-panel"
import { useScanHistory } from "@/hooks/use-scan-history"
import { findingSummary, leafFiles } from "@/lib/dashboard-summary"
import type { Finding, FindingStatus, TreeNode } from "@/lib/types"
import { cn, healthColor } from "@/lib/utils"

const numbers = new Intl.NumberFormat("en-US")

/** The code map's tree scrolls inside; tall enough to work in, short enough to keep the header. */
const PANEL_HEIGHT = "h-[min(46rem,calc(100svh-15rem))] min-h-[26rem]"

export function DashboardView({ repoId }: Readonly<{ repoId: string }>) {
  const { data: repos } = useProjects()
  const repo = repos?.find((r) => r.id === repoId)
  const reposLoaded = repos !== undefined
  const repoName = repo
    ? repo.name
    : reposLoaded
      ? "Project unavailable"
      : "Loading project"

  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const snapshotId = searchParams.get("snapshot_id") ?? undefined
  const workspaceId = useActiveWorkspaceId()
  const {
    branches,
    branchesError,
    activeBranch,
    settledOnRealBranch,
    rememberBranch,
  } = useActiveBranch(repoId)

  // Remember whatever the page settled on, once it is a real branch.
  useEffect(() => {
    if (settledOnRealBranch) rememberBranch(activeBranch)
  }, [activeBranch, settledOnRealBranch, rememberBranch])

  const noBranches = branches !== undefined && branches.length === 0
  const branchResolved =
    settledOnRealBranch ||
    (branches === undefined && Boolean(activeBranch)) ||
    (branchesError !== undefined && !branches)
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
  // The header's "Scanning 41%" reads the same live bar as the progress card.
  const liveScan = useScanLive(trackedScan?.key)

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

  // The view: the URL first, a finding link means Findings, then the last choice.
  const selectedFingerprint = searchParams.get("finding") ?? undefined
  const viewFromUrl = searchParams.get("view")
  const userId = session?.user_id
  const storedTab =
    userId && workspaceId && typeof window !== "undefined"
      ? readStoredDashboardTab(userId, workspaceId)
      : undefined
  const tab: DashboardTab = isDashboardTab(viewFromUrl)
    ? viewFromUrl
    : selectedFingerprint
      ? "findings"
      : (storedTab ?? "overview")
  const selectedFilePath = searchParams.get("file") ?? undefined

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

  // Above results only. While the report loads, a never-scanned branch is still
  // possible, and that one gets the full-page card instead; showing this one
  // first would flash it.
  const showJobCard = Boolean(
    trackedScan && (trackedScan.job === "ready" || (jobActive && report)),
  )

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
  const selectedFinding: Finding | null =
    displayedFindings.find((f) => f.fingerprint === selectedFingerprint) ?? null
  // The file tree writes the hovered node here.
  const [, setHoveredNode] = useState<TreeNode | null>(null)

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

  const go = (updates: Record<string, string | undefined | null>) =>
    router.push(dashboardHref(updates), { scroll: false })

  const chooseTab = (next: DashboardTab) => {
    if (userId && workspaceId) storeDashboardTab(userId, workspaceId, next)
    go({ view: next })
  }

  const showNewResults = () => {
    if (!trackedScan) return
    acknowledgeScan(trackedScan.key)
    // Viewing an older snapshot? The new results are the latest one.
    if (snapshotId) go({ snapshot_id: null, finding: null })
  }

  const openFinding = (finding: Finding) => {
    if (userId && workspaceId)
      storeDashboardTab(userId, workspaceId, "findings")
    go({ view: "findings", finding: finding.fingerprint })
  }

  // Closing the detail stays on Findings, with the list in full view.
  const closeFinding = () => go({ view: "findings", finding: null })

  const openFile = (node: TreeNode) => {
    if (userId && workspaceId) storeDashboardTab(userId, workspaceId, "code")
    go({ view: "code", file: node.path })
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

  const openSnapshot = (snapshot_id: string | null) =>
    go({ branch: activeBranch, snapshot_id, finding: null })

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
              ? `Scan ${scanHistory.length - currentScanIndex} of ${scanHistory.length}`
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
          className="flex-1"
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
          className="flex-1"
          icon={<GitBranch />}
          title="No scans yet"
          description="This repository has no branches yet. Push a branch, then run your first scan to see its health."
        />
      )
    }

    // The first scan, or one on a branch with no results yet: the whole page is its progress.
    if (jobActive && trackedScan && !loading && !report) {
      return (
        <ScanProgressCard
          scan={trackedScan}
          size="full"
          canStop={canStopScan}
          onStop={stopTrackedScan}
        />
      )
    }

    // A score being recalculated with no scan behind it — after a profile change.
    if (scorePending && !report) {
      return <ScanProgressPanel kind="calculating" slow={scorePendingSlow} />
    }

    // An early guess at the branch can miss; wait for the list before saying so.
    const guessUnconfirmed =
      Boolean(error) && branches === undefined && branchesError === undefined
    if (!reposLoaded || loading || guessUnconfirmed) {
      return <DashboardSkeleton />
    }

    if (neverScanned) {
      return (
        <FirstScanCard
          repoName={repo?.name ?? "this repository"}
          branch={activeBranch}
          otherBranches={(branches?.length ?? 0) > 1}
          onScan={activeBranch ? startTrackedScan : undefined}
          lockedReason={canStartScan ? undefined : "Viewers can't start scans"}
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

    const includeExcluded = !(repo?.hide_excluded_findings ?? false)
    const summary = findingSummary(
      { ...report, include_test_findings: includeExcluded },
      displayedFindings,
    )
    const files = leafFiles(report.tree)
    const fileCount = report.java_file_count ?? files.length
    const findingFiles = new Set(
      displayedFindings.map((finding) => finding.file),
    )
    const selectedFile =
      files.find((file) => file.path === selectedFilePath) ?? null

    const panel = (id: DashboardTab, content: React.ReactNode) => (
      <div
        role="tabpanel"
        id={dashboardPanelId(id)}
        aria-labelledby={dashboardTabId(id)}
        data-view-mode={id}
        className="min-w-0"
      >
        {content}
      </div>
    )

    return (
      <div className="flex min-w-0 flex-col gap-4">
        {userId && workspaceId ? (
          <JavaScopeBanner
            storageKey={javaBannerKey(userId, workspaceId, repoId)}
            fileCount={fileCount}
            kloc={report.kloc}
          />
        ) : null}

        <DashboardTabs
          value={tab}
          onChange={chooseTab}
          counts={{
            findings: summary ? numbers.format(summary.open) : undefined,
            code: `${numbers.format(fileCount)} ${fileCount === 1 ? "file" : "files"}`,
          }}
        />

        {tab === "overview"
          ? panel(
              "overview",
              <DashboardOverview
                report={report}
                includeTestFindingsByDefault={includeExcluded}
                findings={displayedFindings}
                onOpenFinding={openFinding}
                onOpenFile={openFile}
                onShowFindings={() => chooseTab("findings")}
                onShowCodeMap={() => chooseTab("code")}
              />,
            )
          : null}

        {tab === "findings"
          ? panel(
              "findings",
              // The list is part of the page, which scrolls as a whole; the detail stays in view.
              <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(20rem,0.9fr)]">
                <div className="min-w-0">
                  <RefactorFirstList
                    key={repoId}
                    findings={displayedFindings}
                    onSelect={openFinding}
                    selectedFingerprint={selectedFinding?.fingerprint}
                    canTriage={canTriage}
                    statusBusyFingerprint={statusBusyFingerprint}
                    onStatusChange={changeFindingStatus}
                    includeTestFindingsByDefault={includeExcluded}
                    repoId={repoId}
                    canConfigure={
                      session?.permissions?.includes("profile:update") ?? false
                    }
                    treeNodes={report.tree}
                  />
                </div>
                <div className="min-h-64 lg:sticky lg:top-4 lg:self-start">
                  <FindingDetailPanel
                    canDisableRules={session?.role === "org-admin"}
                    finding={selectedFinding}
                    repositoryUrl={repo?.url}
                    commitSha={report.commit_sha}
                    hasFindings={displayedFindings.length > 0}
                    onClose={closeFinding}
                    canTriage={canTriage}
                    statusBusy={
                      statusBusyFingerprint === selectedFinding?.fingerprint
                    }
                    onStatusChange={changeFindingStatus}
                  />
                </div>
              </div>,
            )
          : null}

        {tab === "code"
          ? panel(
              "code",
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(20rem,0.9fr)]">
                <div className={PANEL_HEIGHT}>
                  <FileTree
                    nodes={report.tree}
                    colorFor={(node) => healthColor(node.health_score)}
                    hasFinding={(node) => findingFiles.has(node.path)}
                    onHoverNode={setHoveredNode}
                    onSelectNode={openFile}
                    onSelectNodeWithoutFinding={openFile}
                    selectionNotice={null}
                    selectedPath={selectedFile?.path}
                  />
                </div>
                <div className="lg:sticky lg:top-4 lg:self-start">
                  <FileDetailPanel
                    node={selectedFile}
                    findings={displayedFindings}
                    onOpenFinding={openFinding}
                  />
                </div>
              </div>,
            )
          : null}
      </div>
    )
  }

  return (
    <div className={cn(PAGE_CONTAINER, "gap-4")}>
      <ProjectHeader
        repoName={repoName}
        owner={repo?.owner}
        repoUrl={repo?.url}
        branch={activeBranch}
        commitSha={report?.commit_sha}
        scannedAt={report?.scanned_at}
        profileName={report?.profile}
        snapshotNavigation={snapshotNavigation}
        loading={!report && !error && !jobActive && !projectGone && !noBranches}
        scan={
          neverScanned && !jobActive
            ? undefined
            : {
                phase:
                  trackedScan && jobActive
                    ? trackedScan.job === "scoring"
                      ? "running"
                      : trackedScan.status.phase
                    : "idle",
                scoring: trackedScan?.job === "scoring",
                progress: Math.floor(liveScan?.bar ?? 0),
                stopping: trackedScan ? isStopping(trackedScan) : false,
                branch: activeBranch || undefined,
                onScan: activeBranch ? startTrackedScan : undefined,
                // Stop lives in the progress card under the header.
                showStop: false,
                lockedReason: canStartScan
                  ? undefined
                  : "Viewers can't start scans",
              }
        }
      />

      {/* One card for a running scan: the step, the count, the bar and Stop. */}
      {trackedScan && showJobCard ? (
        <ScanProgressCard
          scan={trackedScan}
          canStop={canStopScan}
          onStop={stopTrackedScan}
          onShow={showNewResults}
        />
      ) : null}

      <div className="flex min-w-0 flex-col" data-tour="dashboard-results">
        {body()}
      </div>
    </div>
  )
}
