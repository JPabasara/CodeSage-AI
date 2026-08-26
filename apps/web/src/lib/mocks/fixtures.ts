// ────────────────────────────────────────────────────────────────────────────
// SAMPLE DATA, SHAPED BY THE CONTRACT
//
// Everything exported here is a valid `docs/api/openapi.yaml` payload — the same
// bytes the real FastAPI backend will send. Component tests import these
// directly; `handlers.ts` serves them (and re-derives them per profile) over MSW.
//
// Two rules keep this file honest:
//
//  1. IDs THAT THE CONTRACT TYPES AS `format: uuid` ARE REAL UUIDs. Slugs like
//     "demo-repo" used to sit here, and they hid a whole class of bug: URL
//     building, id comparison and routing all behave differently for an opaque
//     36-character string than for a friendly word.
//
//  2. NO SCORE IS HAND-WRITTEN. `health_score`, `grade`, `delta`, every
//     `priority`, every `debt_score` and the whole trend are produced by
//     `scoring.ts` under the **Balanced** profile, because the contract says
//     they are derived on read and never stored (FR-21). Typing a priority here
//     would be inventing a number the backend would immediately contradict.
// ────────────────────────────────────────────────────────────────────────────
import type {
  Branch,
  CategoryBreakdownItem,
  Finding,
  HealthPoint,
  HealthReport,
  Repo,
  ScanSummary,
  ScoreProfile,
  Session,
  TreeNode,
} from "@/lib/types"
import { DEMO_REPO_ID } from "@/lib/demo"
import { buildHealthReport, scanHistoryFor, SNAPSHOTS } from "./scoring"

export { DEMO_REPO_ID }

// ── identifiers ─────────────────────────────────────────────────────────────

// DEMO_REPO_ID is defined in `@/lib/demo` and re-exported above: the app rail
// needs it and must not import the mocks. One constant, two consumers.
export const SECOND_REPO_ID = "b4f0a9d2-3c81-4e57-9f26-1d5a8b7c0e34"
/** Connected but never scanned — the projects list must say so, not show a zero. */
export const UNSCANNED_REPO_ID = "e3a1c58f-2b64-4d09-8a17-5c0f9e2d6b48"

/**
 * How much debt each repository carries, relative to the demo one. A mock needs
 * *some* per-repo variation or every project shows the same score; this is the
 * one knob that produces it, and it is mock-only — no contract field.
 */
export const REPO_DEBT_SCALE: Record<string, number> = {
  [DEMO_REPO_ID]: 1.0,
  [SECOND_REPO_ID]: 1.7,
}

/** A non-default branch carries more debt than the trunk. Also mock-only. */
export const FEATURE_BRANCH_DEBT_SCALE = 1.2

// ── auth ────────────────────────────────────────────────────────────────────

/**
 * Only `user_id` and `workspace_id` are guaranteed by the contract; the rest is
 * display detail an identity provider may simply not have. `mockSessionMinimal`
 * exists so the "no name, no email, no avatar" fallback is a path something
 * actually exercises rather than a branch nobody has ever rendered.
 */
export const mockSession: Session = {
  user_id: "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  workspace_id: "1e2f3a4b-5c6d-4e7f-8091-a2b3c4d5e6f7",
  email: "janidu@example.com",
  name: "Janidu Pabasara",
  avatar_url: "https://avatars.githubusercontent.com/u/1024?v=4",
  identity_provider: "github",
}

export const mockSessionMinimal: Session = {
  user_id: "2c4a6e80-1b3d-4f57-9a80-c1d2e3f4a5b6",
  workspace_id: "1e2f3a4b-5c6d-4e7f-8091-a2b3c4d5e6f7",
}

// ── branches ────────────────────────────────────────────────────────────────

export const mockBranches: Branch[] = [
  {
    name: "main",
    is_default: true,
    head_commit_sha: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
    head_commit_at: "2026-07-22T18:30:00.000Z",
  },
  {
    name: "develop",
    is_default: false,
    head_commit_sha: "b2c3d4e5f60718293a4b5c6d7e8f90123456789a",
    head_commit_at: "2026-07-21T11:05:00.000Z",
  },
  {
    // Both nullable fields exercised: a branch GitHub has not given us a head
    // commit for. The top nav must not print "null" or crash on the substring.
    name: "release/2026.08",
    is_default: false,
    head_commit_sha: null,
    head_commit_at: null,
  },
]

// ── profiles ────────────────────────────────────────────────────────────────

export const mockProfiles: ScoreProfile[] = [
  {
    id: "5f2b8c14-9d63-4a07-b1e8-3c4d5e6f7a80",
    name: "Balanced",
    weights: {
      security: 1.0,
      code_design: 1.0,
      requirement: 1.0,
      documentation: 1.0,
      test: 1.0,
    },
    trust_s: 0.5,
    is_preset: true,
    is_active: true, // Balanced is seeded active for every new workspace
  },
  {
    id: "6a3c9d25-0e74-4b18-c2f9-4d5e6f7a8b91",
    name: "Security-first",
    weights: {
      security: 3.0,
      code_design: 1.0,
      requirement: 0.8,
      documentation: 0.5,
      test: 1.0,
    },
    trust_s: 0.5,
    is_preset: true,
    is_active: false,
  },
  {
    id: "7b4d0e36-1f85-4c29-d30a-5e6f7a8b9c02",
    name: "Delivery-speed",
    weights: {
      security: 1.5,
      code_design: 1.2,
      requirement: 0.8,
      documentation: 0.5,
      test: 0.5,
    },
    trust_s: 0.7,
    is_preset: true,
    is_active: false,
  },
]

/** The workspace default. Every fixture below is scored under this. */
export const balancedProfile =
  mockProfiles.find((p) => p.is_active) ?? mockProfiles[0]

// ── the dashboard payload ───────────────────────────────────────────────────

/**
 * The report for one repo + branch, under Balanced. `handlers.ts` calls the same
 * builder with the *live* active profile, which is what makes applying a profile
 * visibly re-rank the Refactor-First list.
 */
export function reportFor(
  repoId: string,
  branch: string,
  isDefaultBranch: boolean,
  profile: ScoreProfile = balancedProfile,
  snapshotId?: string,
): HealthReport {
  const branchInfo = mockBranches.find((b) => b.name === branch)
  return buildHealthReport({
    repoId,
    branch,
    commitSha:
      branchInfo?.head_commit_sha ?? SNAPSHOTS[SNAPSHOTS.length - 1].commit_sha,
    debtScale:
      (REPO_DEBT_SCALE[repoId] ?? 1) *
      (isDefaultBranch ? 1 : FEATURE_BRANCH_DEBT_SCALE),
    profile,
    snapshotId,
  })
}

// ── projects ────────────────────────────────────────────────────────────────

/**
 * `latest_health` is a DERIVED hint, so it is computed rather than typed — and
 * it is **absent** on `octo-cli`, which has never been scanned. Absent is not
 * the same as a score of zero, and the projects list renders the two
 * differently ("Not scanned yet" versus a grade).
 */
function latestHealthFor(repoId: string) {
  const report = reportFor(repoId, "main", true)
  return {
    score: report.health_score,
    grade: report.grade,
    delta: report.delta,
  }
}

export const mockRepos: Repo[] = [
  {
    id: DEMO_REPO_ID,
    name: "acme-payments",
    owner: "acme",
    visibility: "public",
    url: "https://github.com/acme/acme-payments",
    default_branch: "main",
    connected_at: "2026-07-10T09:00:00.000Z",
    latest_health: latestHealthFor(DEMO_REPO_ID),
  },
  {
    id: SECOND_REPO_ID,
    name: "web-store",
    owner: "acme",
    visibility: "public",
    url: "https://github.com/acme/web-store",
    default_branch: "main",
    connected_at: "2026-07-12T14:20:00.000Z",
    latest_health: latestHealthFor(SECOND_REPO_ID),
  },
  {
    id: UNSCANNED_REPO_ID,
    name: "octo-cli",
    owner: "acme",
    // Private repositories cannot be CONNECTED in v1.0, but visibility is
    // recorded and displayed from v1.0 (FR-3) — so the badge needs a private row
    // to render at least once.
    visibility: "private",
    url: "https://github.com/acme/octo-cli",
    default_branch: "trunk",
    connected_at: "2026-08-19T07:45:00.000Z",
    // no latest_health: connected, never successfully scanned
  },
]

/** acme-payments @ main, under Balanced — what the demo dashboard shows. */
export const mockHealthReport: HealthReport = reportFor(
  DEMO_REPO_ID,
  "main",
  true,
)

// Convenience re-exports, so a component test can grab exactly the slice it
// needs without reaching into the report and without a second source of truth.
export const mockFindings: Finding[] = mockHealthReport.findings
export const mockTree: TreeNode[] = mockHealthReport.tree
export const mockHistory: HealthPoint[] = mockHealthReport.history
export const mockCategoryBreakdown: CategoryBreakdownItem[] =
  mockHealthReport.category_breakdown

export const mockScanHistory: ScanSummary[] = scanHistoryFor(
  balancedProfile,
  "main",
  1,
)
