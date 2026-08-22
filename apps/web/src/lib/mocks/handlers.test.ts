// ────────────────────────────────────────────────────────────────────────────
// J2.8 — do the mocks tell the truth?
//
// The mocks are what the whole frontend is built against while every backend
// endpoint is still a stub. If they drift from the contract, the component tests
// pass against a fiction and the live site breaks in ways nothing caught. These
// tests check the RESPONSES, not the fixtures: a handler can assemble a shape
// that no fixture ever had.
//
// Field lists here are copied from docs/api/openapi.yaml `required:` arrays. When
// the contract changes, these fail — which is the point.
// ────────────────────────────────────────────────────────────────────────────
import { expect, test } from "vitest"

import type { ApiError, ScanStatus, ScoreProfile } from "@/lib/types"

const BASE = "http://localhost/api"

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`)
  expect(res.ok, `GET ${path} returned ${res.status}`).toBe(true)
  return res.json() as Promise<T>
}

/** Every required key present, and nothing named in camelCase. */
function expectShape(obj: unknown, required: string[], where: string) {
  expect(obj, where).toBeTypeOf("object")
  const record = obj as Record<string, unknown>
  for (const key of required) {
    expect(Object.keys(record), `${where} is missing "${key}"`).toContain(key)
  }
  const camel = Object.keys(record).filter((k) => /[a-z][A-Z]/.test(k))
  expect(camel, `${where} still has camelCase keys`).toEqual([])
}

test("GET /projects returns contract-shaped repos", async () => {
  const repos = await get<Record<string, unknown>[]>("/projects")
  expect(repos.length).toBeGreaterThan(0)
  for (const repo of repos) {
    expectShape(
      repo,
      ["id", "name", "owner", "visibility", "url", "default_branch", "connected_at"],
      "Repo",
    )
    if (repo.latest_health) {
      expectShape(repo.latest_health, ["score", "grade", "delta"], "LatestHealth")
    }
  }
})

test("GET /repos/:id/branches returns contract-shaped branches", async () => {
  const branches = await get<Record<string, unknown>[]>(
    "/repos/demo-repo/branches",
  )
  expect(branches.length).toBeGreaterThan(0)
  for (const branch of branches) {
    expectShape(branch, ["name", "is_default"], "Branch")
  }
})

test("GET /repos/:id/health returns the whole dashboard payload", async () => {
  const report = await get<Record<string, unknown>>(
    "/repos/demo-repo/health?branch=main",
  )
  expectShape(
    report,
    [
      "snapshot_id",
      "repo_id",
      "branch",
      "commit_sha",
      "scanned_at",
      "health_score",
      "grade",
      "delta",
      "red_issue_count",
      "profile",
      "history",
      "tree",
      "file_scores",
      "findings",
      "category_breakdown",
    ],
    "HealthReport",
  )

  for (const finding of report.findings as Record<string, unknown>[]) {
    expectShape(
      finding,
      [
        "fingerprint",
        "source",
        "category",
        "severity",
        "file",
        "line",
        "reason",
        "status",
        "priority",
        "pinned_by_floor",
      ],
      "Finding",
    )
    // Source is exactly two values - a security finding is a `rule` finding
    // whose category is security.
    expect(["rule", "satd"]).toContain(finding.source)
  }

  for (const score of report.file_scores as Record<string, unknown>[]) {
    expectShape(score, ["file", "debt_score", "risk_score"], "FileScore")
  }
  for (const node of report.tree as Record<string, unknown>[]) {
    expectShape(
      node,
      ["path", "name", "type", "health_score", "grade", "debt_score"],
      "TreeNode",
    )
  }
  for (const point of report.history as Record<string, unknown>[]) {
    expectShape(point, ["t", "score"], "HealthPoint")
  }
  for (const slice of report.category_breakdown as Record<string, unknown>[]) {
    expectShape(slice, ["category", "count", "debt"], "CategoryBreakdownItem")
  }
})

test("GET /repos/:id/scans returns contract-shaped summaries", async () => {
  const history = await get<Record<string, unknown>[]>("/repos/demo-repo/scans")
  expect(history.length).toBeGreaterThan(0)
  for (const summary of history) {
    expectShape(
      summary,
      [
        "snapshot_id",
        "scan_id",
        "branch",
        "commit_sha",
        "scanned_at",
        "finding_count",
        "health_score",
        "grade",
        "delta",
      ],
      "ScanSummary",
    )
  }
})

test("the scan lifecycle returns contract-shaped status at every step", async () => {
  const started = await fetch(`${BASE}/repos/demo-repo/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ branch: "main" }),
  }).then((r) => r.json() as Promise<ScanStatus>)
  expectShape(started, ["scan_id", "phase", "progress"], "ScanStatus (start)")

  const ticked = await get<ScanStatus>(
    `/repos/demo-repo/scan/${started.scan_id}`,
  )
  expectShape(ticked, ["scan_id", "phase", "progress"], "ScanStatus (tick)")

  const stopped = await fetch(
    `${BASE}/repos/demo-repo/scan/${started.scan_id}/stop`,
    { method: "POST" },
  ).then((r) => r.json() as Promise<ScanStatus>)
  expectShape(stopped, ["scan_id", "phase", "progress"], "ScanStatus (stop)")
})

test("every scan phase the mock can emit is in the contract enum", async () => {
  const PHASES = ["idle", "queued", "running", "done", "error", "cancelled"]

  const started = await fetch(`${BASE}/repos/demo-repo/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ branch: "main" }),
  }).then((r) => r.json() as Promise<ScanStatus>)
  expect(PHASES).toContain(started.phase)

  await fetch(`${BASE}/repos/demo-repo/scan/${started.scan_id}/stop`, {
    method: "POST",
  })
  const after = await get<ScanStatus>(
    `/repos/demo-repo/scan/${started.scan_id}`,
  )
  expect(PHASES).toContain(after.phase)
  // Cancelling must not resolve to `idle` - a stopped scan has to stay
  // distinguishable from one that never ran.
  expect(after.phase).toBe("cancelled")
})

test("GET /profiles and /profiles/active are contract-shaped", async () => {
  const REQUIRED = ["id", "name", "weights", "trust_s", "is_preset", "is_active"]
  const WEIGHTS = [
    "security",
    "code_design",
    "requirement",
    "documentation",
    "test",
  ]

  const presets = await get<ScoreProfile[]>("/profiles")
  expect(presets.length).toBe(3)
  for (const preset of presets) {
    expectShape(preset, REQUIRED, "ScoreProfile")
    expectShape(preset.weights, WEIGHTS, "CategoryWeights")
    expect(Object.keys(preset.weights)).toHaveLength(5)
  }

  const active = await get<ScoreProfile>("/profiles/active")
  expectShape(active, REQUIRED, "ScoreProfile (active)")
  expectShape(active.weights, WEIGHTS, "CategoryWeights (active)")
})

test("PUT /profiles/active clamps out-of-range values and returns what it stored", async () => {
  const res = await fetch(`${BASE}/profiles/active`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      weights: {
        security: 9, // above the 3.0 maximum
        code_design: 0, // below the 0.1 minimum
        requirement: 1,
        documentation: 1,
        test: 1,
      },
      trust_s: 5, // above the 1.0 maximum
    }),
  })

  // Clamped, NOT rejected - and returned as what is really in force.
  expect(res.status).toBe(200)
  const saved = (await res.json()) as ScoreProfile
  expect(saved.weights.security).toBe(3.0)
  expect(saved.weights.code_design).toBe(0.1)
  expect(saved.trust_s).toBe(1)
})

test("PUT then GET /profiles/active reflects the write", async () => {
  await fetch(`${BASE}/profiles/active`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      weights: {
        security: 2.5,
        code_design: 1,
        requirement: 1,
        documentation: 1,
        test: 1,
      },
      trust_s: 0.25,
    }),
  })

  const active = await get<ScoreProfile>("/profiles/active")
  expect(active.weights.security).toBe(2.5)
  expect(active.trust_s).toBe(0.25)
  // Applying writes the workspace's active profile, never a preset template.
  expect(active.is_preset).toBe(false)
  expect(active.is_active).toBe(true)
})

test("errors carry the full envelope, not just a message", async () => {
  const res = await fetch(`${BASE}/repos/no-such-repo/health?branch=main`)
  expect(res.status).toBe(404)

  const body = (await res.json()) as ApiError
  // `code` is what a client branches on; `detail` is only for humans.
  expectShape(body, ["detail", "code"], "Error")
  expect(body.code).toBe("NOT_FOUND")
})
