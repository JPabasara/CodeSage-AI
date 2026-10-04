// The data contract — the shapes that flow between the frontend, the mock API and the real backend.

import type { components } from "./api"

export type Severity = "critical" | "high" | "medium" | "low"

// Which detector produced the finding — orthogonal to `Category`, and exactly two values.
export type Source = "rule" | "satd"

/** What type of debt it is — orthogonal to `Source`. Matches the dataset labels. */
export type Category =
  | "code-design" // rule engine + SATD   (dataset label: "code/design")
  | "requirement" // SATD
  | "documentation" // SATD
  | "test" // SATD
  | "security"

// A snapshot-local workflow label.
export type FindingStatus =
  "open" | "done" | "accepted" | "resolved" | "false-positive"
export type FindingChangeStatus = "new" | "unchanged"

export type Grade = "A" | "B" | "C" | "D" | "E"

// The stable, machine-readable reason a request failed.
export type ErrorCode = components["schemas"]["ErrorCode"]

export interface ConnectRepoRequest {
  url: string // a PUBLIC repository URL
}

/** Every non-2xx response body. `code` is required, not decorative. */
export interface ApiError {
  detail: string // a human-readable sentence naming what failed
  code: ErrorCode
  languages?: string[] // REPOSITORY_HAS_NO_JAVA only: what GitHub did find
  errors?: { field: string; detail: string }[] // VALIDATION_FAILED only
}

export interface Session {
  user_id: string
  /** Null during onboarding. Workspace-bound calls then answer 409 WORKSPACE_REQUIRED. */
  workspace_id?: string | null
  needs_workspace_setup?: boolean
  product_tour_required?: boolean
  role?: Role | null
  permissions?: string[]
  email?: string | null
  name?: string | null
  avatar_url?: string | null
  identity_provider?: string | null
}

export interface Finding {
  fingerprint: string
  source: Source
  category: Category
  severity: Severity
  file: string
  source_scope?: "production" | "test" | "generated" | "example" | "unknown"
  line: number
  end_line?: number | null
  symbol?: string | null // the function/class it sits on; null for file-scoped rules
  reason: string // one-line templated explanation of why this fired

  status: FindingStatus // snapshot-local dashboard workflow; defaults to "open"
  change_status?: FindingChangeStatus // absent only in legacy/demo fixtures

  /** Derived on this request under the active profile; the list arrives sorted by it. */
  priority: number
  pinned_by_floor: boolean

  rule_id?: string | null // rule findings: which rule fired
  metric_value?: number | null // rule findings: measured value (e.g. CCN 18)
  threshold?: number | null // rule findings: the limit crossed (e.g. 15)
  comment_text?: string | null // SATD findings: the developer's own words, as evidence
  confidence?: number | null // SATD findings: model confidence in the category, 0–1
}

export interface FileScore {
  file: string
  /** Σ of the priorities of this file's open findings. Derived, never stored. */
  debt_score: number
  risk_score: number | null
}

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

export interface Branch {
  name: string
  is_default: boolean
  head_commit_sha?: string | null // full; UI shows short (first 7)
  head_commit_at?: string | null // ISO
}

export type ScanPhase =
  "idle" | "queued" | "running" | "done" | "error" | "cancelled"

// Why a scan ended in `error`, when the reason is one the user can act on.
export type ScanErrorCode = components["schemas"]["ScanErrorCode"]

export type ScanStage = components["schemas"]["ScanStage"]

/** Work in progress in the active workspace (`GET /api/activity`). */
export type Activity = components["schemas"]["Activity"]
export type ActiveScan = components["schemas"]["ActiveScan"]
export type Rescoring = components["schemas"]["Rescoring"]

export interface ScanStatus {
  scan_id: string
  phase: ScanPhase
  progress: number
  branch?: string | null
  commit_sha?: string | null // the commit this scan is analysing
  started_at?: string | null
  finished_at?: string | null
  error?: string | null
  error_code?: ScanErrorCode | null // ditto; the message is chosen by this
  stage?: ScanStage | null
  files_done?: number | null // Java files read so far (reading_code only)
  files_total?: number | null
  typical_seconds?: number | null // this repository's usual scan length
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

export interface HealthPoint {
  t: string // ISO timestamp of the scan/commit
  score: number
  commit_sha?: string | null
}

export interface CategoryBreakdownItem {
  category: Category
  count: number // number of findings in this category
  debt: number // summed debt contribution (for a debt-weighted pie)
}

/** One weight per category — five numbers, each clamped to 0.1–3.0. */
export interface CategoryWeights {
  security: number
  code_design: number
  requirement: number
  documentation: number
  test: number
}

// The body of `PUT /api/profiles/active` — the complete profile, six numbers, never a delta.
export interface ApplyProfileRequest {
  name?: string | null // records which preset the values came from; omit for custom
  weights: CategoryWeights
  trust_s: number
}

// The server is the enforcement point — it clamps on write and returns what it stored.
export const WEIGHT_MIN = 0.1
export const WEIGHT_MAX = 3.0
export const TRUST_MIN = 0
export const TRUST_MAX = 1

export interface ScoreProfile {
  id: string
  name: string
  weights: CategoryWeights
  // The trust slider `s`: `0` trusts the model, `1` trusts the rules.
  trust_s: number
  include_test_findings?: boolean
  is_preset: boolean // built-ins are read-only templates that seed the sliders
  is_active: boolean
  // Projects that name this profile explicitly.
  usage_count: number
  editable: boolean
}

// A workspace holds at most five custom profiles.
export const MAX_CUSTOM_PROFILES = 5

export type CreateProfileRequest = components["schemas"]["CreateProfileRequest"]

export type UpdateProfileRequest = components["schemas"]["UpdateProfileRequest"]

// The body of both PUTs that choose a profile — the workspace default and a project override.
export type SelectProfileRequest = components["schemas"]["SelectProfileRequest"]

export interface ProjectProfile {
  repo_id: string
  inherited: boolean // true when this project has no override of its own
  effective: ScoreProfile // the override, else the workspace default
  workspace_default: ScoreProfile
  override: ScoreProfile | null // null exactly when `inherited` is true
}

// Repository-persisted source classification rules.
export interface SourceScopeConfig {
  test_path_patterns: string[]
  production_path_overrides: string[]
}

export interface FindingPage {
  items: Finding[]
  total: number
  limit: number
  offset: number
}

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
  resolved_finding_count?: number // findings present previously but absent now
  profile: string // active scoring profile name, labelled on the trend chart
  include_test_findings?: boolean
  model_version?: string | null // which ML model produced this; null in degraded mode
  history: HealthPoint[] // trend chart (repo scope)
  tree: TreeNode[] // heat-map file tree
  file_scores: FileScore[]
  findings: Finding[] // Refactor-First list
  category_breakdown: CategoryBreakdownItem[] // the pie
}

/** Who someone is in a workspace. Grants come from the permission matrix. */
export type Role = components["schemas"]["Role"]

export type Workspace = components["schemas"]["WorkspaceSummary"]

// The body of `POST /api/auth/workspaces`.
export type CreateWorkspaceRequest =
  components["schemas"]["CreateWorkspaceRequest"]

// The body of `PATCH /api/auth/workspaces/{id}` — only what changed.
export type UpdateWorkspaceRequest =
  components["schemas"]["UpdateWorkspaceRequest"]

/** Exact-name confirmation sent before permanently deleting a workspace. */
export type DeleteWorkspaceRequest =
  components["schemas"]["DeleteWorkspaceRequest"]

export type Member = components["schemas"]["Member"]

export type Invitation = components["schemas"]["Invitation"]

export type MemberList = components["schemas"]["MemberList"]

/** The body of `POST /api/invitations`. The role is stored on the invitation. */
export type CreateInvitationRequest =
  components["schemas"]["CreateInvitationRequest"]

export type CreatedInvitation = components["schemas"]["CreatedInvitation"]

export type AcceptedInvitation = components["schemas"]["AcceptedInvitation"]
