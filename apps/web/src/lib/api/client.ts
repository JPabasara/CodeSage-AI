// ────────────────────────────────────────────────────────────────────────────
// THE API CLIENT — thin functions that make the real network calls.
//
// This code is FINAL: it does not know or care whether a real backend exists.
// It just calls `/api/...`. In dev those calls are intercepted by MSW (Phase 8);
// at go-live they hit the real FastAPI backend, which needs the session cookie
// attached — see the note on credentials below.
// ────────────────────────────────────────────────────────────────────────────
import type {
  ApplyProfileRequest,
  Branch,
  HealthReport,
  Repo,
  ScanStatus,
  ScanSummary,
  ScoreProfile,
} from "@/lib/types"

// Empty in dev (same-origin, so MSW's service worker sees the request). Phase 12
// points this at the deployed API, e.g. "https://api.codesage.dev".
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? ""

// Every call below passes `credentials: "include"`. The API is a different
// origin (api.codesageai.dev vs codesageai.dev), and a browser leaves cookies
// out of cross-origin requests unless it is asked — without this the session
// cookie never arrives and every endpoint answers 401. (J2.7)

/** Unwrap a fetch Response as JSON, turning a non-2xx status into a thrown Error. */
async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}`)
  }
  return res.json() as Promise<T>
}

// Sign-in and sign-out are deliberately NOT here. Sign-in is a plain <a> link in
// the login page — the browser has to leave the page for OIDC, so it cannot be a
// fetch. Sign-out is a POST from the app rail.

// ── reads ────────────────────────────────────────────────────────────────────

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
