// The API client — thin functions that make the real network calls.
import type {
  AcceptedInvitation,
  Activity,
  ApiError,
  Branch,
  ConnectRepoRequest,
  CreatedInvitation,
  CreateInvitationRequest,
  CreateProfileRequest,
  CreateWorkspaceRequest,
  DeleteWorkspaceRequest,
  ErrorCode,
  FindingStatus,
  FindingPage,
  HealthReport,
  Member,
  MemberList,
  ProjectProfile,
  Repo,
  Role,
  ScanStatus,
  ScanSummary,
  ScoreProfile,
  SelectProfileRequest,
  Session,
  SourceScopeConfig,
  UpdateProfileRequest,
  UpdateWorkspaceRequest,
  Workspace,
} from "@/lib/types"
import { forgetScores } from "@/lib/query-cache"

// Empty in dev, so the request is same-origin and MSW's service worker sees it.
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? ""

// A failed request, carrying the contract's error envelope.
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | undefined,
    readonly detail: string,
    /** `REPOSITORY_HAS_NO_JAVA` only: the languages GitHub did find. */
    readonly languages?: string[],
  ) {
    super(detail)
    this.name = "ApiRequestError"
  }
}

// Unwrap a fetch Response as JSON, turning a non-2xx into an ApiRequestError.
async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let body: Partial<ApiError> & { detail?: unknown } = {}
    try {
      body = (await res.json()) as Partial<ApiError> & { detail?: unknown }
    } catch {
      // A proxy or gateway can fail with a non-JSON body; fall back to the status.
    }
    const detail =
      typeof body.detail === "string"
        ? body.detail
        : `${res.status} ${res.statusText}`.trim()
    throw new ApiRequestError(
      res.status,
      body.code,
      detail,
      Array.isArray(body.languages) ? body.languages : undefined,
    )
  }
  return res.json() as Promise<T>
}

async function empty(res: Response): Promise<void> {
  if (!res.ok) await json<never>(res)
}

function scoresChanged<T>(value: T): T {
  forgetScores()
  // Scores are being recalculated: let the Activity menu say so now rather than at its next poll.
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(ACTIVITY_STALE_EVENT))
  }
  return value
}

/** Fired when something just changed what `GET /api/activity` would say. */
export const ACTIVITY_STALE_EVENT = "codesage:activity-stale"

export function getSession(): Promise<Session> {
  return fetch(`${API_BASE}/api/auth/session`, {
    credentials: "include",
  }).then(json<Session>)
}

/** Stop automatic first-run onboarding; lessons remain available from Support. */
export function finishProductTour(
  status: "completed" | "skipped",
): Promise<void> {
  return fetch(`${API_BASE}/api/auth/tour`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  }).then(empty)
}

// The workspaces this user can switch to — active memberships only.
export function getWorkspaces(): Promise<Workspace[]> {
  return fetch(`${API_BASE}/api/auth/workspaces`, {
    credentials: "include",
  }).then(json<Workspace[]>)
}

// Create a workspace, with the caller as its org-admin, and select it for this session.
export function createWorkspace(
  body: CreateWorkspaceRequest,
): Promise<Workspace> {
  return fetch(`${API_BASE}/api/auth/workspaces`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(json<Workspace>)
}

export function updateWorkspace(
  workspaceId: string,
  body: UpdateWorkspaceRequest,
): Promise<Workspace> {
  return fetch(`${API_BASE}/api/auth/workspaces/${workspaceId}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(json<Workspace>)
}

// Permanently delete the active workspace and everything it owns.
export function deleteWorkspace(
  workspaceId: string,
  body: DeleteWorkspaceRequest,
): Promise<void> {
  return fetch(`${API_BASE}/api/auth/workspaces/${workspaceId}`, {
    method: "DELETE",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(empty)
}

// Point this session at another workspace.
export function switchWorkspace(workspaceId: string): Promise<Workspace> {
  return fetch(`${API_BASE}/api/auth/workspaces/active`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspace_id: workspaceId }),
  }).then(json<Workspace>)
}

// Connect a public repository by URL.
export function connectRepo(url: string): Promise<Repo> {
  const body: ConnectRepoRequest = { url }
  return fetch(`${API_BASE}/api/projects`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(json<Repo>)
}

export function removeProject(repoId: string): Promise<void> {
  return fetch(`${API_BASE}/api/projects/${repoId}`, {
    method: "DELETE",
    credentials: "include",
  }).then(empty)
}

export function getProjects(): Promise<Repo[]> {
  return fetch(`${API_BASE}/api/projects`, {
    credentials: "include",
  }).then(json<Repo[]>)
}

export function getSourceScopeConfig(
  repoId: string,
): Promise<SourceScopeConfig> {
  return fetch(`${API_BASE}/api/projects/${repoId}/source-scope`, {
    credentials: "include",
  }).then(json<SourceScopeConfig>)
}

export function updateSourceScopeConfig(
  repoId: string,
  body: SourceScopeConfig,
): Promise<SourceScopeConfig> {
  return fetch(`${API_BASE}/api/projects/${repoId}/source-scope`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(json<SourceScopeConfig>)
}

export function getBranches(repoId: string): Promise<Branch[]> {
  return fetch(`${API_BASE}/api/repos/${repoId}/branches`, {
    credentials: "include",
  }).then(json<Branch[]>)
}

export async function getHealthReport(
  repoId: string,
  branch: string,
  snapshotId?: string,
): Promise<HealthReport> {
  const qs = new URLSearchParams({ branch, include_findings: "false" })
  if (snapshotId) qs.set("snapshot_id", snapshotId)
  const report = await fetch(`${API_BASE}/api/repos/${repoId}/health?${qs}`, {
    credentials: "include",
  }).then(json<HealthReport>)
  const pageSize = 100
  const findingsQuery = (offset: number) => {
    const page = new URLSearchParams({
      branch,
      limit: String(pageSize),
      offset: String(offset),
    })
    if (snapshotId) page.set("snapshot_id", snapshotId)
    return fetch(`${API_BASE}/api/repos/${repoId}/health/findings?${page}`, {
      credentials: "include",
    }).then(json<FindingPage>)
  }
  const first = await findingsQuery(0)
  const offsets = Array.from(
    { length: Math.max(0, Math.ceil(first.total / pageSize) - 1) },
    (_, index) => (index + 1) * pageSize,
  )
  const rest = await Promise.all(offsets.map(findingsQuery))
  return { ...report, findings: [first, ...rest].flatMap((page) => page.items) }
}

// Change only the workflow state of one finding in one immutable snapshot.
export function setFindingStatus(
  snapshotId: string,
  fingerprint: string,
  status: FindingStatus,
): Promise<void> {
  return fetch(
    `${API_BASE}/api/snapshots/${encodeURIComponent(snapshotId)}/findings/${encodeURIComponent(fingerprint)}/status`,
    {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    },
  ).then(empty)
}

export function getScanHistory(
  repoId: string,
  branch?: string,
): Promise<ScanSummary[]> {
  const qs = new URLSearchParams()
  if (branch) qs.set("branch", branch)
  const query = qs.toString()
  const suffix = query ? `?${query}` : ""
  return fetch(`${API_BASE}/api/repos/${repoId}/scans${suffix}`, {
    credentials: "include",
  }).then(json<ScanSummary[]>)
}

// The whole pool in one request: built-ins first, then the workspace's own.
export function getProfiles(): Promise<ScoreProfile[]> {
  return fetch(`${API_BASE}/api/profiles`, {
    credentials: "include",
  }).then(json<ScoreProfile[]>)
}

// Add one custom profile to the pool.
export function createProfile(
  body: CreateProfileRequest,
): Promise<ScoreProfile> {
  return fetch(`${API_BASE}/api/profiles`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
    .then(json<ScoreProfile>)
    .then(scoresChanged)
}

export function updateProfile(
  profileId: string,
  body: UpdateProfileRequest,
): Promise<ScoreProfile> {
  return fetch(`${API_BASE}/api/profiles/${profileId}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
    .then(json<ScoreProfile>)
    .then(scoresChanged)
}

// Delete an unused custom profile.
export function deleteProfile(profileId: string): Promise<void> {
  return fetch(`${API_BASE}/api/profiles/${profileId}`, {
    method: "DELETE",
    credentials: "include",
  })
    .then(empty)
    .then(scoresChanged)
}

// Point the workspace at one profile of its own pool.
export function setDefaultProfile(profileId: string): Promise<ScoreProfile> {
  const body: SelectProfileRequest = { profile_id: profileId }
  return fetch(`${API_BASE}/api/profiles/default`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
    .then(json<ScoreProfile>)
    .then(scoresChanged)
}

export function getProjectProfile(repoId: string): Promise<ProjectProfile> {
  return fetch(`${API_BASE}/api/projects/${repoId}/profile`, {
    credentials: "include",
  }).then(json<ProjectProfile>)
}

// Give one project a profile of its own, chosen from this workspace's pool.
export function setProjectProfile(
  repoId: string,
  profileId: string,
): Promise<ProjectProfile> {
  const body: SelectProfileRequest = { profile_id: profileId }
  return fetch(`${API_BASE}/api/projects/${repoId}/profile`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
    .then(json<ProjectProfile>)
    .then(scoresChanged)
}

// Drop the override so the project follows the workspace default again.
export function clearProjectProfile(repoId: string): Promise<ProjectProfile> {
  return fetch(`${API_BASE}/api/projects/${repoId}/profile`, {
    method: "DELETE",
    credentials: "include",
  })
    .then(json<ProjectProfile>)
    .then(scoresChanged)
}

export function getActivity(): Promise<Activity> {
  return fetch(`${API_BASE}/api/activity`, {
    credentials: "include",
  }).then(json<Activity>)
}

export function startScan(repoId: string, branch: string): Promise<ScanStatus> {
  return fetch(`${API_BASE}/api/repos/${repoId}/scan`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ branch }),
  }).then(json<ScanStatus>)
}

export function getScanStatus(
  repoId: string,
  scanId: string,
): Promise<ScanStatus> {
  return fetch(`${API_BASE}/api/repos/${repoId}/scan/${scanId}`, {
    credentials: "include",
  }).then(json<ScanStatus>)
}

export async function getActiveScan(
  repoId: string,
  branch?: string,
): Promise<ScanStatus | null> {
  const qs = branch ? `?${new URLSearchParams({ branch })}` : ""
  const res = await fetch(`${API_BASE}/api/repos/${repoId}/scan/active${qs}`, {
    credentials: "include",
  })
  if (res.status === 204) return null
  return json<ScanStatus>(res)
}

export function stopScan(repoId: string, scanId: string): Promise<ScanStatus> {
  return fetch(`${API_BASE}/api/repos/${repoId}/scan/${scanId}/stop`, {
    method: "POST",
    credentials: "include",
  }).then(json<ScanStatus>)
}

/** Members (any status) and the unexpired pending invitations, in one read. */
export function getMembers(): Promise<MemberList> {
  return fetch(`${API_BASE}/api/members`, {
    credentials: "include",
  }).then(json<MemberList>)
}

export function createInvitation(
  body: CreateInvitationRequest,
): Promise<CreatedInvitation> {
  return fetch(`${API_BASE}/api/invitations`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(json<CreatedInvitation>)
}

export function revokeInvitation(invitationId: string): Promise<void> {
  return fetch(`${API_BASE}/api/invitations/${invitationId}`, {
    method: "DELETE",
    credentials: "include",
  }).then(empty)
}

// Accept an invitation as the signed-in identity.
export function acceptInvitation(token: string): Promise<AcceptedInvitation> {
  return fetch(`${API_BASE}/api/invitations/accept`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  }).then(json<AcceptedInvitation>)
}

/** Demoting the last active org-admin is a 409 `CONFLICT`. */
export function changeMemberRole(
  membershipId: string,
  role: Role,
): Promise<Member> {
  return fetch(`${API_BASE}/api/members/${membershipId}/role`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  }).then(json<Member>)
}

/** Remove only this workspace membership; the global user remains. */
export function removeMemberFromWorkspace(membershipId: string): Promise<void> {
  return fetch(`${API_BASE}/api/members/${membershipId}`, {
    method: "DELETE",
    credentials: "include",
  }).then(empty)
}
