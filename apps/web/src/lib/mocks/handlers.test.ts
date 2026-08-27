// ────────────────────────────────────────────────────────────────────────────
// DO THE MOCKS TELL THE TRUTH?
//
// The mocks are what the whole frontend is built against while the backend
// endpoints are still stubs. If they drift from `docs/api/openapi.yaml`, the
// component tests pass against a fiction and the live site breaks in ways
// nothing caught.
//
// These tests check RESPONSES, not fixtures — a handler can assemble a shape no
// fixture ever had — and they check three things the previous version did not:
//
//   • STATUS CODES. 202 for a queued scan, 201 for a connect, 409 for the two
//     conflicts, 422 for a malformed body. A mock that answers 200 to
//     everything teaches the UI that failure modes do not exist.
//   • NO EXTRA KEYS. Every schema in the contract is `additionalProperties:
//     false`, so a field we invented here is drift, not a bonus.
//   • DERIVED, NOT STORED. Applying a profile must actually re-rank the list
//     (FR-21). This is the one the old mock could not have passed.
//
// Field lists are copied from the contract's `required:` arrays. When the
// contract changes, these fail — which is the point.
// ────────────────────────────────────────────────────────────────────────────
import { expect, test } from "vitest"

import type {
  ApiError,
  HealthReport,
  Repo,
  ScanStatus,
  ScanSummary,
  ScoreProfile,
} from "@/lib/types"
import { DEMO_REPO_ID, SECOND_REPO_ID, UNSCANNED_REPO_ID } from "./fixtures"

const BASE = "http://localhost/api"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SHA40 = /^[0-9a-f]{40}$/

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`)
  expect(res.ok, `GET ${path} returned ${res.status}`).toBe(true)
  return res.json() as Promise<T>
}

function post(path: string, body?: unknown) {
  return fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function put(path: string, body: unknown) {
  return fetch(`${BASE}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

/**
 * Every required key present, no key outside `allowed`, and nothing camelCase.
 *
 * The "no extra keys" half matters as much as the first: every schema in the
 * contract is `additionalProperties: false`, so a field the mock invents is a
 * field the real API will never send — and any UI built on it breaks at go-live.
 */
function expectShape(
  obj: unknown,
  required: string[],
  allowed: string[],
  where: string,
) {
  expect(obj, where).toBeTypeOf("object")
  const record = obj as Record<string, unknown>

  for (const key of required) {
    expect(Object.keys(record), `${where} is missing "${key}"`).toContain(key)
  }
  const extra = Object.keys(record).filter(
    (k) => ![...required, ...allowed].includes(k),
  )
  expect(extra, `${where} has keys the contract does not define`).toEqual([])

  const camel = Object.keys(record).filter((k) => /[a-z][A-Z]/.test(k))
  expect(camel, `${where} still has camelCase keys`).toEqual([])
}

// ── projects ────────────────────────────────────────────────────────────────

test("GET /projects returns contract-shaped repos", async () => {
  const repos = await get<Repo[]>("/projects")
  expect(repos.length).toBeGreaterThan(0)

  for (const repo of repos) {
    expectShape(
      repo,
      [
        "id",
        "name",
        "owner",
        "visibility",
        "url",
        "default_branch",
        "connected_at",
      ],
      ["latest_health"],
      "Repo",
    )
    expect(repo.id, "Repo.id is format: uuid in the contract").toMatch(UUID)
    expect(["public", "private"]).toContain(repo.visibility)
    if (repo.latest_health) {
      expectShape(
        repo.latest_health,
        ["score", "grade", "delta"],
        [],
        "LatestHealth",
      )
    }
  }
})

test("latest_health is ABSENT on a repo that was never scanned, not zero", async () => {
  const repos = await get<Repo[]>("/projects")
  const unscanned = repos.find((r) => r.id === UNSCANNED_REPO_ID)

  expect(unscanned, "the fixture needs a never-scanned repo").toBeDefined()
  // Absent means "not yet scanned". A score of 0 would mean "measured, and
  // terrible" — the projects list renders the two differently and must be able to.
  expect(unscanned?.latest_health ?? undefined).toBeUndefined()
})

test("POST /projects returns 201 and a contract-shaped Repo", async () => {
  const res = await post("/projects", {
    url: "https://github.com/octocat/Hello-World",
  })

  expect(res.status).toBe(201)
  const repo = (await res.json()) as Repo
  expectShape(
    repo,
    [
      "id",
      "name",
      "owner",
      "visibility",
      "url",
      "default_branch",
      "connected_at",
    ],
    ["latest_health"],
    "Repo (connected)",
  )
  expect(repo.id).toMatch(UUID)
  // v1.0 accepts public repositories only, so anything stored is public.
  expect(repo.visibility).toBe("public")
  // Freshly connected and never scanned — so no health hint yet.
  expect(repo.latest_health ?? undefined).toBeUndefined()
})

test("POST /projects distinguishes every failure by code, not by status alone", async () => {
  const cases: [string, number, string][] = [
    ["not-a-url", 400, "INVALID_REPOSITORY_URL"],
    ["https://gitlab.com/octocat/x", 400, "INVALID_REPOSITORY_URL"],
    ["https://github.com/octocat/private-x", 400, "REPOSITORY_NOT_PUBLIC"],
    ["https://github.com/octocat/missing-x", 400, "REPOSITORY_UNREACHABLE"],
    ["https://github.com/octocat/ratelimited-x", 429, "RATE_LIMITED"],
    ["https://github.com/octocat/upstream-x", 503, "UPSTREAM_UNAVAILABLE"],
    ["https://github.com/acme/acme-payments", 409, "ALREADY_CONNECTED"],
  ]

  for (const [url, status, code] of cases) {
    const res = await post("/projects", { url })
    expect(res.status, url).toBe(status)

    const body = (await res.json()) as ApiError
    expectShape(body, ["detail", "code"], ["errors"], `Error for ${url}`)
    expect(body.code, url).toBe(code)
    // The detail has to be a sentence a user can act on, not a status line.
    expect(body.detail.length, url).toBeGreaterThan(20)
  }
})

test("POST /projects rejects a malformed body with 422 and field detail", async () => {
  const res = await post("/projects", { notTheUrl: 1 })
  expect(res.status).toBe(422)

  const body = (await res.json()) as ApiError
  expect(body.code).toBe("VALIDATION_FAILED")
  expect(body.errors?.[0]).toMatchObject({ field: expect.any(String) })
})

test("a connected repository shows up in the projects list", async () => {
  const before = await get<Repo[]>("/projects")
  await post("/projects", { url: "https://github.com/octocat/brand-new" })

  const after = await get<Repo[]>("/projects")
  expect(after.length).toBe(before.length + 1)
  expect(after.some((r) => r.name === "brand-new")).toBe(true)
})

// ── branches ────────────────────────────────────────────────────────────────

test("GET /repos/:id/branches returns contract-shaped branches", async () => {
  const branches = await get<Record<string, unknown>[]>(
    `/repos/${DEMO_REPO_ID}/branches`,
  )
  expect(branches.length).toBeGreaterThan(0)

  for (const branch of branches) {
    expectShape(
      branch,
      ["name", "is_default"],
      ["head_commit_sha", "head_commit_at"],
      "Branch",
    )
    // "Full 40-character SHA. The UI shows the first seven." — a 7-char fixture
    // would let a `.slice(0, 7)` bug through unnoticed.
    if (branch.head_commit_sha !== null) {
      expect(branch.head_commit_sha).toMatch(SHA40)
    }
  }
  expect(branches.filter((b) => b.is_default)).toHaveLength(1)
})

test("an unknown repo is 404 with the error envelope, on every repo route", async () => {
  const ghost = "11111111-2222-3333-4444-555555555555"
  for (const path of [
    `/repos/${ghost}/branches`,
    `/repos/${ghost}/health?branch=main`,
    `/repos/${ghost}/scans`,
  ]) {
    const res = await fetch(`${BASE}${path}`)
    expect(res.status, path).toBe(404)
    const body = (await res.json()) as ApiError
    expectShape(body, ["detail", "code"], ["errors"], `Error for ${path}`)
    expect(body.code, path).toBe("NOT_FOUND")
  }
})

// ── the dashboard payload ───────────────────────────────────────────────────

test("GET /repos/:id/health returns the whole dashboard payload", async () => {
  const report = await get<HealthReport>(
    `/repos/${DEMO_REPO_ID}/health?branch=main`,
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
    ["model_version"],
    "HealthReport",
  )
  expect(report.snapshot_id).toMatch(UUID)
  expect(report.repo_id).toMatch(UUID)
  expect(report.commit_sha).toMatch(SHA40)

  for (const finding of report.findings) {
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
      [
        "symbol",
        "rule_id",
        "metric_value",
        "threshold",
        "comment_text",
        "confidence",
      ],
      "Finding",
    )
    // Exactly two sources: a security finding is a `rule` finding whose
    // category is security, never a `security` source.
    expect(["rule", "satd"]).toContain(finding.source)
    expect([
      "code-design",
      "requirement",
      "documentation",
      "test",
      "security",
    ]).toContain(finding.category)
    expect(["critical", "high", "medium", "low"]).toContain(finding.severity)
    expect(finding.line).toBeGreaterThanOrEqual(1)
  }

  for (const score of report.file_scores) {
    expectShape(score, ["file", "debt_score", "risk_score"], [], "FileScore")
  }
  for (const point of report.history) {
    expectShape(point, ["t", "score"], ["commit_sha"], "HealthPoint")
  }
  for (const slice of report.category_breakdown) {
    expectShape(
      slice,
      ["category", "count", "debt"],
      [],
      "CategoryBreakdownItem",
    )
  }
})

test("the fixture exercises every enum the contract defines", async () => {
  const report = await get<HealthReport>(
    `/repos/${DEMO_REPO_ID}/health?branch=main`,
  )
  const findings = report.findings

  // A fixture that only covers three categories leaves render paths untested,
  // and "it looked fine locally" is exactly how those ship broken.
  expect(new Set(findings.map((f) => f.category))).toEqual(
    new Set([
      "code-design",
      "requirement",
      "documentation",
      "test",
      "security",
    ]),
  )
  expect(new Set(findings.map((f) => f.severity))).toEqual(
    new Set(["critical", "high", "medium", "low"]),
  )
  expect(new Set(findings.map((f) => f.source))).toEqual(
    new Set(["rule", "satd"]),
  )

  // The critical-security floor (FR-24) has to be renderable, so at least one
  // finding must carry it and at least one must not.
  expect(findings.some((f) => f.pinned_by_floor)).toBe(true)
  expect(findings.some((f) => !f.pinned_by_floor)).toBe(true)

  // All five categories in the pie, including any at zero: a missing slice and
  // an empty slice mean different things.
  expect(report.category_breakdown).toHaveLength(5)
})

test("rule findings and SATD findings carry their own evidence fields", async () => {
  const { findings } = await get<HealthReport>(
    `/repos/${DEMO_REPO_ID}/health?branch=main`,
  )

  const rule = findings.filter((f) => f.source === "rule")
  const satd = findings.filter((f) => f.source === "satd")

  // `rule_id` is rule-only; `comment_text` / `confidence` are SATD-only. Mixing
  // them would be inventing a shape the backend cannot produce.
  expect(rule.every((f) => typeof f.rule_id === "string")).toBe(true)
  expect(rule.every((f) => f.comment_text == null)).toBe(true)
  expect(satd.every((f) => typeof f.comment_text === "string")).toBe(true)
  expect(satd.every((f) => f.rule_id == null)).toBe(true)

  // A file-scoped finding has no symbol — null, not the string "module".
  expect(findings.some((f) => f.symbol === null)).toBe(true)
})

test("findings arrive already sorted by priority, descending", async () => {
  const { findings } = await get<HealthReport>(
    `/repos/${DEMO_REPO_ID}/health?branch=main`,
  )
  const priorities = findings.map((f) => f.priority)
  expect(priorities).toEqual([...priorities].sort((a, b) => b - a))
})

test("a null risk_score survives the wire as null, never as 0", async () => {
  const { file_scores, tree } = await get<HealthReport>(
    `/repos/${DEMO_REPO_ID}/health?branch=main`,
  )

  // "null means the ML service was unreachable" — a different thing from 0.0,
  // which is a measured "this file looks safe".
  expect(file_scores.some((f) => f.risk_score === null)).toBe(true)
  expect(file_scores.some((f) => typeof f.risk_score === "number")).toBe(true)

  // risk_score is files-only on the tree; a folder-level risk would be an
  // average of estimates that were never averaged.
  const walk = (nodes: typeof tree): typeof tree =>
    nodes.flatMap((n) => [n, ...(n.children ? walk(n.children) : [])])
  for (const node of walk(tree)) {
    expectShape(
      node,
      ["path", "name", "type", "health_score", "grade", "debt_score"],
      ["risk_score", "children"],
      `TreeNode ${node.path}`,
    )
    if (node.type === "folder") {
      expect(node.risk_score ?? null, `${node.path} is a folder`).toBeNull()
    }
  }
})

test("the health report is derived per branch, not one fixture for all", async () => {
  const main = await get<HealthReport>(
    `/repos/${DEMO_REPO_ID}/health?branch=main`,
  )
  const dev = await get<HealthReport>(
    `/repos/${DEMO_REPO_ID}/health?branch=develop`,
  )

  expect(main.branch).toBe("main")
  expect(dev.branch).toBe("develop")
  expect(dev.health_score).not.toBe(main.health_score)
  // Trends are per branch too (the contract: "Trends and deltas are per branch").
  expect(dev.history.map((p) => p.score)).not.toEqual(
    main.history.map((p) => p.score),
  )
})

test("an unscanned branch is 404 so the client can render an empty state", async () => {
  const res = await fetch(
    `${BASE}/repos/${UNSCANNED_REPO_ID}/health?branch=trunk`,
  )
  expect(res.status).toBe(404)
  expect(((await res.json()) as ApiError).code).toBe("NOT_FOUND")
})

test("?snapshot_id= loads that stored snapshot instead of the newest (FR-19)", async () => {
  const history = await get<ScanSummary[]>(`/repos/${DEMO_REPO_ID}/scans`)
  const older = history[history.length - 1] // oldest row

  const report = await get<HealthReport>(
    `/repos/${DEMO_REPO_ID}/health?branch=main&snapshot_id=${older.snapshot_id}`,
  )

  expect(report.snapshot_id).toBe(older.snapshot_id)
  expect(report.scanned_at).toBe(older.scanned_at)
  // Same lens for both reads, so the dashboard and the history row agree.
  expect(report.health_score).toBe(older.health_score)
})

// ── scan history ────────────────────────────────────────────────────────────

test("GET /repos/:id/scans returns contract-shaped summaries, newest first", async () => {
  const history = await get<ScanSummary[]>(`/repos/${DEMO_REPO_ID}/scans`)
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
      [],
      "ScanSummary",
    )
    expect(summary.snapshot_id).toMatch(UUID)
    expect(summary.scan_id).toMatch(UUID)
    expect(summary.commit_sha).toMatch(SHA40)
  }

  const times = history.map((s) => Date.parse(s.scanned_at))
  expect(times, "newest first (FR-19)").toEqual(
    [...times].sort((a, b) => b - a),
  )
})

// ── scan lifecycle ──────────────────────────────────────────────────────────

test("the scan lifecycle is contract-shaped, and answers 202 at both writes", async () => {
  const started = await post(`/repos/${DEMO_REPO_ID}/scan`, { branch: "main" })
  // 202, not 200: the work is QUEUED, not done. PERF-05 puts it on a Celery
  // worker, never inside this request.
  expect(started.status).toBe(202)

  const scan = (await started.json()) as ScanStatus
  expectShape(
    scan,
    ["scan_id", "phase", "progress"],
    ["branch", "commit_sha", "started_at", "finished_at", "error"],
    "ScanStatus (start)",
  )
  expect(scan.scan_id).toMatch(UUID)

  const ticked = await get<ScanStatus>(
    `/repos/${DEMO_REPO_ID}/scan/${scan.scan_id}`,
  )
  expectShape(
    ticked,
    ["scan_id", "phase", "progress"],
    ["branch", "commit_sha", "started_at", "finished_at", "error"],
    "ScanStatus (tick)",
  )

  const stopped = await post(`/repos/${DEMO_REPO_ID}/scan/${scan.scan_id}/stop`)
  expect(stopped.status).toBe(202)
  expectShape(
    (await stopped.json()) as ScanStatus,
    ["scan_id", "phase", "progress"],
    ["branch", "commit_sha", "started_at", "finished_at", "error"],
    "ScanStatus (stop)",
  )
})

test("stop is cooperative: the phase is unchanged until the NEXT poll", async () => {
  const scan = (await (
    await post(`/repos/${DEMO_REPO_ID}/scan`, { branch: "main" })
  ).json()) as ScanStatus

  const stopped = (await (
    await post(`/repos/${DEMO_REPO_ID}/scan/${scan.scan_id}/stop`)
  ).json()) as ScanStatus
  // The POST sets a flag; it does not kill the worker.
  expect(stopped.phase).toBe("running")

  const after = await get<ScanStatus>(
    `/repos/${DEMO_REPO_ID}/scan/${scan.scan_id}`,
  )
  // `cancelled`, never `idle` — a stopped scan must stay distinguishable from
  // one that never ran (SP-13, DBR-22).
  expect(after.phase).toBe("cancelled")
})

test("starting a second scan while one runs is 409 SCAN_ALREADY_RUNNING", async () => {
  await post(`/repos/${DEMO_REPO_ID}/scan`, { branch: "main" })

  const res = await post(`/repos/${DEMO_REPO_ID}/scan`, { branch: "main" })
  expect(res.status).toBe(409)
  expect(((await res.json()) as ApiError).code).toBe("SCAN_ALREADY_RUNNING")
})

test("stopping a finished scan is 409 SCAN_NOT_CANCELLABLE", async () => {
  const scan = (await (
    await post(`/repos/${DEMO_REPO_ID}/scan`, { branch: "main" })
  ).json()) as ScanStatus

  // Poll it to completion (6 ticks × 17% crosses 100).
  let phase = scan.phase
  for (let i = 0; i < 10 && phase === "running"; i++) {
    phase = (
      await get<ScanStatus>(`/repos/${DEMO_REPO_ID}/scan/${scan.scan_id}`)
    ).phase
  }
  expect(phase).toBe("done")

  const res = await post(`/repos/${DEMO_REPO_ID}/scan/${scan.scan_id}/stop`)
  expect(res.status).toBe(409)
  expect(((await res.json()) as ApiError).code).toBe("SCAN_NOT_CANCELLABLE")
})

test("skip-if-unchanged: rescanning the same head SHA comes back done, not queued", async () => {
  const first = (await (
    await post(`/repos/${DEMO_REPO_ID}/scan`, { branch: "main" })
  ).json()) as ScanStatus
  let phase = first.phase
  for (let i = 0; i < 10 && phase === "running"; i++) {
    phase = (
      await get<ScanStatus>(`/repos/${DEMO_REPO_ID}/scan/${first.scan_id}`)
    ).phase
  }

  const again = await post(`/repos/${DEMO_REPO_ID}/scan`, { branch: "main" })
  expect(again.status).toBe(202) // still 202 — the phase is what differs
  const skipped = (await again.json()) as ScanStatus
  expect(skipped.phase).toBe("done")
  expect(skipped.progress).toBe(100)
})

test("POST /scan without a branch is 422, not a silent default", async () => {
  const res = await post(`/repos/${DEMO_REPO_ID}/scan`, {})
  expect(res.status).toBe(422)
  expect(((await res.json()) as ApiError).code).toBe("VALIDATION_FAILED")
})

// ── profiles ────────────────────────────────────────────────────────────────

const PROFILE_KEYS = [
  "id",
  "name",
  "weights",
  "trust_s",
  "is_preset",
  "is_active",
]
const WEIGHT_KEYS = [
  "security",
  "code_design",
  "requirement",
  "documentation",
  "test",
]

test("GET /profiles and /profiles/active are contract-shaped", async () => {
  const presets = await get<ScoreProfile[]>("/profiles")
  expect(presets.length).toBe(3)

  for (const preset of presets) {
    expectShape(preset, PROFILE_KEYS, [], "ScoreProfile")
    expectShape(preset.weights, WEIGHT_KEYS, [], "CategoryWeights")
    expect(preset.id).toMatch(UUID)
    // Five weights, no more and no fewer (FR-9.3).
    expect(Object.keys(preset.weights)).toHaveLength(5)
  }
  expect(presets.map((p) => p.name)).toEqual([
    "Balanced",
    "Security-first",
    "Delivery-speed",
  ])
  // "at most one active profile per workspace", enforced by a partial index.
  expect(presets.filter((p) => p.is_active)).toHaveLength(1)

  const active = await get<ScoreProfile>("/profiles/active")
  expectShape(active, PROFILE_KEYS, [], "ScoreProfile (active)")
  expectShape(active.weights, WEIGHT_KEYS, [], "CategoryWeights (active)")
})

test("PUT /profiles/active clamps out-of-range values and returns what it stored", async () => {
  const res = await put("/profiles/active", {
    weights: {
      security: 9, // above the 3.0 maximum
      code_design: 0, // below the 0.1 minimum
      requirement: 1,
      documentation: 1,
      test: 1,
    },
    trust_s: 5, // above the 1.0 maximum
  })

  // Clamped, NOT rejected — and returned as what is really in force.
  expect(res.status).toBe(200)
  const saved = (await res.json()) as ScoreProfile
  expect(saved.weights.security).toBe(3.0)
  expect(saved.weights.code_design).toBe(0.1)
  expect(saved.trust_s).toBe(1)
})

test("PUT /profiles/active rejects a MALFORMED body with 422, not a clamp", async () => {
  // Out-of-range is clamped; wrong type / missing key / unknown category is a
  // different thing, and the contract gives it a different answer.
  const cases: unknown[] = [
    {
      weights: {
        security: "high",
        code_design: 1,
        requirement: 1,
        documentation: 1,
        test: 1,
      },
      trust_s: 0.5,
    },
    {
      weights: {
        security: 1,
        code_design: 1,
        requirement: 1,
        documentation: 1,
      },
      trust_s: 0.5,
    },
    {
      weights: {
        security: 1,
        code_design: 1,
        requirement: 1,
        documentation: 1,
        test: 1,
        defect: 1,
      },
      trust_s: 0.5,
    },
    {
      weights: {
        security: 1,
        code_design: 1,
        requirement: 1,
        documentation: 1,
        test: 1,
      },
    },
  ]

  for (const body of cases) {
    const res = await put("/profiles/active", body)
    expect(res.status, JSON.stringify(body)).toBe(422)
    const err = (await res.json()) as ApiError
    expect(err.code).toBe("VALIDATION_FAILED")
    expect(err.errors?.length ?? 0).toBeGreaterThan(0)
  }
})

test("PUT then GET /profiles/active reflects the write", async () => {
  await put("/profiles/active", {
    weights: {
      security: 2.5,
      code_design: 1,
      requirement: 1,
      documentation: 1,
      test: 1,
    },
    trust_s: 0.25,
  })

  const active = await get<ScoreProfile>("/profiles/active")
  expect(active.weights.security).toBe(2.5)
  expect(active.trust_s).toBe(0.25)
  // Applying writes the workspace's active profile, never a preset template.
  expect(active.is_preset).toBe(false)
  expect(active.is_active).toBe(true)
})

// ── the one the old mock could not pass ─────────────────────────────────────

test("scores are DERIVED: applying a profile re-ranks the list with no re-scan", async () => {
  const before = await get<HealthReport>(
    `/repos/${DEMO_REPO_ID}/health?branch=main`,
  )

  const securityFirst = (await get<ScoreProfile[]>("/profiles")).find(
    (p) => p.name === "Security-first",
  )!
  await put("/profiles/active", {
    name: securityFirst.name,
    weights: securityFirst.weights,
    trust_s: securityFirst.trust_s,
  })

  const after = await get<HealthReport>(
    `/repos/${DEMO_REPO_ID}/health?branch=main`,
  )

  // FR-21: no column was read, so tripling the security weight moves everything.
  expect(after.findings.map((f) => f.fingerprint)).not.toEqual(
    before.findings.map((f) => f.fingerprint),
  )
  expect(after.health_score).not.toBe(before.health_score)
  // FR-14, "one lens per line": the WHOLE history is redrawn, not just today.
  expect(after.history.map((p) => p.score)).not.toEqual(
    before.history.map((p) => p.score),
  )
  // The chart is labelled with the profile, or its changing shape reads as a bug.
  expect(after.profile).toBe("Security-first")

  // FR-20: a profile change writes no snapshot and starts no scan.
  expect(after.snapshot_id).toBe(before.snapshot_id)
  expect(after.scanned_at).toBe(before.scanned_at)
  expect(after.commit_sha).toBe(before.commit_sha)
})

test("a security finding's weight moves it past a higher-severity one", async () => {
  const before = await get<HealthReport>(
    `/repos/${DEMO_REPO_ID}/health?branch=main`,
  )
  const rank = (r: HealthReport, fp: string) =>
    r.findings.findIndex((f) => f.fingerprint === fp)

  // Under Balanced the HIGH code-design finding outranks the MEDIUM security one.
  expect(rank(before, "f-long-1")).toBeLessThan(rank(before, "f-sqli-1"))

  const securityFirst = (await get<ScoreProfile[]>("/profiles")).find(
    (p) => p.name === "Security-first",
  )!
  await put("/profiles/active", {
    name: securityFirst.name,
    weights: securityFirst.weights,
    trust_s: securityFirst.trust_s,
  })

  // Under Security-first it does not. That inversion is what a weight IS.
  const after = await get<HealthReport>(
    `/repos/${DEMO_REPO_ID}/health?branch=main`,
  )
  expect(rank(after, "f-sqli-1")).toBeLessThan(rank(after, "f-long-1"))
})

test("the trust slider cannot de-weight a security finding (FR-24)", async () => {
  const priorityOf = async (fp: string) => {
    const r = await get<HealthReport>(
      `/repos/${DEMO_REPO_ID}/health?branch=main`,
    )
    return r.findings.find((f) => f.fingerprint === fp)!.priority
  }

  const balanced = {
    security: 1,
    code_design: 1,
    requirement: 1,
    documentation: 1,
    test: 1,
  }
  await put("/profiles/active", { weights: balanced, trust_s: 0 })
  const trustModel = await priorityOf("f-secret-1")

  await put("/profiles/active", { weights: balanced, trust_s: 1 })
  const trustRules = await priorityOf("f-secret-1")

  // source_trust is pinned at 1.0 for the security category, so no position of
  // the slider changes this number. A SATD finding, by contrast, moves.
  expect(trustRules).toBe(trustModel)
})

test("different repositories score differently", async () => {
  const demo = await get<HealthReport>(
    `/repos/${DEMO_REPO_ID}/health?branch=main`,
  )
  const other = await get<HealthReport>(
    `/repos/${SECOND_REPO_ID}/health?branch=main`,
  )
  expect(other.health_score).not.toBe(demo.health_score)
})

// ── system ──────────────────────────────────────────────────────────────────

test("GET /healthz is alive", async () => {
  expect(await get<{ status: string }>("/healthz")).toEqual({ status: "ok" })
})
