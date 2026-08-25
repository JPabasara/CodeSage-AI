// ────────────────────────────────────────────────────────────────────────────
// THE API CLIENT — thin functions that make the real network calls.
//
// This code is FINAL: it does not know or care whether a real backend exists.
// It just calls `/api/...`. In dev those calls are intercepted by MSW (Phase 8);
// at go-live they hit the real FastAPI backend, which needs the session cookie
// attached — see the note on credentials below.
// ────────────────────────────────────────────────────────────────────────────
import type {
  ApiError,
  ApplyProfileRequest,
  Branch,
  ConnectRepoRequest,
  ErrorCode,
  HealthReport,
  Repo,
  ScanStatus,
  ScanSummary,
  ScoreProfile,
  Session,
} from "@/lib/types"

// Empty in dev (same-origin, so MSW's service worker sees the request). Phase 12
// points this at the deployed API, e.g. "https://api.codesage.dev".
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? ""

// Every call below passes `credentials: "include"`. The API is a different
// origin (api.codesageai.dev vs codesageai.dev), and a browser leaves cookies
// out of cross-origin requests unless it is asked — without this the session
// cookie never arrives and every endpoint answers 401. (J2.7)

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
    )
  }
  return res.json() as Promise<T>
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

/**
 * Connect a public repository by URL (FR-3).
 *
 * v1.0 accepts public repositories only. A private URL comes back as
 * `REPOSITORY_NOT_PUBLIC` — connecting a private repository needs a GitHub App
 * installation and the SEC-04/SEC-06 authorization controls, which are v2.
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
): Promise<HealthReport> {
  const qs = new URLSearchParams({ branch })
  return fetch(`${API_BASE}/api/repos/${repoId}/health?${qs}`, {
    credentials: "include",
  }).then(json<HealthReport>)
}

export function getScanHistory(repoId: string): Promise<ScanSummary[]> {
  return fetch(`${API_BASE}/api/repos/${repoId}/scans`, {
    credentials: "include",
  }).then(json<ScanSummary[]>)
}

/** The profile actually in force — what the Profiles screen opens showing. */
export function getActiveProfile(): Promise<ScoreProfile> {
  return fetch(`${API_BASE}/api/profiles/active`, {
    credentials: "include",
  }).then(json<ScoreProfile>)
}

/**
 * Apply a profile. Sends the whole thing, and returns the profile as it is
 * *really* in force — the server clamps out-of-range weights rather than
 * rejecting them, so the response is the source of truth, not what we sent.
 */
export function applyProfile(body: ApplyProfileRequest): Promise<ScoreProfile> {
  return fetch(`${API_BASE}/api/profiles/active`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(json<ScoreProfile>)
}

export function getProfiles(): Promise<ScoreProfile[]> {
  return fetch(`${API_BASE}/api/profiles`, {
    credentials: "include",
  }).then(json<ScoreProfile[]>)
}

// ── scan lifecycle (wired into the UI in Phase 9) ────────────────────────────

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

export function stopScan(repoId: string, scanId: string): Promise<ScanStatus> {
  return fetch(`${API_BASE}/api/repos/${repoId}/scan/${scanId}/stop`, {
    method: "POST",
    credentials: "include",
  }).then(json<ScanStatus>)
}
