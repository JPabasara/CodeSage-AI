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
import type {
  ApiError,
  ApplyProfileRequest,
  ConnectRepoRequest,
  Repo,
  CategoryWeights,
  Grade,
  HealthReport,
  ScanStatus,
  ScoreProfile,
} from "@/lib/types"
import { WEIGHT_MAX, WEIGHT_MIN, TRUST_MAX, TRUST_MIN } from "@/lib/types"
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

// The pipeline is clone → extract → detect → FINALIZE, and the cancel flag is
// only read BETWEEN stages — never inside finalize, because a half-written
// snapshot reads exactly like a complete one (FR-6, DBR-22). Past this progress
// the mock is "in finalize": Stop is accepted but the scan still completes.
const FINALIZE_AT = 85
const scans = new Map<string, ScanStatus>()

// Stop only *requests* cancellation; the scan keeps reporting "running" until the
// next poll. Modelled faithfully on purpose — a mock that returned "cancelled"
// straight from the POST would let the UI skip the polling path the real backend
// requires, and the bug would only surface on the live site.
const cancelRequested = new Set<string>()

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
    // 202: the flag is set and we return the phase unchanged. The client learns
    // the scan really stopped from the NEXT poll, not from this response.
    if (current.phase === "running") cancelRequested.add(repoId)
    return current
  }

  // "tick" — polling a scan that isn't running just echoes its state back
  if (current.phase !== "running") return current

  // The worker reads the cancel flag between pipeline stages and stops at the
  // first boundary. Progress freezes where it was: the scan did not finish.
  if (cancelRequested.has(repoId)) {
    cancelRequested.delete(repoId)
    if (current.progress < FINALIZE_AT) {
      const cancelled: ScanStatus = { ...current, phase: "cancelled", finished_at: now }
      scans.set(repoId, cancelled)
      return cancelled
    }
    // Too late — finalization has begun, so the flag is dropped and the scan
    // runs to `done` below. The user pressed Stop and still gets a result.
  }

  const progress = Math.min(100, current.progress + SCAN_STEP)
  const next: ScanStatus =
    progress >= 100
      ? { ...current, phase: "done", progress: 100, finished_at: now }
      : { ...current, progress }
  scans.set(repoId, next)
  return next
}

/** Clear scan progress between tests — `server.resetHandlers()` can't see this Map. */
// ── the active profile ──────────────────────────────────────────────────────

// Applying replaces the workspace's single active profile in place; profiles are
// not versioned. Held here rather than in fixtures.ts because it is mutable
// server state, not sample data.
// Connecting adds to the workspace, so the projects list is mutable state rather
// than the fixture array. Seeded from the fixtures on every reset.
let connected: Repo[] = [...mockRepos]

let activeProfile: ScoreProfile =
  mockProfiles.find((p) => p.is_active) ?? mockProfiles[0]

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/**
 * Out-of-range weights are CLAMPED, not rejected: 9.0 is stored as 3.0 and
 * returned as 3.0 with a 200. The response is the profile as it is really in
 * force, which is what lets the client confirm what was saved rather than
 * trusting what it sent.
 */
function applyToWorkspace(body: ApplyProfileRequest): ScoreProfile {
  const w = (n: number) => clamp(n, WEIGHT_MIN, WEIGHT_MAX)
  const weights: CategoryWeights = {
    security: w(body.weights.security),
    code_design: w(body.weights.code_design),
    requirement: w(body.weights.requirement),
    documentation: w(body.weights.documentation),
    test: w(body.weights.test),
  }

  activeProfile = {
    ...activeProfile,
    name: body.name ?? "Custom",
    weights,
    trust_s: clamp(body.trust_s, TRUST_MIN, TRUST_MAX),
    // Editing a preset's numbers produces a custom profile; the preset itself is
    // a read-only template and is never overwritten.
    is_preset: false,
    is_active: true,
  }
  return activeProfile
}

export function resetMockBackend() {
  scans.clear()
  cancelRequested.clear()
  activeProfile = mockProfiles.find((p) => p.is_active) ?? mockProfiles[0]
  connected = [...mockRepos]
}

// ── the endpoints ───────────────────────────────────────────────────────────
//
// Four contract endpoints are deliberately NOT handled here. They are absences by
// design, not gaps somebody forgot — MSW passes anything it has no handler for
// straight through (`onUnhandledRequest: "bypass"` in the browser), which is
// exactly what each of these needs:
//
//   GET  /api/auth/login     a navigation, not a fetch. The browser has to leave
//   GET  /api/auth/callback  the page for OIDC, so a service worker never sees it.
//   GET  /api/auth/session   must reach the REAL API, or sign-in cannot be tested
//   POST /api/auth/logout    locally at all.
//   POST /api/projects       has no caller yet - ConnectRepo is still a
//                            placeholder form (see the note on the Projects page).
//
// `src/test/setup.ts` runs the Node server with `onUnhandledRequest: "error"`, so
// if a component ever starts calling one of these, the test fails loudly rather
// than hanging on a real network call.

export const handlers = [
  http.get("*/api/projects", () => HttpResponse.json(connected)),

  // Connect a repository (FR-3). The four failure codes below are the ones the
  // contract names, and each needs its own message on screen - "400 Bad Request"
  // tells a user who pasted their own private repo nothing about what to do next.
  http.post("*/api/projects", async ({ request }) => {
    const { url } = (await request.json()) as ConnectRepoRequest

    const fail = (status: number, code: ApiError["code"], detail: string) =>
      HttpResponse.json({ detail, code } satisfies ApiError, { status })

    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return fail(
        400,
        "INVALID_REPOSITORY_URL",
        "That does not look like a repository URL.",
      )
    }
    if (parsed.hostname !== "github.com" || parsed.pathname.split("/").length < 3) {
      return fail(
        400,
        "INVALID_REPOSITORY_URL",
        "That does not look like a repository URL.",
      )
    }

    const [, owner, name] = parsed.pathname.replace(/\.git$/, "").split("/")

    // Deterministic stand-ins so the UI can be built against every branch of the
    // contract before the real backend exists.
    if (name.startsWith("private-")) {
      return fail(
        400,
        "REPOSITORY_NOT_PUBLIC",
        "Only public repositories can be connected in this release. Private repositories require a GitHub App installation.",
      )
    }
    if (name.startsWith("missing-")) {
      return fail(
        400,
        "REPOSITORY_UNREACHABLE",
        "That repository could not be reached. Check the URL and try again.",
      )
    }
    if (connected.some((r) => r.owner === owner && r.name === name)) {
      return fail(
        409,
        "ALREADY_CONNECTED",
        "That repository is already connected to this workspace.",
      )
    }

    const repo: Repo = {
      id: `${owner}-${name}`,
      name,
      owner,
      visibility: "public",
      url,
      default_branch: "main",
      connected_at: new Date().toISOString(),
    }
    connected = [...connected, repo]
    return HttpResponse.json(repo, { status: 201 })
  }),

  http.get("*/api/repos/:repoId/branches", () =>
    HttpResponse.json(mockBranches),
  ),

  http.get("*/api/repos/:repoId/health", ({ params, request }) => {
    const repoId = params.repoId as string
    if (!mockRepos.some((r) => r.id === repoId)) {
      // Typed, so an envelope missing `code` fails the build rather than
      // silently teaching the frontend that errors have no machine-readable
      // reason on them.
      const notFound: ApiError = {
        detail: "Repo not found",
        code: "NOT_FOUND",
      }
      return HttpResponse.json(notFound, { status: 404 })
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

  http.get("*/api/profiles/active", () => HttpResponse.json(activeProfile)),

  http.put("*/api/profiles/active", async ({ request }) => {
    const body = (await request.json()) as ApplyProfileRequest
    return HttpResponse.json(applyToWorkspace(body))
  }),

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
