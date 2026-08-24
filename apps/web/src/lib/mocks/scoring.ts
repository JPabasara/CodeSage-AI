// ────────────────────────────────────────────────────────────────────────────
// THE MOCK'S SCORING ENGINE
//
// The contract is emphatic that the dashboard carries no stored scores:
//
//   "Every score here is computed on this request under the workspace's active
//    profile — health_score, grade, delta, each finding's priority, each file's
//    debt_score, and the whole trend line. None is read from a column (FR-21)."
//
// A mock that returned hand-written priorities would quietly contradict that:
// the Profiles screen would appear to do nothing, and the first time the real
// backend re-ranked a list we would discover the UI had never been built for it.
// So this file holds the two halves the contract separates:
//
//   STORED FACTS  — findings, per-file risk, the snapshot timeline. Written once
//                   at detection and never recomputed.
//   DERIVATION    — everything numeric, recomputed from those facts under
//                   whichever profile is active right now.
//
// `fixtures.ts` exports the results of running this under Balanced, so component
// tests get plain contract-shaped data. `handlers.ts` runs it per request against
// the live active profile, so applying a profile really does re-rank the list.
// Neither can drift from the other: there is one formula, and it lives here.
//
// The formula is FR-11:
//
//   priority = base_points(severity)
//            × category_weight        ← the profile
//            × source_trust           ← the trust slider, fixed at 1.0 for security
//            × churn_factor           ← 1.0 here; the fixture has no commit history
//            × risk_factor            ← ML-2's per-file estimate, bounded
// ────────────────────────────────────────────────────────────────────────────
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

/** Severity → base points. Severity is assigned once at detection (FR-8.1). */
const BASE_POINTS: Record<Severity, number> = {
  critical: 40,
  high: 12,
  medium: 5,
  low: 1,
}

/**
 * Debt → health. One health point costs this much debt, so a repo with no
 * findings scores 100 and debt drives it down. The real backend calibrates `k`
 * against a corpus (CR-001 D-CR5); this constant is only tuned so the demo
 * fixture lands on a believable B under Balanced.
 */
const DEBT_PER_HEALTH_POINT = 5.5

/**
 * `risk_score` enters scoring as a bounded MULTIPLIER on findings that already
 * exist, never as an additive term (CR-001 D-CR5). A risky file with no findings
 * therefore still contributes no debt.
 *
 * `null` risk means the ML service was unreachable when the snapshot was taken —
 * not "safe". It multiplies by 1.0: no boost, no penalty, no invented estimate.
 */
function riskFactor(risk: number | null | undefined): number {
  return 1 + 0.5 * (risk ?? 0)
}

/**
 * `rule_trust = 0.5 + s`, `ml_trust = 1.5 − s` (FR-11).
 *
 * Security findings are excluded — `source_trust` is pinned at 1.0 for the
 * `security` category, so no position of the trust slider can de-weight them.
 * That is mechanism 2 of the critical-security floor (FR-24).
 */
function sourceTrust(source: Source, category: Category, trustS: number): number {
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

/**
 * A finding minus its derived field. Exactly `Finding` without `priority` —
 * spelled this way so adding a required field to the contract breaks here.
 */
export type FindingFact = Omit<Finding, "priority">

/**
 * ML-2's per-file bug-proneness. A STORED fact, not derived.
 *
 * `legacy_gateway.ts` is deliberately `null`: the ML service was unreachable when
 * this snapshot was taken. That is a different thing from `0.0` ("measured, looks
 * safe"), and the UI must render it as "not assessed" rather than a zero-risk
 * badge. Having one in the fixture is the only way that path is ever exercised.
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
 * Ten findings covering every axis the contract defines, because a fixture that
 * only exercises three categories leaves several render paths untested:
 *
 *   • all five `Category` values          • both `Source` values
 *   • all four `Severity` values          • `pinned_by_floor` true AND false
 *   • rule extras (`rule_id`, `metric_value`, `threshold`)
 *   • SATD extras (`comment_text`, `confidence`)
 *   • `symbol: null` for file-scoped findings
 *
 * They are also chosen so the ranking genuinely REORDERS between presets — see
 * the note on `f-sqli-1`. A fixture where every profile produced the same order
 * would let the Profiles screen ship broken and no test would notice.
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
    // The floor demo (FR-24): at the minimum security weight of 0.1 this
    // finding's computed priority would drop it off the visible list, and the
    // floor holds it there anyway. `pinned_by_floor` lets the UI explain why.
    fingerprint: "f-eval-1",
    source: "rule",
    category: "security",
    severity: "critical",
    file: "src/api/legacy_gateway.ts",
    line: 154,
    symbol: "handle()",
    reason: "User input reaches eval() — an attacker controls what this executes.",
    status: "open",
    pinned_by_floor: true,
    rule_id: "dangerous-eval",
  },
  {
    // The reorder lever. A MEDIUM security finding sits below the HIGH
    // code-design one under Balanced and jumps above it under Security-first —
    // which is what a weight is for, and the one thing a profiles test must prove.
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
          { path: "src/orders/order_controller.ts", name: "order_controller.ts" },
          { path: "src/orders/order_repository.ts", name: "order_repository.ts" },
        ],
      },
      {
        path: "src/payments",
        name: "payments",
        children: [
          { path: "src/payments/payment_service.ts", name: "payment_service.ts" },
          { path: "src/payments/stripe_client.ts", name: "stripe_client.ts" },
        ],
      },
    ],
  },
]

/**
 * The stored snapshot timeline, newest LAST. `debt_multiplier` stands in for
 * "this snapshot held more findings than today's" — it scales the same stored
 * findings so an older point scores worse without needing ten more fixtures.
 *
 * Both the trend chart and the Scan-History list are built from this one array,
 * so a point on the chart and a row in the table can never disagree.
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

/** FR-11, in one expression. Everything else here is bookkeeping around it. */
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

/** Sum of the priorities of the open findings in each file (contract: FileScore). */
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
 * A FILE's debt is judged on a much tighter scale than a whole repository's:
 * 70 points of debt is a middling repo but a catastrophic single file. Sharing
 * one constant made every file score 86–100 and the heat map came out uniformly
 * green, which defeats the point of having one (FR-18).
 */
const FILE_DEBT_PER_HEALTH_POINT = 0.8

/**
 * Build the tree from the shape, folding file debt upward. Folder `debt_score`
 * is the SUM of the files beneath it — that is what lets the real backend drill
 * into a subtree by adding numbers already in memory.
 *
 * Folder `health_score`, though, is the MEAN of the descendant files' health,
 * not a recomputation from the summed debt. Summing debt and re-running the
 * curve would drive every ancestor towards zero purely because it contains more
 * files, so the repository root would always be the worst node on screen.
 *
 * `risk_score` is set on FILES ONLY — the contract says so explicitly, and a
 * folder-level "risk" would be an average of estimates that were never averaged.
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
      fileHealth.reduce((sum, h) => sum + h, 0) / Math.max(1, fileHealth.length),
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
 * findings and little debt, which is exactly what the pie is for (FR-13).
 *
 * All five categories are emitted, including any with a count of zero: a missing
 * slice and an empty slice mean different things, and the legend should stay
 * stable as the profile changes.
 */
export function categoryBreakdown(findings: Finding[]): CategoryBreakdownItem[] {
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
 * The trend line (FR-14). Every point is computed under the same, currently
 * active profile, so a profile change redraws the whole history and any two
 * points stay comparable. A line whose points came from different profiles could
 * not distinguish a code change from a settings change.
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

/** Scan history, newest first (FR-19). Same snapshots, same lens as the trend. */
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
  /** Which stored snapshot to render. Defaults to the newest (FR-19). */
  snapshotId?: string
}

/** The whole dashboard payload, every number of it derived (FR-21). */
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
