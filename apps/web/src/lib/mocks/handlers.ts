// ────────────────────────────────────────────────────────────────────────────
// THE FAKE BACKEND (MSW request handlers)
//
// Each entry below answers one endpoint the real FastAPI backend will own. MSW
// intercepts `fetch()` at the network layer, so components call `/api/...` and
// never know the response came from here. The same handlers feed three places:
// the dev app (Phase 8.3), component tests (8.6) and Playwright (Phase 10).
//
// DATA vs BEHAVIOUR: `fixtures.ts` holds the sample *data* (already used by the
// Phase 7 screens). This file holds the little bit of *server behaviour* a fake
// backend needs — deriving a report per repo/branch, and the scan progress
// state machine. Fixtures stay pure data so both layers can change separately.
//
// Deviations from plan §6.3 (deliberate — see the notes there):
//  • fixture names: `mockRepos` / `mockBranches`  (the plan's `mockProjects` /
//    `mockBranches(repoId)` predate the real fixtures file).
//  • paths are prefixed `*/` so they match whether the caller used a relative
//    URL (browser) or an absolute one (Node/tests) — one less environment trap.
// ────────────────────────────────────────────────────────────────────────────
import { http, HttpResponse } from "msw"
import type { Grade, HealthReport, ScanStatus } from "@/lib/types"
import {
  mockBranches,
  mockHealthReport,
  mockProfiles,
  mockRepos,
  mockScanHistory,
} from "./fixtures"

// ── small helpers the fake backend needs ────────────────────────────────────

/** score → letter grade. The REAL backend computes this (§6); the mock fakes it. */
function gradeFor(score: number): Grade {
  if (score >= 85) return "A"
  if (score >= 70) return "B"
  if (score >= 55) return "C"
  if (score >= 40) return "D"
  return "E"
}

function clampScore(n: number) {
  return Math.max(0, Math.min(100, Math.round(n)))
}

const defaultBranch = mockBranches.find((b) => b.is_default) ?? mockBranches[0]

/**
 * Build the health report for one repo + branch from the single stored fixture.
 * Shifting the whole story by one offset keeps it self-consistent (the trend
 * still ends at the current score) and makes the Phase 9 branch switch visibly
 * change the numbers. Tree/findings are shared across repos — fine for a mock.
 */
function healthReportFor(repoId: string, branch: string): HealthReport {
  const repo = mockRepos.find((r) => r.id === repoId)
  const branchInfo =
    mockBranches.find((b) => b.name === branch) ?? defaultBranch

  const target = clampScore(
    (repo?.latest_health?.score ?? mockHealthReport.health_score) +
      (branchInfo.is_default ? 0 : -6),
  )
  const shift = target - mockHealthReport.health_score

  const history = mockHealthReport.history.map((p) => ({
    ...p,
    score: clampScore(p.score + shift),
  }))
  const previous = history[history.length - 2]?.score ?? target

  return {
    ...mockHealthReport,
    repo_id: repoId,
    branch: branchInfo.name,
    commit_sha: branchInfo.head_commit_sha ?? "",
    health_score: target,
    grade: gradeFor(target),
    delta: target - previous,
    history,
    // derived, never hand-maintained: the card can't disagree with the list
    red_issue_count: mockHealthReport.findings.filter(
      (f) => f.severity === "critical" || f.severity === "high",
    ).length,
  }
}

// ── scan state machine (in-memory, one running scan per repo) ───────────────

const SCAN_STEP = 17 // % added per poll → ~6 polls from 0 to done
const scans = new Map<string, ScanStatus>()

function idleScan(repoId: string): ScanStatus {
  return { scan_id: `scan-${repoId}-idle`, phase: "idle", progress: 0 }
}

function advanceScan(
  repoId: string,
  action: "start" | "tick" | "stop",
  branch?: string,
): ScanStatus {
  const now = new Date().toISOString()
  const current = scans.get(repoId) ?? idleScan(repoId)

  if (action === "start") {
    const branchInfo =
      mockBranches.find((b) => b.name === branch) ?? defaultBranch
    const started: ScanStatus = {
      scan_id: `scan-${Date.now()}`,
      phase: "running",
      progress: 0,
      branch: branchInfo.name,
      commit_sha: branchInfo.head_commit_sha ?? undefined,
      started_at: now,
    }
    scans.set(repoId, started)
    return started
  }

  if (action === "stop") {
    const stopped: ScanStatus = {
      ...current,
      phase: "idle",
      progress: 0,
      finished_at: now,
    }
    scans.set(repoId, stopped)
    return stopped
  }

  // "tick" — polling a scan that isn't running just echoes its state back
  if (current.phase !== "running") return current

  const progress = Math.min(100, current.progress + SCAN_STEP)
  const next: ScanStatus =
    progress >= 100
      ? { ...current, phase: "done", progress: 100, finished_at: now }
      : { ...current, progress }
  scans.set(repoId, next)
  return next
}

/** Clear scan progress between tests — `server.resetHandlers()` can't see this Map. */
export function resetMockBackend() {
  scans.clear()
}

// ── the endpoints ───────────────────────────────────────────────────────────

export const handlers = [
  http.get("*/api/projects", () => HttpResponse.json(mockRepos)),

  http.get("*/api/repos/:repoId/branches", () =>
    HttpResponse.json(mockBranches),
  ),

  http.get("*/api/repos/:repoId/health", ({ params, request }) => {
    const repoId = params.repoId as string
    if (!mockRepos.some((r) => r.id === repoId)) {
      return HttpResponse.json({ detail: "Repo not found" }, { status: 404 })
    }
    const branch =
      new URL(request.url).searchParams.get("branch") ?? defaultBranch.name
    return HttpResponse.json(healthReportFor(repoId, branch))
  }),

  // Scan-History tab
  http.get("*/api/repos/:repoId/scans", () =>
    HttpResponse.json(mockScanHistory),
  ),

  // Profiles screen (v1: presets only)
  http.get("*/api/profiles", () => HttpResponse.json(mockProfiles)),

  // ── scan lifecycle: POST starts it, polling reports progress, POST stops it ──
  http.post("*/api/repos/:repoId/scan", async ({ params, request }) => {
    const body = (await request.json().catch(() => null)) as {
      branch?: string
    } | null
    return HttpResponse.json(
      advanceScan(params.repoId as string, "start", body?.branch),
    )
  }),

  http.get("*/api/repos/:repoId/scan/:scanId", ({ params }) =>
    HttpResponse.json(advanceScan(params.repoId as string, "tick")),
  ),

  http.post("*/api/repos/:repoId/scan/:scanId/stop", ({ params }) =>
    HttpResponse.json(advanceScan(params.repoId as string, "stop")),
  ),
]
