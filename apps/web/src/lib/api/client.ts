// ────────────────────────────────────────────────────────────────────────────
// THE API CLIENT — thin functions that make the real network calls.
//
// This code is FINAL: it does not know or care whether a real backend exists.
// It just calls `/api/...`. In dev those calls are intercepted by MSW (Phase 8);
// at go-live they hit the real FastAPI backend (Phase 12) with no edits here —
// only NEXT_PUBLIC_API_BASE_URL changes.
// ────────────────────────────────────────────────────────────────────────────
import type {
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

/** Unwrap a fetch Response as JSON, turning a non-2xx status into a thrown Error. */
async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}`)
  }
  return res.json() as Promise<T>
}

// ── reads ────────────────────────────────────────────────────────────────────

export function getProjects(): Promise<Repo[]> {
  return fetch(`${API_BASE}/api/projects`).then(json<Repo[]>)
}

export function getBranches(repoId: string): Promise<Branch[]> {
  return fetch(`${API_BASE}/api/repos/${repoId}/branches`).then(json<Branch[]>)
}

export function getHealthReport(
  repoId: string,
  branch: string,
): Promise<HealthReport> {
  const qs = new URLSearchParams({ branch })
  return fetch(`${API_BASE}/api/repos/${repoId}/health?${qs}`).then(
    json<HealthReport>,
  )
}

export function getScanHistory(repoId: string): Promise<ScanSummary[]> {
  return fetch(`${API_BASE}/api/repos/${repoId}/scans`).then(
    json<ScanSummary[]>,
  )
}

export function getProfiles(): Promise<ScoreProfile[]> {
  return fetch(`${API_BASE}/api/profiles`).then(json<ScoreProfile[]>)
}

// ── scan lifecycle (wired into the UI in Phase 9) ────────────────────────────

export function startScan(repoId: string, branch: string): Promise<ScanStatus> {
  return fetch(`${API_BASE}/api/repos/${repoId}/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ branch }),
  }).then(json<ScanStatus>)
}

export function getScanStatus(
  repoId: string,
  scanId: string,
): Promise<ScanStatus> {
  return fetch(`${API_BASE}/api/repos/${repoId}/scan/${scanId}`).then(
    json<ScanStatus>,
  )
}

export function stopScan(repoId: string, scanId: string): Promise<ScanStatus> {
  return fetch(`${API_BASE}/api/repos/${repoId}/scan/${scanId}/stop`, {
    method: "POST",
  }).then(json<ScanStatus>)
}
