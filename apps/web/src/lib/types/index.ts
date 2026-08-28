// The data contract — the shapes that flow between the frontend, the mock API
// and the real backend. Everyone imports from `@/lib/types`.
//
// These match the OpenAPI contract exactly: field names, required/optional and
// nullability. The generated `./api.ts` is the authority; when the two disagree,
// api.ts wins and this file is wrong.
//
// Two things to know before editing:
//   * snake_case is the name on the wire. Do not "tidy" a field to camelCase.
//   * `?: T | null` means the backend may omit it OR send null. Both happen, and
//     both mean the same to the UI: render the fallback.
//
// React component props are internal and stay camelCase.

// ── enums ───────────────────────────────────────────────────────────────────

/**
 * How bad the finding is. Assigned by the detector at scan time and stored on the
 * row, never computed here — rules carry a fixed severity, SATD findings default
 * to "medium". The client only maps this to a colour token.
 */
export type Severity = "critical" | "high" | "medium" | "low"

/**
 * Which detector produced the finding — orthogonal to `Category`, and exactly two
 * values.
 *
 * There is no `security` source: security patterns run inside the rule engine, so
 * a security finding is a `rule` finding categorised `security`. Nor an `ml-risk`
 * one — the risk model scores files, it never emits a finding.
 */
export type Source = "rule" | "satd"

/** What type of debt it is — orthogonal to `Source`. Matches the dataset labels. */
export type Category =
  | "code-design" // rule engine + SATD   (dataset label: "code/design")
  | "requirement" // SATD
  | "documentation" // SATD
  | "test" // SATD
  | "security" // rule engine (security patterns: secrets, SQL concat, eval/exec)

/**
 * v1.0 is view-only: every finding is `open`. The other values exist now because
 * scoring sums *open* priorities, so the filter needs something to filter on.
 */
export type FindingStatus = "open" | "accepted" | "resolved" | "false-positive"

// A is best, E is worst.
export type Grade = "A" | "B" | "C" | "D" | "E"

// ── Errors ──────────────────────────────────────────────────────────────────

/**
 * The stable, machine-readable reason a request failed. New members may be added;
 * existing members never change meaning — so it is safe to branch on.
 */
export type ErrorCode =
  | "NOT_AUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVALID_REPOSITORY_URL"
  | "REPOSITORY_NOT_PUBLIC"
  | "REPOSITORY_UNREACHABLE"
  | "ALREADY_CONNECTED"
  | "SCAN_ALREADY_RUNNING"
  | "SCAN_NOT_CANCELLABLE"
  | "VALIDATION_FAILED"
  | "RATE_LIMITED"
  | "UPSTREAM_UNAVAILABLE"
  | "INTERNAL_ERROR"

/** The body of `POST /api/projects`. */
export interface ConnectRepoRequest {
  url: string // a PUBLIC repository URL
}

/** Every non-2xx response body. `code` is required, not decorative. */
export interface ApiError {
  detail: string // a human-readable sentence naming what failed
  code: ErrorCode
  errors?: { field: string; detail: string }[] // VALIDATION_FAILED only
}

// ── Session: who is signed in (GET /api/auth/session) ───────────────────────

/**
 * Only `user_id` and `workspace_id` are guaranteed. Everything else comes from
 * the identity provider and may be absent — render a fallback, never assume.
 */
export interface Session {
  user_id: string
  workspace_id: string
  email?: string | null
  name?: string | null
  avatar_url?: string | null
  identity_provider?: string | null
}

// ── Finding: one row in the Refactor-First list ─────────────────────────────

export interface Finding {
  fingerprint: string // stable id across scans (deduplication + track a finding over time)
  source: Source
  category: Category
  severity: Severity
  file: string
  line: number
  symbol?: string | null // the function/class it sits on; null for file-scoped rules
  reason: string // one-line templated explanation of why this fired

  status: FindingStatus // read-only in v1; backend-set, defaults to "open"

  /** Derived on this request under the active profile; the list arrives sorted by it. */
  priority: number
  /**
   * True when the critical-security floor is what keeps this row visible, rather
   * than its computed priority — so the UI can explain why it is still here at
   * the minimum security weight.
   */
  pinned_by_floor: boolean

  rule_id?: string | null // rule findings: which rule fired
  metric_value?: number | null // rule findings: measured value (e.g. CCN 18)
  threshold?: number | null // rule findings: the limit crossed (e.g. 15)
  comment_text?: string | null // SATD findings: the developer's own words, as evidence
  confidence?: number | null // SATD findings: model confidence in the category, 0–1
}

// ── Per-file scores: power the heat map + hotspot ranking ───────────────────

export interface FileScore {
  file: string
  /** Σ of the priorities of this file's open findings. Derived, never stored. */
  debt_score: number
  /**
   * Bug-proneness, 0–1 — a stored fact, not derived.
   *
   * Required but nullable, and the difference matters: `null` means never
   * assessed, `0.0` means measured and looks safe. Render `null` as "not
   * assessed", never as a zero-risk badge.
   */
  risk_score: number | null
}

// ── File-tree node: heat map now; per-node Card B scope later ───────────────

export interface TreeNode {
  path: string // "src/lib/api/client.ts"
  name: string // "client.ts"
  type: "file" | "folder"
  health_score: number // 0–100 → heat-map colour (folders = aggregate of children)
  grade: Grade
  debt_score: number
  risk_score?: number | null // 0–1; absent when ML was unreachable (degraded mode)
  children?: TreeNode[] | null // folders only
}

// ── Repo: 1 repo = 1 project in v1 ──────────────────────────────────────────

export interface Repo {
  id: string
  name: string
  owner: string
  visibility: "public" | "private" // recorded now; connecting a private repo is v2
  url: string
  default_branch: string
  connected_at: string // ISO
  latest_health?: LatestHealth | null // Projects-list hint
}

/** The health hint on a projects-list row. */
export interface LatestHealth {
  score: number
  grade: Grade
  delta: number
}

// ── Branch ──────────────────────────────────────────────────────────────────

export interface Branch {
  name: string
  is_default: boolean
  head_commit_sha?: string | null // full; UI shows short (first 7)
  head_commit_at?: string | null // ISO
}

// ── Scan lifecycle: drives the Scan button state machine ────────────────────

/**
 * `idle → queued → running → done | error | cancelled`.
 *
 * `cancelled` is a distinct terminal phase, never `idle`, so a stopped scan is
 * never mistaken for one that finished or one that never ran.
 */
export type ScanPhase =
  "idle" | "queued" | "running" | "done" | "error" | "cancelled"

export interface ScanStatus {
  scan_id: string
  phase: ScanPhase
  progress: number // 0–100 (meaningful when phase === "running")
  // All nullable in the contract, not merely absent: a queued scan has no
  // finished_at, and the API sends null rather than omitting the key.
  branch?: string | null
  commit_sha?: string | null // the commit this scan is analysing
  started_at?: string | null
  finished_at?: string | null
  error?: string | null // present only when phase === "error"
}

// ── ScanSummary: one immutable stored snapshot, row in the Scan-History tab ──

export interface ScanSummary {
  snapshot_id: string // the stored snapshot; what the dashboard reads
  scan_id: string // the attempt that produced it
  branch: string
  commit_sha: string
  scanned_at: string // ISO
  finding_count: number
  health_score: number
  grade: Grade
  delta: number
}

// ── Trend chart point (repo scope in v1; per-node later) ────────────────────

export interface HealthPoint {
  t: string // ISO timestamp of the scan/commit
  score: number
  commit_sha?: string | null
}

// ── Category pie slice (health card + category-breakdown view) ──────────────

export interface CategoryBreakdownItem {
  category: Category
  count: number // number of findings in this category
  debt: number // summed debt contribution (for a debt-weighted pie)
}

// ── Scoring profile ─────────────────────────────────────────────────────────

/** One weight per category — five numbers, each clamped to 0.1–3.0. */
export interface CategoryWeights {
  security: number
  code_design: number
  requirement: number
  documentation: number
  test: number
}

/**
 * The body of `PUT /api/profiles/active` — the complete profile, six numbers,
 * never a delta. That is what makes the write idempotent.
 */
export interface ApplyProfileRequest {
  name?: string | null // records which preset the values came from; omit for custom
  weights: CategoryWeights
  trust_s: number
}

/**
 * The server is the enforcement point — it clamps on write and returns what it
 * stored. These exist so the sliders cannot produce a value it would correct.
 */
export const WEIGHT_MIN = 0.1
export const WEIGHT_MAX = 3.0
export const TRUST_MIN = 0
export const TRUST_MAX = 1

export interface ScoreProfile {
  id: string
  name: string // "Balanced" | "Security-first" | "Delivery-speed" | a custom name
  weights: CategoryWeights
  /**
   * The trust slider `s`: `0` trusts the model, `1` trusts the rules. Scoring
   * derives `rule_trust = 0.5 + s` and `ml_trust = 1.5 − s`.
   *
   * Security is fixed at 1.0, so no position of this slider de-weights it.
   */
  trust_s: number
  is_preset: boolean // presets are read-only templates that seed the sliders
  is_active: boolean // at most one active profile per workspace (DB-enforced)
}

// ── HealthReport: the full dashboard payload for one branch snapshot ─────────

export interface HealthReport {
  snapshot_id: string
  repo_id: string
  branch: string
  commit_sha: string // last commit analysed (UI shows short)
  scanned_at: string // ISO
  health_score: number // 0–100
  grade: Grade
  delta: number // vs the previous snapshot
  red_issue_count: number // critical/high count for the health-card summary
  profile: string // active scoring profile name, labelled on the trend chart
  model_version?: string | null // which ML model produced this; null in degraded mode
  history: HealthPoint[] // trend chart (repo scope)
  tree: TreeNode[] // heat-map file tree
  file_scores: FileScore[]
  findings: Finding[] // Refactor-First list
  category_breakdown: CategoryBreakdownItem[] // the pie
}

// ── v2 — teams & roles. Seam only; not built in v1. ─────────────────────────

export type Role = "org-admin" | "manager" | "developer" | "viewer" // v2
export interface Member {
  user_id: string
  name: string
  role: Role
} // v2
export interface Workspace {
  id: string
  name: string
  members: Member[]
} // v2
