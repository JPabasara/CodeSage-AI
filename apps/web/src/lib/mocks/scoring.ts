// The mock's scoring engine.
//
// Nothing numeric is stored. Findings, per-file risk and the snapshot timeline
// are facts; priorities, scores and the trend line are recomputed on every
// request under whichever profile is active. fixtures.ts holds the result of
// running this under Balanced; handlers.ts runs it live, so applying a profile
// really does re-rank the list. One formula, in one place:
//
//   priority = base_points × category_weight × source_trust × churn × risk
import type {
  Category,
  CategoryBreakdownItem,
  FileScore,
  Finding,
  Grade,
  HealthPoint,
  HealthReport,
  ScanSummary,
  ScoreProfile,
  Severity,
  Source,
  TreeNode,
} from "@/lib/types"

// ── the knobs ───────────────────────────────────────────────────────────────

/** Severity → base points. Severity is fixed at detection time. */
const BASE_POINTS: Record<Severity, number> = {
  critical: 40,
  high: 12,
  medium: 5,
  low: 1,
}

/**
 * Debt → health: one health point costs this much debt, so a clean repo scores
 * 100. Tuned only so the demo fixture lands on a believable B under Balanced.
 */
const DEBT_PER_HEALTH_POINT = 5.5

/**
 * Risk is a bounded multiplier on findings that already exist, never an additive
 * term — so a risky file with no findings still contributes no debt.
 *
 * `null` means never assessed, which is not "safe": it multiplies by 1.0.
 */
function riskFactor(risk: number | null | undefined): number {
  return 1 + 0.5 * (risk ?? 0)
}

/**
 * `rule_trust = 0.5 + s`, `ml_trust = 1.5 − s`.
 *
 * Security is pinned at 1.0, so no position of the trust slider can de-weight a
 * security finding.
 */
function sourceTrust(
  source: Source,
  category: Category,
  trustS: number,
): number {
  if (category === "security") return 1.0
  return source === "rule" ? 0.5 + trustS : 1.5 - trustS
}

/** `Category` uses hyphens on the wire; `CategoryWeights` uses snake_case keys. */
const WEIGHT_KEY: Record<Category, keyof ScoreProfile["weights"]> = {
  security: "security",
  "code-design": "code_design",
  requirement: "requirement",
  documentation: "documentation",
  test: "test",
}

export function gradeFor(score: number): Grade {
  if (score >= 85) return "A"
  if (score >= 70) return "B"
  if (score >= 55) return "C"
  if (score >= 40) return "D"
  return "E"
}

const round1 = (n: number) => Math.round(n * 10) / 10
const clampScore = (n: number) => Math.max(0, Math.min(100, Math.round(n)))

// ── stored facts ────────────────────────────────────────────────────────────

/** `Finding` without its derived `priority`, so a new required field breaks here. */
export type FindingFact = Omit<Finding, "priority">

/**
 * Per-file bug-proneness — a stored fact, not derived.
 *
 * `legacy_gateway.ts` is deliberately `null` (never assessed), which is not the
 * same as `0.0` (assessed, looks safe). It keeps that render path exercised.
 */
export const FILE_RISK: Record<string, number | null> = {
  "src/payments/payment_service.ts": 0.78,
  "src/payments/stripe_client.ts": 0.22,
  "src/orders/order_controller.ts": 0.55,
  "src/orders/order_repository.ts": 0.31,
  "src/api/legacy_gateway.ts": null,
  "src/lib/utils.ts": 0.12,
}

/**
 * Ten findings covering every category, source, severity and optional field, so
 * no render path goes untested. They are also chosen so the ranking genuinely
 * reorders between presets — otherwise the Profiles screen could ship broken and
 * no test would notice.
 */
export const FINDING_FACTS: FindingFact[] = [
  {
    fingerprint: "f-secret-1",
    source: "rule",
    category: "security",
    severity: "critical",
    file: "src/payments/payment_service.ts",
    line: 42,
    symbol: "charge()",
    reason:
      "Hardcoded Stripe API key detected — move it to an environment variable.",
    status: "open",
    pinned_by_floor: false,
    rule_id: "hardcoded-secret",
  },
  {
    // At the minimum security weight this finding would drop off the list; the
    // floor holds it there anyway, and `pinned_by_floor` lets the UI say why.
    fingerprint: "f-eval-1",
    source: "rule",
    category: "security",
    severity: "critical",
    file: "src/api/legacy_gateway.ts",
    line: 154,
    symbol: "handle()",
    reason:
      "User input reaches eval() — an attacker controls what this executes.",
    status: "open",
    pinned_by_floor: true,
    rule_id: "dangerous-eval",
  },
  {
    // The reorder lever: below the HIGH code-design finding under Balanced,
    // above it under Security-first.
    fingerprint: "f-sqli-1",
    source: "rule",
    category: "security",
    severity: "medium",
    file: "src/orders/order_repository.ts",
    line: 88,
    symbol: "findByCustomer()",
    reason: "SQL is built by string concatenation — use a parameterised query.",
    status: "open",
    pinned_by_floor: false,
    rule_id: "sql-string-concat",
  },
  {
    fingerprint: "f-long-1",
    source: "rule",
    category: "code-design",
    severity: "high",
    file: "src/orders/order_controller.ts",
    line: 5,
    symbol: "OrderController",
    reason:
      "order_controller.ts is 940 lines long (limit 800) — consider splitting the module.",
    status: "open",
    pinned_by_floor: false,
    rule_id: "large-file",
    metric_value: 940,
    threshold: 800,
  },
  {
    fingerprint: "f-ccn-1",
    source: "rule",
    category: "code-design",
    severity: "medium",
    file: "src/payments/payment_service.ts",
    line: 58,
    symbol: "charge()",
    reason:
      "charge() has cyclomatic complexity 18, over the limit of 15 — split it into smaller functions.",
    status: "open",
    pinned_by_floor: false,
    rule_id: "complex-function",
    metric_value: 18,
    threshold: 15,
  },
  {
    // The counterweight to f-sqli-1: HIGH, but documentation, so Security-first
    // pushes it down the list while Balanced keeps it near the top.
    fingerprint: "f-docs-api-1",
    source: "satd",
    category: "documentation",
    severity: "high",
    file: "src/api/legacy_gateway.ts",
    line: 7,
    symbol: null, // file-scoped: the comment sits at the top of the module
    reason:
      "Self-admitted debt: the module docs describe a contract we no longer serve.",
    status: "open",
    pinned_by_floor: false,
    comment_text:
      "// FIXME: these docs describe the v1 contract, which we stopped serving in March",
    confidence: 0.74,
  },
  {
    fingerprint: "f-todo-1",
    source: "satd",
    category: "code-design",
    severity: "medium",
    file: "src/payments/payment_service.ts",
    line: 12,
    symbol: null,
    reason: "Self-admitted debt: a temporary workaround is still in place.",
    status: "open",
    pinned_by_floor: false,
    comment_text: "// TODO: temporary hack until the new gateway lands",
    confidence: 0.82,
  },
  {
    fingerprint: "f-req-1",
    source: "satd",
    category: "requirement",
    severity: "medium",
    file: "src/payments/stripe_client.ts",
    line: 31,
    symbol: "refund()",
    reason: "Self-admitted debt: a required behaviour is not implemented yet.",
    status: "open",
    pinned_by_floor: false,
    comment_text: "// TODO: partial refunds are not implemented yet",
    confidence: 0.71,
  },
  {
    fingerprint: "f-test-1",
    source: "satd",
    category: "test",
    severity: "medium",
    file: "src/orders/order_controller.ts",
    line: 120,
    symbol: null,
    reason: "Self-admitted debt: a code path is knowingly untested.",
    status: "open",
    pinned_by_floor: false,
    comment_text: "// TODO: no integration test covers the cancel path",
    confidence: 0.69,
  },
  {
    fingerprint: "f-doc-1",
    source: "satd",
    category: "documentation",
    severity: "low",
    file: "src/lib/utils.ts",
    line: 3,
    symbol: "formatDate()",
    reason:
      "Self-admitted debt: behaviour that needs documenting is undocumented.",
    status: "open",
    pinned_by_floor: false,
    comment_text: "// FIXME: document the timezone handling",
    confidence: 0.66,
  },
]

/** Folder structure only. Every number on a tree node is derived, never stored. */
type ShapeNode = { path: string; name: string; children?: ShapeNode[] }

export const TREE_SHAPE: ShapeNode[] = [
  {
    path: "src",
    name: "src",
    children: [
      {
        path: "src/api",
        name: "api",
        children: [
          { path: "src/api/legacy_gateway.ts", name: "legacy_gateway.ts" },
        ],
      },
      {
        path: "src/lib",
        name: "lib",
        children: [{ path: "src/lib/utils.ts", name: "utils.ts" }],
      },
      {
        path: "src/orders",
        name: "orders",
        children: [
          {
            path: "src/orders/order_controller.ts",
            name: "order_controller.ts",
          },
          {
            path: "src/orders/order_repository.ts",
            name: "order_repository.ts",
          },
        ],
      },
      {
        path: "src/payments",
        name: "payments",
        children: [
          {
            path: "src/payments/payment_service.ts",
            name: "payment_service.ts",
          },
          { path: "src/payments/stripe_client.ts", name: "stripe_client.ts" },
        ],
      },
    ],
  },
]

/**
 * The stored snapshot timeline, newest last. `debt_multiplier` scales the same
 * findings so an older point scores worse without needing more fixtures.
 *
 * The trend chart and the scan-history list both read this array, so they cannot
 * disagree.
 */
export type SnapshotFact = {
  snapshot_id: string
  scan_id: string
  t: string
  commit_sha: string
  finding_count: number
  debt_multiplier: number
}

export const SNAPSHOTS: SnapshotFact[] = [
  {
    snapshot_id: "0f8b6a2c-1d43-4f7e-9a51-2c6d8e0b4a11",
    scan_id: "3a1e9c74-5b28-4d6f-8e03-71b2c4d59f80",
    t: "2026-06-20T09:12:00.000Z",
    commit_sha: "4d1f0a9c7b3e2158d6c4a09f7e5b31428ca6d902",
    finding_count: 15,
    debt_multiplier: 1.55,
  },
  {
    snapshot_id: "1a2c4e6f-8b09-4d13-a5c7-9e0f2b4d6a83",
    scan_id: "5c3f1e86-7d4a-4b90-92e1-83d4f6a71c25",
    t: "2026-06-30T11:40:00.000Z",
    commit_sha: "8e2b5c1d0f4a7936b8d2e0c5a19f3467d0b8e15a",
    finding_count: 14,
    debt_multiplier: 1.4,
  },
  {
    snapshot_id: "2b3d5f70-9c1a-4e25-b6d8-0f1a3c5e7b94",
    scan_id: "6d4a2f97-8e5b-4ca1-a3f2-94e5a7b82d36",
    t: "2026-07-08T08:05:00.000Z",
    commit_sha: "1c7d3e5a9b2f0846e1c3a5f7920b4d6e8a01c3f5",
    finding_count: 13,
    debt_multiplier: 1.28,
  },
  {
    snapshot_id: "3c4e6a81-0d2b-4f36-9c7e-1a2b4d6f8c05",
    scan_id: "7e5b3a08-9f6c-4db2-b403-a5f6b8c93e47",
    t: "2026-07-15T16:22:00.000Z",
    commit_sha: "9f8e7d6c5b4a39281706f5e4d3c2b1a09876f5e4",
    finding_count: 12,
    debt_multiplier: 1.1,
  },
  {
    snapshot_id: "4d5f7b92-1e3c-4a47-8df0-2b3c5e7a9d16",
    scan_id: "8f6c4b19-0a7d-4ec3-9514-b607c9da4f58",
    t: "2026-07-22T18:35:00.000Z",
    commit_sha: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
    finding_count: 10, // matches FINDING_FACTS.length — the newest snapshot IS today
    debt_multiplier: 1.0,
  },
]

// ── derivation ──────────────────────────────────────────────────────────────

/** The priority formula, in one expression. The rest is bookkeeping. */
export function priorityOf(fact: FindingFact, profile: ScoreProfile): number {
  const categoryWeight = profile.weights[WEIGHT_KEY[fact.category]]
  const trust = sourceTrust(fact.source, fact.category, profile.trust_s)
  const churn = 1.0 // the fixture carries no commit history to derive churn from
  return (
    BASE_POINTS[fact.severity] *
    categoryWeight *
    trust *
    churn *
    riskFactor(FILE_RISK[fact.file])
  )
}

/** Findings scored under `profile`, already sorted by priority descending. */
export function scoreFindings(profile: ScoreProfile, debtScale = 1): Finding[] {
  return FINDING_FACTS.map((fact) => ({
    ...fact,
    priority: round1(priorityOf(fact, profile) * debtScale),
  })).sort((a, b) => b.priority - a.priority)
}

/** Sum of the priorities of the open findings in each file. */
export function scoreFiles(findings: Finding[]): FileScore[] {
  return Object.keys(FILE_RISK)
    .map((file) => ({
      file,
      debt_score: round1(
        findings
          .filter((f) => f.file === file && f.status === "open")
          .reduce((sum, f) => sum + f.priority, 0),
      ),
      risk_score: FILE_RISK[file],
    }))
    .sort((a, b) => b.debt_score - a.debt_score)
}

function healthFromDebt(debt: number): number {
  return clampScore(100 - debt / DEBT_PER_HEALTH_POINT)
}

/**
 * A file is judged on a tighter scale than a whole repository: 70 points of debt
 * is a middling repo but a catastrophic single file. One shared constant made
 * every file score 86–100 and the heat map came out uniformly green.
 */
const FILE_DEBT_PER_HEALTH_POINT = 0.8

/**
 * Fold file debt up the tree. A folder's `debt_score` is the sum of the files
 * beneath it, but its `health_score` is the mean of their health — re-running
 * the curve on summed debt would drive every ancestor towards zero just for
 * containing more files, making the root always the worst node on screen.
 *
 * `risk_score` is set on files only; a folder-level risk would average estimates
 * that were never meant to be averaged.
 */
export function buildTree(fileScores: FileScore[]): TreeNode[] {
  const debtOf = new Map(fileScores.map((f) => [f.file, f.debt_score]))

  const build = (node: ShapeNode): { node: TreeNode; fileHealth: number[] } => {
    if (!node.children) {
      const debt = debtOf.get(node.path) ?? 0
      const health = clampScore(100 - debt / FILE_DEBT_PER_HEALTH_POINT)
      return {
        node: {
          path: node.path,
          name: node.name,
          type: "file",
          health_score: health,
          grade: gradeFor(health),
          debt_score: debt,
          risk_score: FILE_RISK[node.path] ?? null,
        },
        fileHealth: [health],
      }
    }

    const built = node.children.map(build)
    const fileHealth = built.flatMap((b) => b.fileHealth)
    const debt = round1(built.reduce((sum, b) => sum + b.node.debt_score, 0))
    const health = clampScore(
      fileHealth.reduce((sum, h) => sum + h, 0) /
        Math.max(1, fileHealth.length),
    )
    return {
      node: {
        path: node.path,
        name: node.name,
        type: "folder",
        health_score: health,
        grade: gradeFor(health),
        debt_score: debt,
        children: built.map((b) => b.node),
      },
      fileHealth,
    }
  }

  return TREE_SHAPE.map((n) => build(n).node)
}

/**
 * `count` is a plain query over stored rows; `debt` is weighted by the active
 * profile. The two move independently on purpose — a category can hold many
 * findings and little debt, which is exactly what the pie is for.
 *
 * All five categories are emitted, including any with a count of zero: a missing
 * slice and an empty slice mean different things, and the legend should stay
 * stable as the profile changes.
 */
export function categoryBreakdown(
  findings: Finding[],
): CategoryBreakdownItem[] {
  const CATEGORIES: Category[] = [
    "security",
    "code-design",
    "documentation",
    "requirement",
    "test",
  ]
  return CATEGORIES.map((category) => {
    const mine = findings.filter((f) => f.category === category)
    return {
      category,
      count: mine.length,
      debt: round1(mine.reduce((sum, f) => sum + f.priority, 0)),
    }
  })
}

/** Total debt for one snapshot under `profile`, on a branch scaled by `scale`. */
function debtAt(profile: ScoreProfile, scale: number): number {
  return FINDING_FACTS.reduce(
    (sum, fact) => sum + round1(priorityOf(fact, profile) * scale),
    0,
  )
}

/**
 * The trend line. Every point is computed under the same, currently active
 * profile, so a profile change redraws the whole history and any two points stay
 * comparable. A line whose points came from different profiles could not
 * distinguish a code change from a settings change.
 */
export function trendFor(
  profile: ScoreProfile,
  branchScale: number,
): HealthPoint[] {
  return SNAPSHOTS.map((snap) => ({
    t: snap.t,
    score: healthFromDebt(debtAt(profile, branchScale * snap.debt_multiplier)),
    commit_sha: snap.commit_sha,
  }))
}

/** Scan history, newest first. Same snapshots, same lens as the trend. */
export function scanHistoryFor(
  profile: ScoreProfile,
  branch: string,
  branchScale: number,
): ScanSummary[] {
  const scores = SNAPSHOTS.map((snap) =>
    healthFromDebt(debtAt(profile, branchScale * snap.debt_multiplier)),
  )
  return SNAPSHOTS.map((snap, i) => ({
    snapshot_id: snap.snapshot_id,
    scan_id: snap.scan_id,
    branch,
    commit_sha: snap.commit_sha,
    scanned_at: snap.t,
    finding_count: snap.finding_count,
    health_score: scores[i],
    grade: gradeFor(scores[i]),
    delta: i === 0 ? 0 : scores[i] - scores[i - 1],
  })).reverse()
}

export type ReportInput = {
  repoId: string
  branch: string
  commitSha: string
  /** Scales this repo's / branch's debt so different rows tell different stories. */
  debtScale: number
  profile: ScoreProfile
  /** Which stored snapshot to render. Defaults to the newest. */
  snapshotId?: string
}

/** The whole dashboard payload, every number of it derived. */
export function buildHealthReport(input: ReportInput): HealthReport {
  const { repoId, branch, commitSha, debtScale, profile, snapshotId } = input

  const found = snapshotId
    ? SNAPSHOTS.findIndex((s) => s.snapshot_id === snapshotId)
    : -1
  const at = found === -1 ? SNAPSHOTS.length - 1 : found
  const snapshot = SNAPSHOTS[at]

  const findings = scoreFindings(profile, debtScale * snapshot.debt_multiplier)
  const fileScores = scoreFiles(findings)
  const totalDebt = findings.reduce((sum, f) => sum + f.priority, 0)
  const health = healthFromDebt(totalDebt)

  // The trend is drawn up to the snapshot being viewed, so loading an older
  // snapshot from Scan History does not show a future the user is not looking at.
  const trend = trendFor(profile, debtScale)
  const previous = at > 0 ? trend[at - 1].score : health

  return {
    snapshot_id: snapshot.snapshot_id,
    repo_id: repoId,
    branch,
    commit_sha: snapshotId ? snapshot.commit_sha : commitSha,
    scanned_at: snapshot.t,
    health_score: health,
    grade: gradeFor(health),
    delta: health - previous,
    red_issue_count: findings.filter(
      (f) => f.severity === "critical" || f.severity === "high",
    ).length,
    profile: profile.name,
    model_version: "satd-distilbert-1.2.0",
    history: trend.slice(0, at + 1),
    tree: buildTree(fileScores),
    file_scores: fileScores,
    findings,
    category_breakdown: categoryBreakdown(findings),
  }
}
