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

import type { components } from "./api"

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
export type ErrorCode = components["schemas"]["ErrorCode"]

/** The body of `POST /api/projects`. */
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

// ── Session: who is signed in (GET /api/auth/session) ───────────────────────

/**
 * Only `user_id` is guaranteed. `workspace_id` is null for someone who has
 * signed in but has no workspace yet — a real authenticated state, not a
 * failure. Everything below the identifiers comes from the identity provider
 * and may be absent — render a fallback, never assume.
 */
export interface Session {
  user_id: string
  /** Null during onboarding. Workspace-bound calls then answer 409 WORKSPACE_REQUIRED. */
  workspace_id?: string | null
  /** True when the user must create or join a workspace before the app is usable. */
  needs_workspace_setup?: boolean
  role?: Role | null
  /**
   * What this caller may do in the active workspace, so the UI can hide controls
   * it would be refused anyway. A convenience, never the boundary — the API
   * re-checks every permission on every request.
   */
  permissions?: string[]
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

/**
 * Why a scan ended in `error`, when the reason is one the user can act on.
 * Absent for an unexpected failure, where `error` alone explains it.
 */
export type ScanErrorCode = components["schemas"]["ScanErrorCode"]

/**
 * Which pipeline stage a running scan is in (13H.4). Each owns a band of the
 * progress bar — see `STAGE_BANDS` in `lib/scan-progress`.
 */
export type ScanStage = components["schemas"]["ScanStage"]

/** Work in progress in the active workspace (`GET /api/activity`). */
export type Activity = components["schemas"]["Activity"]
export type ActiveScan = components["schemas"]["ActiveScan"]
export type Rescoring = components["schemas"]["Rescoring"]

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
  error_code?: ScanErrorCode | null // ditto; the message is chosen by this
  // 13H.4, only while running and all optional: an older API sends none.
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
  is_preset: boolean // built-ins are read-only templates that seed the sliders
  /**
   * Whether this is the **workspace default** — what every project without an
   * explicit override is scored with. One row per workspace holds that pointer,
   * keyed by workspace id, so "exactly one default" is the shape of the table.
   */
  is_active: boolean
  /**
   * Projects that name this profile explicitly. The default is additionally in
   * force for every project *without* an override, which `is_active` already
   * says, so those are not counted here.
   */
  usage_count: number
  editable: boolean // false for the three built-ins, which the database refuses to change
}

/**
 * A workspace holds at most five custom profiles. The three built-ins do not
 * count toward it, which is why this is a limit on the custom ones alone.
 *
 * The server is the enforcement point — it refuses the sixth with
 * `PROFILE_LIMIT_REACHED`, transaction-safely. This constant only lets the UI
 * say "4 of 5" and stop offering a create it knows would be refused.
 */
export const MAX_CUSTOM_PROFILES = 5

/**
 * The body of `POST /api/profiles`. `name` is required, unlike on the legacy
 * apply endpoint: a profile that joins a pool has to be tellable apart from the
 * other five.
 */
export type CreateProfileRequest = components["schemas"]["CreateProfileRequest"]

/**
 * The body of `PATCH /api/profiles/{profile_id}` — only what changed. An omitted
 * field keeps its stored value, which is what makes this safe to send from a
 * form that tracks edits rather than the whole profile.
 */
export type UpdateProfileRequest = components["schemas"]["UpdateProfileRequest"]

/**
 * The body of both PUTs that choose a profile — the workspace default and a
 * project override. It carries the whole selection, never a delta, so re-sending
 * it changes nothing.
 */
export type SelectProfileRequest = components["schemas"]["SelectProfileRequest"]

/** Which profile one project is scored with, and where that came from. */
export interface ProjectProfile {
  repo_id: string
  inherited: boolean // true when this project has no override of its own
  effective: ScoreProfile // the override, else the workspace default
  workspace_default: ScoreProfile
  override: ScoreProfile | null // null exactly when `inherited` is true
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

// ── workspaces, members & roles ──────────────────────────
//
// These five are aliases of the generated schemas rather than re-declarations.
// They were handwritten once, as a v1 sketch of a v2 feature, and by the time
// the endpoints shipped the sketch was wrong in ways nothing caught: the
// workspace had an `id` where the wire says `workspace_id`, and it carried its
// members inline, which no response has ever done. Nothing imported them, so
// nothing failed — the types simply sat there waiting to mislead whoever built
// the screens.
//
// Aliasing removes that failure mode entirely. There is one definition, it is
// generated from the contract, and it cannot drift.

/** Who someone is in a workspace. Grants come from the permission matrix. */
export type Role = components["schemas"]["Role"]

/**
 * One workspace as the switcher and the Workspace screen need it.
 *
 * `project_count` and `member_count` are derived by the API on read, not stored,
 * so they are always current. `is_active` marks the one this session is bound
 * to — exactly one at most, and none at all during onboarding.
 */
export type Workspace = components["schemas"]["WorkspaceSummary"]

/**
 * The body of `POST /api/auth/workspaces`. Only the name is required — a
 * workspace is identified by what the team calls it, and the rest is decoration
 * the Workspace screen can fill in later.
 */
export type CreateWorkspaceRequest =
  components["schemas"]["CreateWorkspaceRequest"]

/**
 * The body of `PATCH /api/auth/workspaces/{id}` — only what changed.
 *
 * Omitting `description` leaves it alone; sending `null` clears it. Those are
 * different intentions and the contract keeps them different, so the form has to
 * as well.
 */
export type UpdateWorkspaceRequest =
  components["schemas"]["UpdateWorkspaceRequest"]

/** An existing member. `status` distinguishes active from deactivated. */
export type Member = components["schemas"]["Member"]

/** An invitation that has been sent but not yet accepted. */
export type Invitation = components["schemas"]["Invitation"]

/** What `GET /api/members` returns: both lists, in one response. */
export type MemberList = components["schemas"]["MemberList"]

/** The body of `POST /api/invitations`. The role is stored on the invitation. */
export type CreateInvitationRequest =
  components["schemas"]["CreateInvitationRequest"]

/** A new invitation, plus the one-time link the email carries — for copying. */
export type CreatedInvitation = components["schemas"]["CreatedInvitation"]

/** What accepting an invitation activates: a membership, in one workspace. */
export type AcceptedInvitation = components["schemas"]["AcceptedInvitation"]
