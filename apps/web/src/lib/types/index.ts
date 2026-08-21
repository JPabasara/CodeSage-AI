// ────────────────────────────────────────────────────────────────────────────
// Code Sage AI — THE DATA CONTRACT
// Single source of truth for the shapes that flow between the frontend, the mock
// API (MSW), and the real FastAPI backend. Everyone imports from `@/lib/types`.
//
// THESE SHAPES MATCH `docs/api/openapi.yaml` EXACTLY (J2.2) — field names,
// required/optional, and nullability. The generated `./api.ts` is the authority;
// when the two disagree, api.ts wins and this file is wrong.
//
// Two consequences worth knowing before you edit:
//   * snake_case is the name ON THE WIRE. Do not "tidy" a field to camelCase.
//   * `?: T | null` means the backend may omit it OR send null. Both happen, and
//     they mean the same thing to the UI: render the fallback.
//
// React component props are a separate, internal API and stay camelCase.
//
// See docs: release-roadmap.md · code-sage_backend-analysis-engine.md (§4 source
// vs category, §6 scoring, §7 outputs).
// ────────────────────────────────────────────────────────────────────────────

// ── enums ───────────────────────────────────────────────────────────────────

/**
 * HOW BAD the finding is. Assigned by the DETECTOR at scan time and stored on the
 * row — never computed here. Rules carry a fixed severity (see the rule register,
 * SRS Appendix C); SATD findings default to "medium" (ML-1 predicts `category`
 * only); the risk model produces no Finding at all. The client's only job is to
 * map this string to a colour token (`severityColor`). SRS FR-8.1.
 */
export type Severity = "critical" | "high" | "medium" | "low";

/**
 * WHICH DETECTOR produced the finding (orthogonal to `Category`). **Exactly two
 * values** (FR-8.2).
 *
 * There is no `security` source: security patterns run inside the rule engine, so
 * a security finding is a `rule` finding whose `category` is `security`. There is
 * no `ml-risk` source either — the risk model scores files, it never emits a
 * Finding (see `FileScore.risk_score`).
 */
export type Source = "rule" | "satd";

/** WHAT TYPE of debt it is (orthogonal to `Source`). Must equal SATD dataset labels. */
export type Category =
  | "code-design" // rule engine + SATD   (dataset label: "code/design")
  | "requirement" // SATD
  | "documentation" // SATD
  | "test" // SATD
  | "security"; // rule engine (security patterns: secrets, SQL concat, eval/exec)

/**
 * v1.0 is view-only: every finding is `open`. The later values exist now because
 * FR-11 sums *open* finding priorities — the filter needs something to filter on.
 * The v1.1 accept / resolve / false-positive actions will set them.
 */
export type FindingStatus = "open" | "accepted" | "resolved" | "false-positive";

//A to E grades are used to indicate the overall health of a repo or file. A is the best, E is the worst.
export type Grade = "A" | "B" | "C" | "D" | "E";

// ── Finding: one row in the Refactor-First list ─────────────────────────────

export interface Finding {
  fingerprint: string; // stable id across scans (deduplication + track a finding over time)
  source: Source;
  category: Category;
  severity: Severity;
  file: string;
  line: number;
  symbol?: string | null; // the function/class it sits on; null for file-scoped rules
  reason: string; // one-line TEMPLATE explanation — the anti-noise differentiator (§8)

  status: FindingStatus; // v1: read-only, backend-set (default "open"); user actions are v1.1

  /** Derived on this request under the active profile; the list arrives sorted by it. */
  priority: number;
  /**
   * True when the critical-security visibility floor (FR-24) is what keeps this row
   * visible, rather than its computed priority. Lets the UI explain why a finding is
   * present even at the minimum `security` weight of 0.1.
   */
  pinned_by_floor: boolean;

  rule_id?: string | null; // rule findings: which rule fired
  metric_value?: number | null; // rule findings: measured value (e.g. CCN 18)
  threshold?: number | null; // rule findings: the limit crossed (e.g. 15)
  comment_text?: string | null; // SATD findings: the developer's own words, as evidence
  confidence?: number | null; // SATD findings: ML-1's confidence in the category, 0–1
}

// ── Per-file scores: power the heat map + hotspot ranking ───────────────────

export interface FileScore {
  file: string;
  debt_score: number; // Σ finding priorities (+ ml term); higher = worse
  risk_score: number; // ML-2 bug-proneness, 0–1 (badge + tree tint + ranking boost)
}

// ── File-tree node: heat map now; per-node Card B scope later ───────────────

export interface TreeNode {
  path: string; // "src/lib/api/client.ts"
  name: string; // "client.ts"
  type: "file" | "folder";
  health_score: number; // 0–100 → heat-map colour (folders = aggregate of children)
  grade: Grade;
  debt_score: number;
  risk_score?: number | null; // 0–1; absent when ML was unreachable (degraded mode)
  children?: TreeNode[] | null; // folders only
}

// ── Repo: 1 repo = 1 project in v1 ──────────────────────────────────────────

export interface Repo {
  id: string;
  name: string;
  owner: string;
  visibility: "public" | "private"; // v1: public only; private = v1.1 (GitHub App)
  url: string;
  default_branch: string;
  connected_at: string; // ISO
  latest_health?: LatestHealth | null; // Projects-list hint
}

/** The health hint on a projects-list row. */
export interface LatestHealth {
  score: number;
  grade: Grade;
  delta: number;
}

// ── Branch ──────────────────────────────────────────────────────────────────

export interface Branch {
  name: string;
  is_default: boolean;
  head_commit_sha?: string | null; // full; UI shows short (first 7)
  head_commit_at?: string | null; // ISO
}

// ── Scan lifecycle: drives the Scan button state machine ────────────────────

export type ScanPhase = "idle" | "queued" | "running" | "done" | "error";

export interface ScanStatus {
  scan_id: string;
  phase: ScanPhase;
  progress: number; // 0–100 (meaningful when phase === "running")
  branch?: string;
  commit_sha?: string; // the commit this scan is analysing
  started_at?: string;
  finished_at?: string;
  error?: string;
}

// ── ScanSummary: one immutable stored snapshot, row in the Scan-History tab ──

export interface ScanSummary {
  snapshot_id: string; // the stored snapshot; what the dashboard reads
  scan_id: string; // the attempt that produced it
  branch: string;
  commit_sha: string;
  scanned_at: string; // ISO
  finding_count: number;
  health_score: number;
  grade: Grade;
  delta: number;
}

// ── Trend chart point (repo scope in v1; per-node later) ────────────────────

export interface HealthPoint {
  t: string; // ISO timestamp of the scan/commit
  score: number;
  commit_sha?: string;
}

// ── Category pie slice (health card + category-breakdown view) ──────────────

export interface CategoryBreakdownItem {
  category: Category;
  count: number; // number of findings in this category
  debt: number; // summed debt contribution (for a debt-weighted pie)
}

// ── Scoring profile ─────────────────────────────────────────────────────────

/** One weight per category — five numbers, each clamped to 0.1–3.0. */
export interface CategoryWeights {
  security: number;
  code_design: number;
  requirement: number;
  documentation: number;
  test: number;
}

export interface ScoreProfile {
  id: string;
  name: string; // "Balanced" | "Security-first" | "Delivery-speed" | a custom name
  weights: CategoryWeights;
  /**
   * The trust slider `s`. `0` = trust the model, `1` = trust the rules. Scoring
   * derives `rule_trust = 0.5 + s` and `ml_trust = 1.5 − s` from it (FR-11).
   *
   * Security findings are excluded: `source_trust` is fixed at 1.0 for the
   * `security` category, so no position of this slider can de-weight them.
   */
  trust_s: number;
  is_preset: boolean; // presets are read-only templates that seed the sliders
  is_active: boolean; // at most one active profile per workspace (DB-enforced)
}

// ── HealthReport: the full dashboard payload for one branch snapshot ─────────

export interface HealthReport {
  snapshot_id: string;
  repo_id: string;
  branch: string;
  commit_sha: string; // last commit analysed (UI shows short)
  scanned_at: string; // ISO
  health_score: number; // 0–100
  grade: Grade;
  delta: number; // vs the previous snapshot
  red_issue_count: number; // critical/high count for the health-card summary
  profile: string; // active scoring profile name, labelled on the trend chart
  model_version?: string | null; // which ML model produced this; null in degraded mode
  history: HealthPoint[]; // trend chart (repo scope)
  tree: TreeNode[]; // heat-map file tree
  file_scores: FileScore[];
  findings: Finding[]; // Refactor-First list
  category_breakdown: CategoryBreakdownItem[]; // the pie
}

// ── v2 — teams & RBAC. Seam only; NOT built in v1 (see roadmap). ────────────

export type Role = "org-admin" | "manager" | "developer" | "viewer"; // v2
export interface Member {
  user_id: string;
  name: string;
  role: Role;
} // v2
export interface Workspace {
  id: string;
  name: string;
  members: Member[];
} // v2
