// What the Activity menu lists: the jobs this tab follows (with their live
// bar), plus everything else the server says is running in the workspace.
// Kept pure, so the de-duplication rules are tested without a DOM.
import type { TrackedScan } from "@/hooks/use-scan-center"
import type { Activity, ScanStatus } from "@/lib/types"

export type ActivityItem =
  /** A job this tab follows: live bar, and "View" once ready. */
  | { kind: "job"; key: string; scan: TrackedScan }
  /** Someone else's scan (or one this tab does not follow). */
  | {
      kind: "scan"
      key: string
      repoId: string
      repoName: string
      branch: string
      status: ScanStatus
    }
  /** A project whose scores are being recalculated (a profile change). */
  | {
      kind: "rescoring"
      key: string
      repoId: string
      repoName: string
      snapshotsLeft: number
    }

const inProgress = (scan: TrackedScan) => scan.job !== "ready"

/**
 * One list, no duplicates: a scan this tab follows is shown once, with its
 * live bar; and a project's re-scoring is not listed while this tab follows a
 * job on it — that job's own "calculating" stage already says so.
 */
export function activityItems(
  tracked: readonly TrackedScan[],
  server: Activity | undefined,
): ActivityItem[] {
  const followedScanIds = new Set(
    tracked.map((scan) => scan.status.scan_id).filter(Boolean),
  )
  const reposWithJobs = new Set(
    tracked.filter(inProgress).map((scan) => scan.repoId),
  )

  const jobs: ActivityItem[] = [...tracked]
    // In progress first, then the ones waiting for a look.
    .sort((a, b) => Number(!inProgress(a)) - Number(!inProgress(b)))
    .map((scan) => ({ kind: "job", key: scan.key, scan }))

  const others: ActivityItem[] = (server?.scans ?? [])
    .filter((active) => !followedScanIds.has(active.status.scan_id))
    .map((active) => ({
      kind: "scan",
      key: active.status.scan_id,
      repoId: active.repo_id,
      repoName: active.repo_name,
      branch: active.status.branch ?? "",
      status: active.status,
    }))

  const rescoring: ActivityItem[] = (server?.rescoring ?? [])
    .filter((item) => !reposWithJobs.has(item.repo_id))
    .map((item) => ({
      kind: "rescoring",
      key: `rescoring:${item.repo_id}`,
      repoId: item.repo_id,
      repoName: item.repo_name,
      snapshotsLeft: item.snapshots_left,
    }))

  return [...jobs, ...others, ...rescoring]
}

/** How many items are still working (everything but ready jobs). */
export function busyCount(items: readonly ActivityItem[]) {
  return items.filter((item) => item.kind !== "job" || inProgress(item.scan))
    .length
}

/** How many jobs are ready and waiting for a look. */
export function readyCount(items: readonly ActivityItem[]) {
  return items.filter((item) => item.kind === "job" && !inProgress(item.scan))
    .length
}
