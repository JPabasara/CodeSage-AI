import { expect, test } from "vitest"

import {
  findingSummary,
  hotspotCount,
  hotspotFiles,
  leafFiles,
  topFindings,
} from "@/lib/dashboard-summary"
import type { Finding, TreeNode } from "@/lib/types"

function finding(overrides: Partial<Finding>): Finding {
  return {
    fingerprint: Math.random().toString(36).slice(2),
    severity: "medium",
    priority: 10,
    status: "open",
    source_scope: "production",
    ...overrides,
  } as Finding
}

const file = (path: string, health: number): TreeNode => ({
  path,
  name: path.split("/").at(-1) ?? path,
  type: "file",
  health_score: health,
  grade: "C",
  debt_score: 0,
})

const tree: TreeNode[] = [
  {
    path: "src",
    name: "src",
    type: "folder",
    health_score: 60,
    grade: "C",
    debt_score: 0,
    children: [
      file("src/A.java", 22),
      file("src/B.java", 81),
      file("src/C.java", 39),
    ],
  },
  file("D.java", 55),
]

test("counts follow the list's default view: done and test code apart", () => {
  const findings = [
    finding({ severity: "critical" }),
    finding({ severity: "high", status: "done" }),
    finding({ severity: "high" }),
    finding({ severity: "low", source_scope: "test" }),
  ]

  expect(findingSummary({ include_test_findings: false }, findings)).toEqual({
    total: 3,
    open: 2,
    done: 1,
    open_by_severity: { critical: 1, high: 1, medium: 0, low: 0 },
  })
  expect(
    findingSummary({ include_test_findings: true }, findings)?.open_by_severity
      .low,
  ).toBe(1)
})

test("loaded findings win over the server's summary, so a fresh Mark as done shows", () => {
  const server = {
    total: 1,
    open: 1,
    done: 0,
    open_by_severity: { critical: 0, high: 1, medium: 0, low: 0 },
  }
  const report = { finding_summary: server, include_test_findings: false }

  expect(findingSummary(report, undefined)).toBe(server)
  expect(
    findingSummary(report, [finding({ severity: "high", status: "done" })])
      ?.open,
  ).toBe(0)
})

test("top findings are open, in scope and in list order", () => {
  const low = finding({ priority: 5, fingerprint: "low" })
  const best = finding({ priority: 90, fingerprint: "best" })
  const done = finding({ priority: 99, status: "done" })
  const testCode = finding({ priority: 95, source_scope: "test" })

  expect(topFindings([low, best, done, testCode], false, 6)).toEqual([
    best,
    low,
  ])
  expect(topFindings([low, best, done, testCode], true, 1)).toEqual([testCode])
})

test("hotspots are the least healthy files, and the count is below 40", () => {
  expect(leafFiles(tree).map((item) => item.path)).toEqual([
    "src/A.java",
    "src/B.java",
    "src/C.java",
    "D.java",
  ])
  expect(hotspotFiles(tree, 2).map((item) => item.path)).toEqual([
    "src/A.java",
    "src/C.java",
  ])
  expect(hotspotCount(tree)).toBe(2)
})
