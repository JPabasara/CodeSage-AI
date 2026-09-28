import { expect, test } from "vitest"

import {
  getHealthReport,
  setFindingStatus,
  switchWorkspace,
} from "@/lib/api/client"
import { DEMO_REPO_ID, SECOND_WORKSPACE_ID } from "@/lib/mocks/fixtures"
import { SNAPSHOTS } from "@/lib/mocks/scoring"

test("finding status is snapshot-local and leaves every health value unchanged", async () => {
  const before = await getHealthReport(DEMO_REPO_ID, "main")
  const finding = before.findings[0]

  await setFindingStatus(before.snapshot_id, finding.fingerprint, "done")
  const after = await getHealthReport(DEMO_REPO_ID, "main")

  expect(
    after.findings.find((item) => item.fingerprint === finding.fingerprint)
      ?.status,
  ).toBe("done")
  expect({
    health_score: after.health_score,
    grade: after.grade,
    red_issue_count: after.red_issue_count,
    category_breakdown: after.category_breakdown,
    tree: after.tree,
  }).toEqual({
    health_score: before.health_score,
    grade: before.grade,
    red_issue_count: before.red_issue_count,
    category_breakdown: before.category_breakdown,
    tree: before.tree,
  })

  const older = await getHealthReport(
    DEMO_REPO_ID,
    "main",
    SNAPSHOTS[SNAPSHOTS.length - 2].snapshot_id,
  )
  expect(
    older.findings.find((item) => item.fingerprint === finding.fingerprint)
      ?.status,
  ).toBe("open")
})

test("viewer workspaces cannot change finding status", async () => {
  const report = await getHealthReport(DEMO_REPO_ID, "main")
  await switchWorkspace(SECOND_WORKSPACE_ID)

  await expect(
    setFindingStatus(
      report.snapshot_id,
      report.findings[0].fingerprint,
      "done",
    ),
  ).rejects.toMatchObject({
    status: 403,
    code: "FORBIDDEN",
  })
})
