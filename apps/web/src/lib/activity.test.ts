import { expect, test } from "vitest"

import type { TrackedScan } from "@/hooks/use-scan-center"
import type { Activity, ScanStatus } from "@/lib/types"
import { activityItems, busyCount, readyCount } from "./activity"

const status = (patch: Partial<ScanStatus> = {}): ScanStatus => ({
  scan_id: "s-mine",
  phase: "running",
  progress: 40,
  branch: "main",
  ...patch,
})

const mine = (patch: Partial<TrackedScan> = {}): TrackedScan => ({
  key: "ws:repo-a:main",
  workspaceId: "ws",
  repoId: "repo-a",
  branch: "main",
  repoName: "acme/a",
  status: status(),
  job: "scanning",
  stopping: false,
  startedAt: 0,
  ...patch,
})

const server = (patch: Partial<Activity> = {}): Activity => ({
  scans: [],
  rescoring: [],
  ...patch,
})

test("a scan this tab follows is listed once — with its live bar, not the server's copy", () => {
  const items = activityItems(
    [mine()],
    server({
      scans: [{ repo_id: "repo-a", repo_name: "acme/a", status: status() }],
    }),
  )
  expect(items.map((i) => i.kind)).toEqual(["job"])
})

test("a teammate's scan is listed from the server", () => {
  const items = activityItems(
    [],
    server({
      scans: [
        {
          repo_id: "repo-b",
          repo_name: "acme/b",
          status: status({ scan_id: "s-theirs", branch: "develop" }),
        },
      ],
    }),
  )
  expect(items).toEqual([
    expect.objectContaining({
      kind: "scan",
      repoName: "acme/b",
      branch: "develop",
    }),
  ])
})

test("re-scoring is listed, unless this tab's job on that project already says so", () => {
  const rescoring = [
    { repo_id: "repo-a", repo_name: "acme/a", snapshots_left: 1 },
    { repo_id: "repo-c", repo_name: "acme/c", snapshots_left: 3 },
  ]
  const items = activityItems([mine({ job: "scoring" })], server({ rescoring }))
  expect(items.map((i) => i.key)).toEqual([
    "ws:repo-a:main",
    "rescoring:repo-c",
  ])

  // Once the job is only waiting for a look, a new re-score is news again.
  const later = activityItems([mine({ job: "ready" })], server({ rescoring }))
  expect(later.map((i) => i.kind)).toEqual(["job", "rescoring", "rescoring"])
})

test("jobs in progress come first, then ready ones, then others, then re-scoring", () => {
  const items = activityItems(
    [
      mine({ key: "ready", job: "ready", status: status({ scan_id: "r" }) }),
      mine({ key: "busy", repoId: "repo-z", status: status({ scan_id: "b" }) }),
    ],
    server({
      scans: [
        {
          repo_id: "repo-b",
          repo_name: "acme/b",
          status: status({ scan_id: "t" }),
        },
      ],
      rescoring: [
        { repo_id: "repo-c", repo_name: "acme/c", snapshots_left: 2 },
      ],
    }),
  )
  expect(items.map((i) => i.key)).toEqual([
    "busy",
    "ready",
    "t",
    "rescoring:repo-c",
  ])
  expect(busyCount(items)).toBe(3)
  expect(readyCount(items)).toBe(1)
})

test("nothing anywhere: nothing listed", () => {
  expect(activityItems([], undefined)).toEqual([])
  expect(activityItems([], server())).toEqual([])
})
