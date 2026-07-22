// ────────────────────────────────────────────────────────────────────────────
// Code Sage AI — THE DATA CONTRACT
// Single source of truth for the shapes that flow between the frontend, the mock
// API (MSW), and the real FastAPI backend. Everyone imports from `@/lib/types`.
//
// Scope: v1.0. Fields for later releases are marked  // v1.1  or  // v2  and kept
// optional so neither the mock nor the backend is forced to fill them in v1.
// See docs: release-roadmap.md · code-sage_backend-analysis-engine.md (§4 source
// vs category, §6 scoring, §7 outputs).
//
// ⚠️ Canonical enum values (Severity / Category / Grade) must equal what the
// backend emits. In particular `Category` must equal the SATD dataset labels
// (backend §3.2) — confirm against the CSV before freezing (roadmap D5).
// ────────────────────────────────────────────────────────────────────────────

// ── enums ───────────────────────────────────────────────────────────────────

export type Severity = "critical" | "high" | "medium" | "low";

/** WHICH DETECTOR produced the finding (orthogonal to `Category`). */
export type Source = "rule" | "satd" | "security" | "ml-risk";

/** WHAT TYPE of debt it is (orthogonal to `Source`). Must equal SATD dataset labels. */
export type Category =
  | "code-design" // rule engine + SATD   (dataset label: "code/design")
  | "requirement" // SATD
  | "documentation" // SATD
  | "test" // SATD
  | "security"; // rule engine (security patterns: secrets, SQL concat, eval/exec)

  //v.1.1 adds these new statuses to the finding lifecycle. They are user-settable, and affect the scoring and the Refactor-First list.
export type FindingStatus =
  | "open"
  | "acknowledged" // v1.1
  | "accepted" // v1.1  (suppressed from the score)
  | "resolved" // v1.1
  | "false-positive"; // v1.1

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
  symbol: string; // the function/class the finding sits on
  reason: string; // one-line TEMPLATE explanation — the anti-noise differentiator (§8)

  status: FindingStatus; // v1: read-only, backend-set (default "open"); user actions are v1.1

  priority?: number; // computed sort key: base × category_weight × churn_factor (§6)
  ruleId?: string; // rule findings: which rule fired
  metricValue?: number; // rule findings: measured value (e.g. CCN 18) — feeds reason + evidence
  threshold?: number; // rule findings: the limit crossed (e.g. 15)
  snippet?: string; // v1.1: offending code snippet, loaded on demand
}

// ── Per-file scores: power the heat map + hotspot ranking ───────────────────

export interface FileScore {
  file: string;
  debtScore: number; // Σ finding priorities (+ ml term); higher = worse
  riskScore: number; // ML-2 bug-proneness, 0–1 (badge + tree tint + ranking boost)
}

// ── File-tree node: heat map now; per-node Card B scope later ───────────────

export interface TreeNode {
  path: string; // "src/lib/api/client.ts"
  name: string; // "client.ts"
  type: "file" | "folder";
  healthScore: number; // 0–100 → heat-map colour (folders = aggregate of children)
  grade: Grade;
  debtScore: number;
  riskScore: number; // 0–1
  children?: TreeNode[]; // folders only
}

// ── Repo: 1 repo = 1 project in v1 ──────────────────────────────────────────

export interface Repo {
  id: string;
  name: string;
  owner: string;
  visibility: "public" | "private"; // v1: public only; private = v1.1 (GitHub App)
  url: string;
  source: "public-url" | "github"; // how it was connected
  defaultBranch: string;
  connectedAt: string; // ISO
  workspaceId?: string; // multi-tenant seam — v2 uses it; v1 = one workspace
  latestHealth?: { score: number; grade: Grade; delta: number }; // Projects-list hint
}

// ── Branch ──────────────────────────────────────────────────────────────────

export interface Branch {
  name: string;
  isDefault: boolean;
  lastCommitSha: string; // full; UI shows short (first 7)
  lastCommitAt: string; // ISO
}

// ── Scan lifecycle: drives the Scan button state machine ────────────────────

export type ScanPhase = "idle" | "queued" | "running" | "done" | "error";

export interface ScanStatus {
  scanId: string;
  phase: ScanPhase;
  progress: number; // 0–100 (meaningful when phase === "running")
  branch?: string;
  commitSha?: string; // the commit this scan is analysing
  startedAt?: string;
  finishedAt?: string;
  error?: string;
}

// ── ScanSummary: one immutable stored snapshot, row in the Scan-History tab ──

export interface ScanSummary {
  scanId: string;
  branch: string;
  commitSha: string;
  scannedAt: string; // ISO
  healthScore: number;
  grade: Grade;
  delta: number;
  findingCount: number;
}

// ── Trend chart point (repo scope in v1; per-node later) ────────────────────

export interface HealthPoint {
  t: string; // ISO timestamp of the scan/commit
  score: number;
  commitSha?: string;
}

// ── Category pie slice (health card + category-breakdown view) ──────────────

export interface CategoryBreakdownItem {
  category: Category;
  count: number; // number of findings in this category
  debt: number; // summed debt contribution (for a debt-weighted pie)
}

// ── Scoring profile (v1: select a preset; v1.1: custom sliders) ─────────────

export interface ScoreProfile {
  id: string;
  name: string; // "Balanced" | "Security-first" | "Delivery-speed" | a custom name
  weights: {
    security: number;
    codeDesign: number;
    satd: number;
    duplication: number;
  };
  wMl: number; // weight of the ML risk term
  isPreset: boolean;
}

// ── HealthReport: the full dashboard payload for one branch snapshot ─────────

export interface HealthReport {
  scanId: string;
  repoId: string;
  branch: string;
  commitSha: string; // last commit analysed (UI shows short)
  scannedAt: string; // ISO
  healthScore: number; // 0–100
  grade: Grade;
  delta: number; // vs the previous snapshot
  profile: string; // active scoring profile name
  redIssueCount: number; // critical/high count for the health-card summary
  history: HealthPoint[]; // trend chart (repo scope)
  tree: TreeNode[]; // heat-map file tree
  fileScores: FileScore[];
  findings: Finding[]; // Refactor-First list
  categoryBreakdown: CategoryBreakdownItem[]; // the pie
}

// ── v2 — teams & RBAC. Seam only; NOT built in v1 (see roadmap). ────────────

export type Role = "org-admin" | "manager" | "developer" | "viewer"; // v2
export interface Member {
  userId: string;
  name: string;
  role: Role;
} // v2
export interface Workspace {
  id: string;
  name: string;
  members: Member[];
} // v2
