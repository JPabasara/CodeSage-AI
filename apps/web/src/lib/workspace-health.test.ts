import { expect, test } from "vitest"

import type { Activity, Repo } from "@/lib/types"
import {
  gradeFor,
  needsAttention,
  scannedWithinWeek,
  sortProjects,
  sumOf,
  workspaceHealth,
} from "@/lib/workspace-health"

function repo(
  name: string,
  health?: Partial<NonNullable<Repo["latest_health"]>>,
): Repo {
  return {
    id: name,
    name,
    owner: "acme",
    visibility: "public",
    url: `https://github.com/acme/${name}`,
    default_branch: "main",
    connected_at: "2026-09-01T00:00:00Z",
    latest_health: health
      ? { score: 80, grade: "B", delta: 0, ...health }
      : null,
  } as Repo
}

test("grades use the project thresholds: 85, 70, 55, 40", () => {
  expect([85, 84.9, 70, 69, 55, 54, 40, 39].map(gradeFor)).toEqual([
    "A",
    "B",
    "B",
    "C",
    "C",
    "D",
    "D",
    "E",
  ])
})

test("health is weighted by size when every scanned project reports it", () => {
  const health = workspaceHealth([
    repo("big", { score: 40, grade: "D", delta: -2, kloc: 30 }),
    repo("small", { score: 100, grade: "A", delta: 4, kloc: 10 }),
    repo("new"),
  ])

  expect(health?.weighted).toBe(true)
  expect(health?.score).toBe(55) // (40×30 + 100×10) / 40
  expect(health?.grade).toBe("C")
  expect(health?.delta).toBe(-0.5) // (−2×30 + 4×10) / 40
  expect(health?.scannedCount).toBe(2)
  expect(health?.notScanned).toBe(1)
  expect(health?.distribution).toEqual({ A: 1, B: 0, C: 0, D: 1, E: 0 })
})

test("without sizes for every project it falls back to a plain average", () => {
  const health = workspaceHealth([
    repo("a", { score: 40, kloc: 30 }),
    repo("b", { score: 100 }),
  ])
  expect(health?.weighted).toBe(false)
  expect(health?.score).toBe(70)
})

test("a workspace with nothing scanned has no health yet", () => {
  expect(workspaceHealth([repo("new")])).toBeUndefined()
})

test("sums skip projects that do not report the field", () => {
  const projects = [
    repo("a", { red_issue_count: 3, finding_count: 10 }),
    repo("b", { red_issue_count: 2 }),
    repo("c"),
  ]
  expect(sumOf(projects, "red_issue_count")).toBe(5)
  expect(sumOf(projects, "finding_count")).toBe(10)
  expect(sumOf([repo("c")], "finding_count")).toBeUndefined()
})

test("scanned this week counts only scans in the last seven days", () => {
  const now = Date.parse("2026-10-04T12:00:00Z")
  const projects = [
    repo("today", { scanned_at: "2026-10-04T09:00:00Z" }),
    repo("six-days", { scanned_at: "2026-09-28T13:00:00Z" }),
    repo("old", { scanned_at: "2026-09-20T00:00:00Z" }),
    repo("new"),
  ]
  expect(scannedWithinWeek(projects, now)).toBe(2)
})

test("attention lists a drop, then a low grade, then never scanned, one line per project", () => {
  const activity: Activity = {
    scans: [],
    rescoring: [
      { repo_id: "steady", repo_name: "acme/steady", snapshots_left: 2 },
    ],
  }
  const items = needsAttention(
    [
      repo("steady", { score: 90, grade: "A" }),
      repo("legacy", { score: 30, grade: "E", red_issue_count: 41 }),
      repo("slipping", { score: 64, grade: "C", delta: -6 }),
      repo("both", { score: 38, grade: "E", delta: -4 }),
      repo("new"),
    ],
    activity,
  )

  expect(items.map((item) => [item.repo.name, item.kind])).toEqual([
    ["slipping", "dropped"],
    ["both", "dropped"],
    ["legacy", "low-grade"],
    ["new", "never-scanned"],
  ])
  expect(items[0].title).toBe("slipping dropped 6 points")
  expect(items[0].detail).toBe("70 → 64 after its latest scan.")
  expect(items[2].detail).toMatch(/^41 critical or high findings/)
})

test("sorting: attention puts the weakest first and unscanned last", () => {
  const projects = [
    repo("b", { score: 80, scanned_at: "2026-10-01T00:00:00Z" }),
    repo("new"),
    repo("a", { score: 40, scanned_at: "2026-10-03T00:00:00Z" }),
  ]
  expect(sortProjects(projects, "attention").map((r) => r.name)).toEqual([
    "a",
    "b",
    "new",
  ])
  expect(sortProjects(projects, "health").map((r) => r.name)).toEqual([
    "b",
    "a",
    "new",
  ])
  expect(sortProjects(projects, "recent").map((r) => r.name)).toEqual([
    "a",
    "b",
    "new",
  ])
  expect(sortProjects(projects, "name").map((r) => r.name)).toEqual([
    "a",
    "b",
    "new",
  ])
})
