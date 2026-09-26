// Do the mocks tell the truth?
//
// The frontend is built against these while the backend endpoints are still
// stubs. If they drift from the OpenAPI contract, the component tests pass
// against a fiction and the live site breaks with nothing catching it.
//
// These check RESPONSES, not fixtures — a handler can assemble a shape no
// fixture ever had — and three things in particular:
//
//   • Status codes. 202 for a queued scan, 201 for a connect, 409 for the two
//     conflicts, 422 for a malformed body. A mock that answers 200 to everything
//     teaches the UI that failure modes do not exist.
//   • No extra keys. Every schema is `additionalProperties: false`, so a field
//     invented here is drift, not a bonus.
//   • Derived, not stored. Applying a profile must actually re-rank the list.
//
// Field lists come from the contract's `required:` arrays, so a contract change
// fails these — which is the point.
import { expect, test } from "vitest"

import type {
  ApiError,
  Activity,
  HealthReport,
  ProjectProfile,
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

function patch(path: string, body: unknown) {
  return fetch(`${BASE}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

function del(path: string) {
  return fetch(`${BASE}${path}`, { method: "DELETE" })
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
    // Full 40-character SHA: a 7-char fixture would let a `.slice(0, 7)` bug
    // through unnoticed.
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

  // The critical-security floor has to be renderable, so at least one finding
  // must carry it and at least one must not.
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

  // null means never assessed — a different thing from 0.0, which is a measured
  // "this file looks safe".
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
  // Trends and deltas are per branch too.
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

/** Every optional ScanStatus key the contract defines, 13H.4's stage included. */
const SCAN_STATUS_OPTIONAL = [
  "branch",
  "commit_sha",
  "started_at",
  "finished_at",
  "error",
  "error_code",
  "stage",
  "files_done",
  "files_total",
  "typical_seconds",
]

test("the scan lifecycle is contract-shaped, and answers 202 at both writes", async () => {
  const started = await post(`/repos/${DEMO_REPO_ID}/scan`, { branch: "main" })
  // 202, not 200: the work is queued on a worker, never done in this request.
  expect(started.status).toBe(202)

  const scan = (await started.json()) as ScanStatus
  expectShape(
    scan,
    ["scan_id", "phase", "progress"],
    SCAN_STATUS_OPTIONAL,
    "ScanStatus (start)",
  )
  expect(scan.scan_id).toMatch(UUID)

  const ticked = await get<ScanStatus>(
    `/repos/${DEMO_REPO_ID}/scan/${scan.scan_id}`,
  )
  // 13H.4: a running scan names its stage, and the mock agrees with the bands.
  expect(ticked.stage).toBeTruthy()
  expectShape(
    ticked,
    ["scan_id", "phase", "progress"],
    SCAN_STATUS_OPTIONAL,
    "ScanStatus (tick)",
  )

  const stopped = await post(`/repos/${DEMO_REPO_ID}/scan/${scan.scan_id}/stop`)
  expect(stopped.status).toBe(202)
  expectShape(
    (await stopped.json()) as ScanStatus,
    ["scan_id", "phase", "progress"],
    SCAN_STATUS_OPTIONAL,
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
  // one that never ran.
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
  "usage_count",
  "editable",
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
    // Five weights, no more and no fewer.
    expect(Object.keys(preset.weights)).toHaveLength(5)
  }
  expect(presets.map((p) => p.name)).toEqual([
    "Balanced",
    "Security-first",
    "Delivery-speed",
  ])
  // Exactly one workspace default: one settings row per workspace holds it.
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

  // No column was read, so tripling the security weight moves everything.
  expect(after.findings.map((f) => f.fingerprint)).not.toEqual(
    before.findings.map((f) => f.fingerprint),
  )
  expect(after.health_score).not.toBe(before.health_score)
  // One lens per line: the whole history is redrawn, not just today.
  expect(after.history.map((p) => p.score)).not.toEqual(
    before.history.map((p) => p.score),
  )
  // The chart is labelled with the profile, or its changing shape reads as a bug.
  expect(after.profile).toBe("Security-first")

  // A profile change writes no snapshot and starts no scan.
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

// ── the profile pool ────────────────────────────────────────────────────────

const weights = {
  security: 2,
  code_design: 1,
  requirement: 1,
  documentation: 1,
  test: 1,
}

/** Author one custom profile and return it, failing loudly if the POST does not. */
async function makeProfile(name: string): Promise<ScoreProfile> {
  const res = await post("/profiles", { name, weights, trust_s: 0.5 })
  expect(res.status, `POST /profiles ${name}`).toBe(201)
  return (await res.json()) as ScoreProfile
}

test("POST /profiles adds to the pool WITHOUT becoming the default", async () => {
  const created = await makeProfile("Release gate")

  expectShape(created, PROFILE_KEYS, [], "ScoreProfile (created)")
  expect(created.is_preset).toBe(false)
  expect(created.editable).toBe(true)
  // Authoring a profile and choosing the one in force are separate acts.
  expect(created.is_active).toBe(false)
  expect(created.usage_count).toBe(0)

  const pool = await get<ScoreProfile[]>("/profiles")
  expect(pool).toHaveLength(4)
  // Built-ins still come first, and the default has not moved.
  expect(pool.slice(0, 3).every((p) => p.is_preset)).toBe(true)
  expect(pool.find((p) => p.is_active)?.name).toBe("Balanced")
})

test("the sixth custom profile is refused, and built-ins do not count", async () => {
  for (const name of ["One", "Two", "Three", "Four", "Five"]) {
    await makeProfile(name)
  }
  // Five customs plus three built-ins: the limit is on the customs alone.
  expect(await get<ScoreProfile[]>("/profiles")).toHaveLength(8)

  const sixth = await post("/profiles", {
    name: "Six",
    weights,
    trust_s: 0.5,
  })
  expect(sixth.status).toBe(409)
  expect(((await sixth.json()) as ApiError).code).toBe("PROFILE_LIMIT_REACHED")
})

test("a duplicate name is refused after trimming and lower-casing", async () => {
  await makeProfile("Release gate")

  const clash = await post("/profiles", {
    name: "  release GATE ",
    weights,
    trust_s: 0.5,
  })
  expect(clash.status).toBe(409)
  expect(((await clash.json()) as ApiError).code).toBe("PROFILE_NAME_CONFLICT")
})

test("PATCH is partial: an omitted weight keeps its stored value", async () => {
  const created = await makeProfile("Release gate")

  const res = await patch(`/profiles/${created.id}`, {
    weights: { test: 0.4 },
  })
  expect(res.status).toBe(200)
  const saved = (await res.json()) as ScoreProfile

  expect(saved.weights.test).toBe(0.4)
  // The four the body never mentioned are untouched, which is the whole point
  // of a PATCH from a form that tracks only what changed.
  expect(saved.weights.security).toBe(2)
  expect(saved.name).toBe("Release gate")
  expect(saved.trust_s).toBe(0.5)
})

test("PATCH clamps out-of-range values rather than rejecting them", async () => {
  const created = await makeProfile("Release gate")

  const res = await patch(`/profiles/${created.id}`, {
    weights: { security: 9, code_design: 0 },
    trust_s: 5,
  })
  expect(res.status).toBe(200)
  const saved = (await res.json()) as ScoreProfile
  expect(saved.weights.security).toBe(3)
  expect(saved.weights.code_design).toBe(0.1)
  expect(saved.trust_s).toBe(1)
})

test("built-ins refuse every write, by code and not by silence", async () => {
  const balanced = (await get<ScoreProfile[]>("/profiles")).find(
    (p) => p.name === "Balanced",
  )!
  expect(balanced.editable).toBe(false)

  const edited = await patch(`/profiles/${balanced.id}`, { name: "Mine" })
  expect(edited.status).toBe(409)
  expect(((await edited.json()) as ApiError).code).toBe("PROFILE_BUILT_IN")

  const removed = await del(`/profiles/${balanced.id}`)
  expect(removed.status).toBe(409)
  expect(((await removed.json()) as ApiError).code).toBe("PROFILE_BUILT_IN")
})

test("an unused custom profile deletes; the default and an assigned one do not", async () => {
  const spare = await makeProfile("Spare")
  expect((await del(`/profiles/${spare.id}`)).status).toBe(204)

  const chosen = await makeProfile("Chosen")
  await put("/profiles/default", { profile_id: chosen.id })
  const asDefault = await del(`/profiles/${chosen.id}`)
  expect(asDefault.status).toBe(409)
  expect(((await asDefault.json()) as ApiError).code).toBe("PROFILE_IN_USE")

  const assigned = await makeProfile("Assigned")
  await put(`/projects/${DEMO_REPO_ID}/profile`, { profile_id: assigned.id })
  const inUse = await del(`/profiles/${assigned.id}`)
  expect(inUse.status).toBe(409)
  expect(((await inUse.json()) as ApiError).code).toBe("PROFILE_IN_USE")
})

test("a profile id from outside the pool is 404, not 403 or 409", async () => {
  const stranger = "00000000-0000-4000-8000-000000000000"
  expect((await fetch(`${BASE}/profiles/${stranger}`)).status).toBe(404)
  expect(
    (await put("/profiles/default", { profile_id: stranger })).status,
  ).toBe(404)
  expect(
    (await put(`/projects/${DEMO_REPO_ID}/profile`, { profile_id: stranger }))
      .status,
  ).toBe(404)
})

test("PUT /profiles/default moves the default and is idempotent", async () => {
  const securityFirst = (await get<ScoreProfile[]>("/profiles")).find(
    (p) => p.name === "Security-first",
  )!

  const first = await put("/profiles/default", {
    profile_id: securityFirst.id,
  })
  expect(first.status).toBe(200)
  expect(((await first.json()) as ScoreProfile).is_active).toBe(true)

  // The second PUT of the same id changes nothing.
  const again = await put("/profiles/default", {
    profile_id: securityFirst.id,
  })
  expect(((await again.json()) as ScoreProfile).id).toBe(securityFirst.id)

  const pool = await get<ScoreProfile[]>("/profiles")
  // Exactly one default: the pointer moved rather than being added to.
  expect(pool.filter((p) => p.is_active)).toHaveLength(1)
  expect(pool.find((p) => p.is_active)?.name).toBe("Security-first")
})

test("GET /projects/{id}/profile says what it is scored with, and where from", async () => {
  const inherited = await get<ProjectProfile>(
    `/projects/${DEMO_REPO_ID}/profile`,
  )
  expectShape(
    inherited,
    ["repo_id", "inherited", "effective", "workspace_default"],
    ["override"],
    "ProjectProfile",
  )
  expect(inherited.inherited).toBe(true)
  // `override` is null exactly when `inherited` is true.
  expect(inherited.override).toBeNull()
  expect(inherited.effective.id).toBe(inherited.workspace_default.id)
})

test("an override applies to one project and leaves the others inheriting", async () => {
  const securityFirst = (await get<ScoreProfile[]>("/profiles")).find(
    (p) => p.name === "Security-first",
  )!

  const res = await put(`/projects/${DEMO_REPO_ID}/profile`, {
    profile_id: securityFirst.id,
  })
  expect(res.status).toBe(200)
  const assigned = (await res.json()) as ProjectProfile
  expect(assigned.inherited).toBe(false)
  expect(assigned.override?.id).toBe(securityFirst.id)
  expect(assigned.effective.id).toBe(securityFirst.id)
  // The workspace default is untouched by one project's choice.
  expect(assigned.workspace_default.name).toBe("Balanced")

  const neighbour = await get<ProjectProfile>(
    `/projects/${SECOND_REPO_ID}/profile`,
  )
  expect(neighbour.inherited).toBe(true)
  expect(neighbour.effective.name).toBe("Balanced")

  // usage_count counts the projects that name it; the default's inheritors are
  // what `is_active` already says, so they are not counted here.
  const pool = await get<ScoreProfile[]>("/profiles")
  expect(pool.find((p) => p.id === securityFirst.id)?.usage_count).toBe(1)
  expect(pool.find((p) => p.name === "Balanced")?.usage_count).toBe(0)
})

/** Ask until the score is ready: a profile change re-scores for a moment. */
async function healthOnceScored(repoId: string): Promise<HealthReport> {
  for (let i = 0; i < 20; i += 1) {
    const res = await fetch(`${BASE}/repos/${repoId}/health?branch=main`)
    if (res.status === 200) return (await res.json()) as HealthReport
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error("the score never became ready")
}

test("the dashboard scores each project with its OWN effective profile", async () => {
  const before = await get<HealthReport>(
    `/repos/${DEMO_REPO_ID}/health?branch=main`,
  )
  const securityFirst = (await get<ScoreProfile[]>("/profiles")).find(
    (p) => p.name === "Security-first",
  )!
  await put(`/projects/${DEMO_REPO_ID}/profile`, {
    profile_id: securityFirst.id,
  })

  // Assigning a profile re-scores the project, like the real API's warm-up:
  // the score is pending for a moment, and Activity lists it meanwhile.
  const whileRescoring = await fetch(
    `${BASE}/repos/${DEMO_REPO_ID}/health?branch=main`,
  )
  expect(whileRescoring.status).toBe(503)
  const activity = await get<Activity>("/activity")
  expect(activity.rescoring.map((r) => r.repo_id)).toContain(DEMO_REPO_ID)

  const after = await healthOnceScored(DEMO_REPO_ID)
  expect(after.profile).toBe("Security-first")
  expect(after.health_score).not.toBe(before.health_score)
  // …while its neighbour, which named nothing, is still on the default.
  const neighbour = await get<HealthReport>(
    `/repos/${SECOND_REPO_ID}/health?branch=main`,
  )
  expect(neighbour.profile).toBe("Balanced")

  // An assignment is not a scan: no snapshot was written.
  expect(after.snapshot_id).toBe(before.snapshot_id)
  expect(after.scanned_at).toBe(before.scanned_at)
})

test("clearing an override is idempotent and restores inheritance", async () => {
  const deliverySpeed = (await get<ScoreProfile[]>("/profiles")).find(
    (p) => p.name === "Delivery-speed",
  )!
  await put(`/projects/${DEMO_REPO_ID}/profile`, {
    profile_id: deliverySpeed.id,
  })

  const cleared = await del(`/projects/${DEMO_REPO_ID}/profile`)
  expect(cleared.status).toBe(200)
  expect(((await cleared.json()) as ProjectProfile).inherited).toBe(true)

  // Clearing a project that has no override succeeds and says the same thing.
  const again = await del(`/projects/${DEMO_REPO_ID}/profile`)
  expect(again.status).toBe(200)
  const state = (await again.json()) as ProjectProfile
  expect(state.inherited).toBe(true)
  expect(state.effective.name).toBe("Balanced")
})

test("removing a project takes its profile assignment with it", async () => {
  const spare = await makeProfile("Spare")
  await put(`/projects/${SECOND_REPO_ID}/profile`, { profile_id: spare.id })
  expect(
    (await get<ScoreProfile[]>("/profiles")).find((p) => p.id === spare.id)
      ?.usage_count,
  ).toBe(1)

  expect(
    (
      await fetch(`${BASE}/projects/${SECOND_REPO_ID}`, {
        method: "DELETE",
      })
    ).status,
  ).toBe(204)

  // The assignment cascades, so the profile is not left permanently
  // undeletable by a project that no longer exists.
  expect(
    (await get<ScoreProfile[]>("/profiles")).find((p) => p.id === spare.id)
      ?.usage_count,
  ).toBe(0)
  expect((await del(`/profiles/${spare.id}`)).status).toBe(204)
})

// ── system ──────────────────────────────────────────────────────────────────

test("GET /healthz is alive", async () => {
  expect(await get<{ status: string }>("/healthz")).toEqual({ status: "ok" })
})

// ── members ─────────────────────────────────────────────────────────────────

test("the only active org-admin can be neither demoted nor deactivated", async () => {
  const self = "a1000000-0000-4000-8000-000000000001"
  const demote = await fetch(`http://localhost/api/members/${self}/role`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role: "viewer" }),
  })
  expect(demote.status).toBe(409)
  expect((await demote.json()).code).toBe("CONFLICT")

  const deactivate = await fetch(`http://localhost/api/members/${self}`, {
    method: "DELETE",
  })
  expect(deactivate.status).toBe(409)
})

test("member_count counts active members only, and follows deactivation", async () => {
  const count = async () =>
    (
      (await (await fetch("http://localhost/api/auth/workspaces")).json()) as {
        is_active: boolean
        member_count: number
      }[]
    ).find((w) => w.is_active)?.member_count

  expect(await count()).toBe(4)
  await fetch(
    "http://localhost/api/members/a1000000-0000-4000-8000-000000000003",
    { method: "DELETE" },
  )
  expect(await count()).toBe(3)
})

// ── activity ────────────────────────────────────────────────────────────────

test("activity lists running scans with their project, and nothing when quiet", async () => {
  const quiet = await get<Activity>("/activity")
  expect(quiet).toEqual({ scans: [], rescoring: [] })

  const started = (await (
    await post(`/repos/${DEMO_REPO_ID}/scan`, { branch: "main" })
  ).json()) as ScanStatus
  const busy = await get<Activity>("/activity")
  expect(busy.scans).toHaveLength(1)
  expectShape(
    busy.scans[0],
    ["repo_id", "repo_name", "status"],
    [],
    "ActiveScan",
  )
  expect(busy.scans[0]?.repo_id).toBe(DEMO_REPO_ID)
  expect(busy.scans[0]?.repo_name).toMatch(/\//)
  expect(busy.scans[0]?.status.scan_id).toBe(started.scan_id)
})

test("a finished scan is a new snapshot; the old one still answers by its id", async () => {
  const before = await get<HealthReport>(
    `/repos/${DEMO_REPO_ID}/health?branch=main`,
  )
  const scan = (await (
    await post(`/repos/${DEMO_REPO_ID}/scan`, { branch: "main" })
  ).json()) as ScanStatus
  for (let i = 0; i < 10; i += 1) {
    const status = await get<ScanStatus>(
      `/repos/${DEMO_REPO_ID}/scan/${scan.scan_id}`,
    )
    if (status.phase === "done") break
  }

  const after = await healthOnceScored(DEMO_REPO_ID)
  expect(after.snapshot_id).not.toBe(before.snapshot_id)
  const old = await get<HealthReport>(
    `/repos/${DEMO_REPO_ID}/health?branch=main&snapshot_id=${before.snapshot_id}`,
  )
  expect(old.snapshot_id).toBe(before.snapshot_id)
})
