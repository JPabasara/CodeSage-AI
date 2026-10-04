// Sample data, shaped by the contract.
import type {
  Branch,
  CategoryBreakdownItem,
  Finding,
  HealthPoint,
  HealthReport,
  Invitation,
  Member,
  Repo,
  Role,
  ScanSummary,
  ScoreProfile,
  Session,
  TreeNode,
  Workspace,
} from "@/lib/types"
import { DEMO_REPO_ID } from "@/lib/demo"
import { buildHealthReport, scanHistoryFor, SNAPSHOTS } from "./scoring"

export { DEMO_REPO_ID }

export const SECOND_REPO_ID = "b4f0a9d2-3c81-4e57-9f26-1d5a8b7c0e34"
/** Connected but never scanned — the projects list must say so, not show a zero. */
export const UNSCANNED_REPO_ID = "e3a1c58f-2b64-4d09-8a17-5c0f9e2d6b48"
export const NIMBUS_REPO_ID = "c5a2f8e1-7d43-4b96-8e0f-1a2b3c4d5e6f"

export const REPO_DEBT_SCALE: Record<string, number> = {
  [DEMO_REPO_ID]: 1.0,
  [SECOND_REPO_ID]: 1.7,
  [NIMBUS_REPO_ID]: 1.4,
}

/** A non-default branch carries more debt than the trunk. Also mock-only. */
export const FEATURE_BRANCH_DEBT_SCALE = 1.2

export const WORKSPACE_ID = "1e2f3a4b-5c6d-4e7f-8091-a2b3c4d5e6f7"

// A second workspace, with a different role and a different repository.
export const SECOND_WORKSPACE_ID = "2f3a4b5c-6d7e-4f80-91a2-b3c4d5e6f708"

// The role-permission matrix, copied from the migration that seeds it.
export const PERMISSIONS_BY_ROLE: Record<Role, string[]> = {
  "org-admin": [
    "project:read",
    "repository:read",
    "repository:connect",
    "repository:disconnect",
    "scan:start",
    "scan:cancel_own",
    "scan:cancel_any",
    "result:read",
    "history:read",
    "finding:triage",
    "profile:read",
    "profile:update",
    "member:read",
    "member:manage",
    "workspace:update",
    "workspace:delete",
  ],
  manager: [
    "project:read",
    "repository:read",
    "repository:connect",
    "repository:disconnect",
    "scan:start",
    "scan:cancel_own",
    "scan:cancel_any",
    "result:read",
    "history:read",
    "finding:triage",
    "profile:read",
    "profile:update",
    "member:read",
  ],
  developer: [
    "project:read",
    "repository:read",
    "scan:start",
    "scan:cancel_own",
    "result:read",
    "history:read",
    "finding:triage",
    "profile:read",
    "member:read",
  ],
  viewer: [
    "project:read",
    "repository:read",
    "result:read",
    "history:read",
    "profile:read",
    "member:read",
  ],
}

export const mockWorkspaces: Workspace[] = [
  {
    workspace_id: WORKSPACE_ID,
    name: "Acme Engineering",
    description: "Payments, storefront, and the tooling around them.",
    website_url: "https://acme.example.com",
    role: "org-admin",
    is_active: true,
    created_at: "2026-06-01T09:00:00.000Z",
    updated_at: "2026-07-22T18:30:00.000Z",
    project_count: 3,
    member_count: 4,
  },
  {
    workspace_id: SECOND_WORKSPACE_ID,
    name: "Nimbus Labs",
    description: "A workspace this account can read but not administer.",
    website_url: null,
    role: "viewer",
    is_active: false,
    created_at: "2026-07-04T11:15:00.000Z",
    updated_at: "2026-07-19T08:05:00.000Z",
    project_count: 1,
    member_count: 2,
  },
]

export const mockSession: Session = {
  user_id: "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  workspace_id: "1e2f3a4b-5c6d-4e7f-8091-a2b3c4d5e6f7",
  needs_workspace_setup: false,
  product_tour_required: false,
  role: "org-admin",
  permissions: PERMISSIONS_BY_ROLE["org-admin"],
  email: "janidu@example.com",
  name: "Janidu Pabasara",
  avatar_url: "https://avatars.githubusercontent.com/u/1024?v=4",
  identity_provider: "github",
}

export const mockSessionMinimal: Session = {
  user_id: "2c4a6e80-1b3d-4f57-9a80-c1d2e3f4a5b6",
  workspace_id: "1e2f3a4b-5c6d-4e7f-8091-a2b3c4d5e6f7",
}

// A viewer: every read, no writes.
export const mockSessionViewer: Session = {
  user_id: "4d5e6f70-8a9b-4c1d-8e2f-3a4b5c6d7e8f",
  workspace_id: "1e2f3a4b-5c6d-4e7f-8091-a2b3c4d5e6f7",
  needs_workspace_setup: false,
  product_tour_required: false,
  role: "viewer",
  permissions: PERMISSIONS_BY_ROLE.viewer,
  email: "viewer@example.com",
  name: "Read Only",
}

/** Signed in, but with nowhere to work yet — the onboarding state. */
export const mockSessionOnboarding: Session = {
  user_id: "7f8e9d0c-1b2a-4c3d-8e5f-6a7b8c9d0e1f",
  workspace_id: null,
  needs_workspace_setup: true,
  product_tour_required: true,
  role: null,
  permissions: [],
  email: "new@example.com",
}

// Who is in each seeded workspace.
export const mockMembers: Record<string, Member[]> = {
  [WORKSPACE_ID]: [
    {
      membership_id: "a1000000-0000-4000-8000-000000000001",
      user_id: mockSession.user_id,
      email: mockSession.email,
      name: mockSession.name,
      role: "org-admin",
      status: "active",
    },
    {
      membership_id: "a1000000-0000-4000-8000-000000000002",
      user_id: "b2000000-0000-4000-8000-000000000002",
      email: "priya.manager@example.com",
      name: "Priya Fernando",
      role: "manager",
      status: "active",
    },
    {
      membership_id: "a1000000-0000-4000-8000-000000000003",
      user_id: "b2000000-0000-4000-8000-000000000003",
      email: "sam.developer@example.com",
      name: "Sam Perera",
      role: "developer",
      status: "active",
    },
    {
      membership_id: "a1000000-0000-4000-8000-000000000004",
      user_id: mockSessionViewer.user_id,
      email: mockSessionViewer.email,
      name: mockSessionViewer.name,
      role: "viewer",
      status: "active",
    },
    {
      membership_id: "a1000000-0000-4000-8000-000000000005",
      user_id: "b2000000-0000-4000-8000-000000000005",
      email: null,
      name: null,
      role: "developer",
      status: "inactive",
    },
  ],
  [SECOND_WORKSPACE_ID]: [
    {
      membership_id: "a2000000-0000-4000-8000-000000000001",
      user_id: "b3000000-0000-4000-8000-000000000001",
      email: "lead@nimbus.example.com",
      name: "Nimbus Lead",
      role: "org-admin",
      status: "active",
    },
    {
      membership_id: "a2000000-0000-4000-8000-000000000002",
      user_id: mockSession.user_id,
      email: mockSession.email,
      name: mockSession.name,
      role: "viewer",
      status: "active",
    },
  ],
}

export const mockInvitations: Record<string, Invitation[]> = {
  [WORKSPACE_ID]: [
    {
      invitation_id: "c1000000-0000-4000-8000-000000000001",
      email: "new.hire@example.com",
      role: "developer",
      expires_at: "2026-12-31T00:00:00.000Z",
    },
  ],
  [SECOND_WORKSPACE_ID]: [],
}

// A token the mock accepts: it joins a third workspace, "Orbit Studio", as a developer.
export const MOCK_INVITATION_TOKEN = "orbit-studio-invitation-token-0123456789"
export const INVITED_WORKSPACE_ID = "3a4b5c6d-7e8f-4091-a2b3-c4d5e6f70819"

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
    // Both nullable fields exercised: a branch GitHub has not given us a head commit for.
    name: "release/2026.08",
    is_default: false,
    head_commit_sha: null,
    head_commit_at: null,
  },
]

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
    usage_count: 0,
    editable: false,
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
    usage_count: 0,
    editable: false,
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
    usage_count: 0,
    editable: false,
  },
]

/** The workspace default. Every fixture below is scored under this. */
export const balancedProfile =
  mockProfiles.find((p) => p.is_active) ?? mockProfiles[0]

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

function latestHealthFor(repoId: string) {
  const report = reportFor(repoId, "main", true)
  return {
    score: report.health_score,
    grade: report.grade,
    delta: report.delta,
    // What the workspace overview needs, as the API reports it.
    kloc: report.kloc ?? null,
    finding_count: report.findings.length,
    red_issue_count: report.red_issue_count,
    scanned_at: report.scanned_at,
    trend: report.history
      .slice(-7)
      .map((point) => ({ t: point.t, score: point.score })),
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
    visibility: "private",
    url: "https://github.com/acme/octo-cli",
    default_branch: "trunk",
    connected_at: "2026-08-19T07:45:00.000Z",
    // no latest_health: connected, never successfully scanned
  },
]

// The second workspace's only repository.
export const nimbusRepos: Repo[] = [
  {
    id: NIMBUS_REPO_ID,
    name: "nimbus-gateway",
    owner: "nimbus",
    visibility: "public",
    url: "https://github.com/nimbus/nimbus-gateway",
    default_branch: "main",
    connected_at: "2026-07-05T10:30:00.000Z",
    latest_health: latestHealthFor(NIMBUS_REPO_ID),
  },
]

/** acme-payments @ main, under Balanced — what the demo dashboard shows. */
export const mockHealthReport: HealthReport = reportFor(
  DEMO_REPO_ID,
  "main",
  true,
)

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
