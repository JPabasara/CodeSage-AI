// The API client — thin functions that make the real network calls.
//
// It does not know whether a real backend exists; it just calls `/api/...`. In
// dev those calls are intercepted by MSW; in production they hit the real API,
// which needs the session cookie attached — see the note on credentials below.
import type {
  AcceptedInvitation,
  ApiError,
  Branch,
  ConnectRepoRequest,
  CreatedInvitation,
  CreateInvitationRequest,
  CreateProfileRequest,
  CreateWorkspaceRequest,
  ErrorCode,
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
  UpdateProfileRequest,
  UpdateWorkspaceRequest,
  Workspace,
} from "@/lib/types"
import { forgetScores } from "@/lib/query-cache"

// Empty in dev, so the request is same-origin and MSW's service worker sees it.
// In production this points at the deployed API.
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? ""

// Every call passes `credentials: "include"`. The API is a different origin, and
// a browser leaves cookies out of cross-origin requests unless asked — without
// this the session cookie never arrives and every endpoint answers 401.

/**
 * A failed request, carrying the contract's error envelope.
 *
 * `code` is the stable, machine-readable reason — it is what a caller branches on
 * to choose a message. `message` stays human-readable for anything that just logs
 * the error.
 */
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

/**
 * Unwrap a fetch Response as JSON, turning a non-2xx into an ApiRequestError.
 *
 * The error BODY is read, not discarded. `POST /api/projects` distinguishes a
 * malformed URL from a private repository from an unreachable one purely by
 * `code`, and throwing `new Error("400 Bad Request")` would make all three
 * indistinguishable to the UI.
 */
async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let body: Partial<ApiError> = {}
    try {
      body = (await res.json()) as Partial<ApiError>
    } catch {
      // A proxy or gateway can fail with a non-JSON body; fall back to the status.
    }
    throw new ApiRequestError(
      res.status,
      body.code,
      body.detail ?? `${res.status} ${res.statusText}`,
      Array.isArray(body.languages) ? body.languages : undefined,
    )
  }
  return res.json() as Promise<T>
}

async function empty(res: Response): Promise<void> {
  if (!res.ok) await json<never>(res)
}

/**
 * After a profile write succeeds: scores may have moved, so every cached report
 * is forgotten and the next dashboard visit asks the server (13H.3).
 */
function scoresChanged<T>(value: T): T {
  forgetScores()
  return value
}

// Sign-in and sign-out are deliberately NOT here — both are navigations, not
// fetches (see the login page's <a> and the app rail's sign-out <form>).
// `getSession` is the one auth endpoint the client calls with fetch, and it is
// how the app decides whether to render the dashboard or bounce to sign-in.

// ── reads ────────────────────────────────────────────────────────────────────

/** Who is signed in — 401 means there is no valid session. */
export function getSession(): Promise<Session> {
  return fetch(`${API_BASE}/api/auth/session`, {
    credentials: "include",
  }).then(json<Session>)
}

// ── workspaces ───────────────────────────────────────────────────────────────
//
// The session binds ONE workspace at a time, server-side. Every other endpoint
// in this client reads whichever one that is, which is why switching is a write
// rather than a query parameter: there is no way to ask for a workspace you are
// not currently in, and no way to accidentally mix two.

/**
 * The workspaces this user can switch to — active memberships only.
 *
 * Reachable without a workspace, where it answers `[]`. That is not an error:
 * it is the state onboarding exists for.
 */
export function getWorkspaces(): Promise<Workspace[]> {
  return fetch(`${API_BASE}/api/auth/workspaces`, {
    credentials: "include",
  }).then(json<Workspace[]>)
}

/**
 * Create a workspace, with the caller as its org-admin, and select it for this
 * session. The three built-in profiles are seeded with Balanced as the default.
 *
 * No repository is created: a new workspace is genuinely empty, and the Projects
 * page says so.
 */
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

/**
 * Update the ACTIVE workspace. Partial: omitted fields are left alone, and a
 * `null` description or website clears it.
 *
 * Another workspace you belong to answers 404 — the session binds one workspace,
 * and reading or writing outside it would defeat the isolation the API depends
 * on. Switch to it first.
 */
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

/**
 * Point this session at another workspace. A membership that is missing,
 * inactive, invited or someone else's all answer the same 404.
 */
export function switchWorkspace(workspaceId: string): Promise<Workspace> {
  return fetch(`${API_BASE}/api/auth/workspaces/active`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspace_id: workspaceId }),
  }).then(json<Workspace>)
}

/**
 * Connect a public repository by URL.
 *
 * Public only for now — a private URL comes back as `REPOSITORY_NOT_PUBLIC`.
 * Connecting one needs a GitHub App installation, which is v2. A repository
 * over the size limit is `REPOSITORY_TOO_LARGE`, and one with no Java is
 * `REPOSITORY_HAS_NO_JAVA` with the languages GitHub found; neither creates a
 * project.
 */
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

export function getBranches(repoId: string): Promise<Branch[]> {
  return fetch(`${API_BASE}/api/repos/${repoId}/branches`, {
    credentials: "include",
  }).then(json<Branch[]>)
}

export function getHealthReport(
  repoId: string,
  branch: string,
  snapshotId?: string,
): Promise<HealthReport> {
  const qs = new URLSearchParams({ branch })
  if (snapshotId) qs.set("snapshot_id", snapshotId)
  return fetch(`${API_BASE}/api/repos/${repoId}/health?${qs}`, {
    credentials: "include",
  }).then(json<HealthReport>)
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

// ── the workspace profile pool ───────────────────────────────────────────────
//
// One pool per workspace: three immutable built-ins plus up to five custom
// profiles, one of them the workspace default. A project either inherits that
// default or names one profile of the same pool as its own.
//
// The legacy `GET/PUT /api/profiles/active` pair is deliberately absent. It
// expressed "the workspace has one profile and Apply replaces it", which the
// pool supersedes, and a client function that still wrote it would silently
// overwrite whichever custom profile happened to be the default.

/**
 * The whole pool in one request: built-ins first, then the workspace's own.
 *
 * Each entry carries `is_preset`, `is_active` (the workspace default),
 * `usage_count` and `editable`, so the Profiles screen renders every card, badge
 * and disabled action from this one response.
 */
export function getProfiles(): Promise<ScoreProfile[]> {
  return fetch(`${API_BASE}/api/profiles`, {
    credentials: "include",
  }).then(json<ScoreProfile[]>)
}

/**
 * Add one custom profile to the pool. It does NOT become the default — that is a
 * separate, deliberate choice.
 *
 * The sixth is refused with `PROFILE_LIMIT_REACHED` and a duplicate name with
 * `PROFILE_NAME_CONFLICT`; both arrive as an {@link ApiRequestError} carrying the
 * code, which is what lets the dialog explain itself rather than say "409".
 */
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

/**
 * Change a custom profile. PATCH, not PUT: the body carries only the fields the
 * user actually edited, so a form that tracks edits cannot resubmit — and
 * silently re-clamp — the ones it merely displayed.
 *
 * Built-ins answer `PROFILE_BUILT_IN`. The response is the profile as stored,
 * after clamping, so the editor adopts it rather than trusting what it sent.
 */
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

/**
 * Delete an unused custom profile.
 *
 * A profile that is the workspace default, or that any project has chosen,
 * answers `PROFILE_IN_USE` — the reference has to be moved first. Built-ins
 * answer `PROFILE_BUILT_IN`.
 */
export function deleteProfile(profileId: string): Promise<void> {
  return fetch(`${API_BASE}/api/profiles/${profileId}`, {
    method: "DELETE",
    credentials: "include",
  })
    .then(empty)
    .then(scoresChanged)
}

/**
 * Point the workspace at one profile of its own pool.
 *
 * Idempotent: it replaces the whole selection rather than amending it, so
 * re-sending the same id changes nothing. It starts no scan — every inheriting
 * project is re-scored from snapshots it already has.
 */
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

/**
 * What one project is scored with, and where that came from: the effective
 * profile, the workspace default and the explicit override, in one response —
 * so "inheriting Balanced" needs no second request.
 */
export function getProjectProfile(repoId: string): Promise<ProjectProfile> {
  return fetch(`${API_BASE}/api/projects/${repoId}/profile`, {
    credentials: "include",
  }).then(json<ProjectProfile>)
}

/**
 * Give one project a profile of its own, chosen from this workspace's pool.
 *
 * A project has at most one override, so this replaces any previous choice. A
 * profile id from another workspace answers 404 — the same as an id that exists
 * nowhere, because whether a foreign workspace holds one is not ours to reveal.
 */
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

/**
 * Drop the override so the project follows the workspace default again.
 * Idempotent: clearing a project that has none succeeds and returns the same
 * inherited state.
 */
export function clearProjectProfile(repoId: string): Promise<ProjectProfile> {
  return fetch(`${API_BASE}/api/projects/${repoId}/profile`, {
    method: "DELETE",
    credentials: "include",
  })
    .then(json<ProjectProfile>)
    .then(scoresChanged)
}

// ── scan lifecycle ───────────────────────────────────────────────────────────

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

/**
 * The scan still queued or running on this repository — on one branch, or any
 * when `branch` is omitted — or `null` when there is none (204).
 *
 * The way back to a scan whose id this page never held: one started before a
 * refresh, in another tab or device, or by a teammate.
 */
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

// ── members & invitations ────────────────────────────────────────────────────
//
// All scoped to the ACTIVE workspace, like everything else. Reading is open to
// every role; every write needs `member:manage`, which only an org-admin has.
// The API re-checks it — hiding a button is not the boundary.

/** Members (any status) and the unexpired pending invitations, in one read. */
export function getMembers(): Promise<MemberList> {
  return fetch(`${API_BASE}/api/members`, {
    credentials: "include",
  }).then(json<MemberList>)
}

/**
 * Invite an email address. The API emails the link and rolls the invitation
 * back if delivery cannot be requested — that arrives as a 503
 * `UPSTREAM_UNAVAILABLE`, and no pending invitation is left behind. An address
 * already invited or already a member is a 409.
 */
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

/**
 * Accept an invitation as the signed-in identity. Invalid, expired, revoked,
 * used and wrong-email tokens all answer the same 404 — which one it was is not
 * the caller's to learn. Accepting does not switch workspace; the caller does.
 */
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

/** Deactivating the last active org-admin is a 409 `CONFLICT`. */
export function deactivateMember(membershipId: string): Promise<void> {
  return fetch(`${API_BASE}/api/members/${membershipId}`, {
    method: "DELETE",
    credentials: "include",
  }).then(empty)
}
