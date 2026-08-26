// ────────────────────────────────────────────────────────────────────────────
// THE FAKE BACKEND (MSW request handlers)
//
// Each entry below answers one endpoint the real FastAPI backend will own. MSW
// intercepts `fetch()` at the network layer, so components call `/api/...` and
// never know the response came from here. The same handlers feed three places:
// the dev app, component tests, and Playwright.
//
// DATA vs BEHAVIOUR vs DERIVATION — three files, three jobs:
//
//   scoring.ts   the stored facts, and the FR-11 formula over them
//   fixtures.ts  those facts as contract-shaped payloads, scored under Balanced
//   handlers.ts  (this file) the HTTP surface: status codes, error envelopes,
//                query parameters, and the little bit of mutable server state a
//                fake backend needs (the scan machine, the active profile, the
//                connected-projects list)
//
// STATUS CODES ARE NOT DECORATION. `POST …/scan` answers **202**, not 200,
// because the contract says the work is queued rather than done — and a client
// written against a 200 will one day be surprised. Same for `POST …/scan/…/stop`.
// ────────────────────────────────────────────────────────────────────────────
import { http, HttpResponse } from "msw"
import type {
  ApiError,
  ApplyProfileRequest,
  CategoryWeights,
  ConnectRepoRequest,
  Repo,
  ScanStatus,
  ScoreProfile,
  Session,
} from "@/lib/types"
import { WEIGHT_MAX, WEIGHT_MIN, TRUST_MAX, TRUST_MIN } from "@/lib/types"
import {
  balancedProfile,
  DEMO_REPO_ID,
  mockBranches,
  mockProfiles,
  mockRepos,
  mockSession,
  reportFor,
  UNSCANNED_REPO_ID,
} from "./fixtures"
import { scanHistoryFor } from "./scoring"

// ── error helper ────────────────────────────────────────────────────────────

/**
 * Typed, so an envelope missing `code` fails the build rather than silently
 * teaching the frontend that errors have no machine-readable reason on them.
 */
const fail = (status: number, code: ApiError["code"], detail: string) =>
  HttpResponse.json({ detail, code } satisfies ApiError, { status })

const NOT_FOUND = () => fail(404, "NOT_FOUND", "Not found.")

// ── mutable server state ────────────────────────────────────────────────────
//
// A real backend does not forget what you saved when you press F5, and a mock
// that does is actively misleading: apply a profile, refresh, and the dashboard
// silently goes back to Balanced. MSW's handlers run in the PAGE, not in the
// service worker, so plain module variables die with every navigation.
//
// So the mutable half is mirrored into sessionStorage — per tab, cleared when
// the tab closes, invisible to Node (where `storage()` returns null and the
// module variables are the whole story, which is what the unit tests want).

function storage(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage
  } catch {
    return null // some embedding contexts throw rather than omit it
  }
}

function persist<T>(key: string, value: T): T {
  storage()?.setItem(key, JSON.stringify(value))
  return value
}

function restore<T>(key: string, fallback: T): T {
  const raw = storage()?.getItem(key)
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

const PROJECTS_KEY = "codesage.mock.projects"
const PROFILE_KEY = "codesage.mock.active-profile"

/** Connecting adds to the workspace, so the list is state, not a fixture array. */
let connected: Repo[] = restore(PROJECTS_KEY, [...mockRepos])

/**
 * Applying replaces the workspace's single active profile IN PLACE; profiles are
 * not versioned (contract: "the same row is updated every time").
 */
let activeProfile: ScoreProfile = restore(PROFILE_KEY, balancedProfile)

const defaultBranch = mockBranches.find((b) => b.is_default) ?? mockBranches[0]

function branchInfoFor(name: string | null | undefined) {
  return mockBranches.find((b) => b.name === name) ?? defaultBranch
}

/** A repo id we know about — either seeded or connected during this session. */
const knownRepo = (repoId: string) => connected.find((r) => r.id === repoId)

// ── the scan state machine (in-memory, one running scan per repo) ───────────

const SCAN_STEP = 17 // % added per poll → ~6 polls from 0 to done

/**
 * The pipeline is clone → extract → detect → FINALIZE, and the cancel flag is
 * only read BETWEEN stages — never inside finalize, because a half-written
 * snapshot reads exactly like a complete one (FR-6, DBR-22). Past this progress
 * the mock is "in finalize": Stop is accepted but the scan still completes.
 */
const FINALIZE_AT = 85

const scans = new Map<string, ScanStatus>()

/**
 * Stop only REQUESTS cancellation; the scan keeps reporting "running" until the
 * next poll. Modelled faithfully on purpose — a mock that returned "cancelled"
 * straight from the POST would let the UI skip the polling path the real backend
 * requires, and the bug would only surface on the live site.
 */
const cancelRequested = new Set<string>()

/**
 * The head SHA of the last SUCCESSFUL scan per repo+branch, which is what
 * skip-if-unchanged compares against. Comparing against the last *successful*
 * scan is what stops a cancelled attempt being mistaken for a stored snapshot.
 */
const lastSuccessfulSha = new Map<string, string>()

const scanKey = (repoId: string, branch: string) => `${repoId}@${branch}`

/** A stand-in for a database-generated uuid. */
function uuid(): string {
  return crypto.randomUUID()
}

function idleScan(): ScanStatus {
  return { scan_id: uuid(), phase: "idle", progress: 0 }
}

function tick(repoId: string): ScanStatus {
  const current = scans.get(repoId) ?? idleScan()
  if (current.phase !== "running") return current

  const now = new Date().toISOString()

  // The worker reads the cancel flag between pipeline stages and stops at the
  // first boundary. Progress freezes where it was: the scan did not finish.
  if (cancelRequested.has(repoId)) {
    cancelRequested.delete(repoId)
    if (current.progress < FINALIZE_AT) {
      const cancelled: ScanStatus = {
        ...current,
        phase: "cancelled",
        finished_at: now,
      }
      scans.set(repoId, cancelled)
      return cancelled
    }
    // Too late — finalization has begun, so the flag is dropped and the scan
    // runs to `done` below. The user pressed Stop and still gets a result.
  }

  const progress = Math.min(100, current.progress + SCAN_STEP)
  if (progress < 100) {
    const next: ScanStatus = { ...current, progress }
    scans.set(repoId, next)
    return next
  }

  const done: ScanStatus = {
    ...current,
    phase: "done",
    progress: 100,
    finished_at: now,
  }
  scans.set(repoId, done)
  if (done.branch && done.commit_sha) {
    lastSuccessfulSha.set(scanKey(repoId, done.branch), done.commit_sha)
  }
  return done
}

export function resetMockBackend() {
  scans.clear()
  cancelRequested.clear()
  lastSuccessfulSha.clear()
  activeProfile = balancedProfile
  connected = [...mockRepos]
  storage()?.removeItem(PROJECTS_KEY)
  storage()?.removeItem(PROFILE_KEY)
}

// ── profile application ─────────────────────────────────────────────────────

const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n))

const WEIGHT_KEYS: (keyof CategoryWeights)[] = [
  "security",
  "code_design",
  "requirement",
  "documentation",
  "test",
]

/**
 * A MALFORMED body is a different thing from an out-of-range one: the first is
 * `422`, the second is clamped and accepted with `200`. The contract is explicit
 * about the distinction, so the mock has to be too — otherwise the UI never
 * learns that a 422 exists.
 */
function validationErrors(body: unknown): { field: string; detail: string }[] {
  const errors: { field: string; detail: string }[] = []
  if (typeof body !== "object" || body === null) {
    return [{ field: "body", detail: "Input should be a valid object." }]
  }
  const b = body as Record<string, unknown>

  if (typeof b.weights !== "object" || b.weights === null) {
    errors.push({ field: "weights", detail: "Input should be a valid object." })
  } else {
    const w = b.weights as Record<string, unknown>
    for (const key of WEIGHT_KEYS) {
      if (typeof w[key] !== "number" || Number.isNaN(w[key])) {
        errors.push({
          field: `weights.${key}`,
          detail: "Input should be a valid number.",
        })
      }
    }
    // Exactly five, no more: an invented sixth category is rejected at the edge
    // rather than producing a missing-key failure inside the scoring engine.
    for (const key of Object.keys(w)) {
      if (!WEIGHT_KEYS.includes(key as keyof CategoryWeights)) {
        errors.push({ field: `weights.${key}`, detail: "Unknown category." })
      }
    }
  }

  if (typeof b.trust_s !== "number" || Number.isNaN(b.trust_s)) {
    errors.push({ field: "trust_s", detail: "Input should be a valid number." })
  }
  return errors
}

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
  return persist(PROFILE_KEY, activeProfile)
}

// ── the endpoints ───────────────────────────────────────────────────────────
//
// Three contract endpoints are deliberately NOT in `handlers` below. They are
// absences by design, not gaps somebody forgot:
//
//   GET  /api/auth/login     navigations, not fetches. The browser has to leave
//   GET  /api/auth/callback  the page for OIDC, so a service worker never sees
//   POST /api/auth/logout    them at all.
//
// `GET /api/auth/session` IS mockable, but only for E2E — see `authHandlers`.

export const handlers = [
  // ── projects ──────────────────────────────────────────────────────────────
  http.get("*/api/projects", () => HttpResponse.json(connected)),

  // Connect a repository (FR-3). The four failure codes below are the ones the
  // contract names, and each needs its own message on screen — "400 Bad Request"
  // tells a user who pasted their own private repo nothing about what to do next.
  http.post("*/api/projects", async ({ request }) => {
    const body = (await request
      .json()
      .catch(() => null)) as ConnectRepoRequest | null
    if (!body || typeof body.url !== "string") {
      return HttpResponse.json(
        {
          detail: "The request could not be processed.",
          code: "VALIDATION_FAILED",
          errors: [{ field: "url", detail: "Input should be a valid string." }],
        } satisfies ApiError,
        { status: 422 },
      )
    }

    const invalid = () =>
      fail(
        400,
        "INVALID_REPOSITORY_URL",
        "That does not look like a repository URL.",
      )

    let parsed: URL
    try {
      parsed = new URL(body.url)
    } catch {
      return invalid()
    }
    if (parsed.hostname !== "github.com") return invalid()

    const segments = parsed.pathname
      .replace(/\.git$/, "")
      .split("/")
      .filter(Boolean)
    if (segments.length < 2) return invalid()
    const [owner, name] = segments

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
    if (name.startsWith("ratelimited-")) {
      return fail(429, "RATE_LIMITED", "Too many requests. Try again shortly.")
    }
    if (name.startsWith("upstream-")) {
      return fail(
        503,
        "UPSTREAM_UNAVAILABLE",
        "An external service is temporarily unavailable.",
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
      id: uuid(),
      name,
      owner,
      visibility: "public", // v1.0 accepts public repositories only
      url: body.url,
      default_branch: "main",
      connected_at: new Date().toISOString(),
      // No latest_health: freshly connected, never scanned.
    }
    connected = persist(PROJECTS_KEY, [...connected, repo])
    return HttpResponse.json(repo, { status: 201 })
  }),

  // ── branches ──────────────────────────────────────────────────────────────
  http.get("*/api/repos/:repoId/branches", ({ params }) => {
    if (!knownRepo(params.repoId as string)) return NOT_FOUND()
    return HttpResponse.json(mockBranches)
  }),

  // ── dashboard ─────────────────────────────────────────────────────────────
  http.get("*/api/repos/:repoId/health", ({ params, request }) => {
    const repoId = params.repoId as string
    const repo = knownRepo(repoId)
    if (!repo) return NOT_FOUND()

    // "No repository, no such branch, or the branch has never been scanned
    // successfully. The client renders the empty state, not an error."
    if (repoId === UNSCANNED_REPO_ID) {
      return fail(404, "NOT_FOUND", "This branch has not been scanned yet.")
    }

    const url = new URL(request.url)
    const branch = url.searchParams.get("branch") ?? defaultBranch.name
    if (!mockBranches.some((b) => b.name === branch)) {
      return fail(404, "NOT_FOUND", "No such branch.")
    }

    return HttpResponse.json(
      reportFor(
        repoId,
        branch,
        branchInfoFor(branch).is_default,
        activeProfile,
        url.searchParams.get("snapshot_id") ?? undefined,
      ),
    )
  }),

  // Scan history (FR-19). Derived under the active profile too, which is why
  // switching profiles redraws this list as well as the dashboard.
  http.get("*/api/repos/:repoId/scans", ({ params, request }) => {
    const repoId = params.repoId as string
    if (!knownRepo(repoId)) return NOT_FOUND()
    if (repoId === UNSCANNED_REPO_ID) return HttpResponse.json([])

    const branch = new URL(request.url).searchParams.get("branch")
    const info = branchInfoFor(branch)
    const scale =
      (repoId === DEMO_REPO_ID ? 1 : 1.7) * (info.is_default ? 1 : 1.2)
    return HttpResponse.json(scanHistoryFor(activeProfile, info.name, scale))
  }),

  // ── profiles ──────────────────────────────────────────────────────────────
  http.get("*/api/profiles", () => HttpResponse.json(mockProfiles)),

  http.get("*/api/profiles/active", () => HttpResponse.json(activeProfile)),

  http.put("*/api/profiles/active", async ({ request }) => {
    const body = await request.json().catch(() => null)
    const errors = validationErrors(body)
    if (errors.length > 0) {
      return HttpResponse.json(
        {
          detail: "The request could not be processed.",
          code: "VALIDATION_FAILED",
          errors,
        } satisfies ApiError,
        { status: 422 },
      )
    }
    return HttpResponse.json(applyToWorkspace(body as ApplyProfileRequest))
  }),

  // ── scan lifecycle ────────────────────────────────────────────────────────
  http.post("*/api/repos/:repoId/scan", async ({ params, request }) => {
    const repoId = params.repoId as string
    if (!knownRepo(repoId)) return NOT_FOUND()

    const body = (await request.json().catch(() => null)) as {
      branch?: string
    } | null
    if (!body || typeof body.branch !== "string") {
      return HttpResponse.json(
        {
          detail: "The request could not be processed.",
          code: "VALIDATION_FAILED",
          errors: [
            { field: "branch", detail: "Input should be a valid string." },
          ],
        } satisfies ApiError,
        { status: 422 },
      )
    }

    const current = scans.get(repoId)
    if (current?.phase === "running" || current?.phase === "queued") {
      return fail(
        409,
        "SCAN_ALREADY_RUNNING",
        "A scan is already running for this branch.",
      )
    }

    const info = branchInfoFor(body.branch)
    const head = info.head_commit_sha ?? null
    const now = new Date().toISOString()

    // Skip-if-unchanged: the head SHA matches the last SUCCESSFUL scan of this
    // branch, so nothing is queued and the existing scan_id comes straight back
    // as `done`. 202 either way — the client cannot tell from the status code,
    // only from the phase, which is exactly what the contract describes.
    const seen = lastSuccessfulSha.get(scanKey(repoId, info.name))
    if (head && seen === head) {
      const skipped: ScanStatus = {
        scan_id: uuid(),
        phase: "done",
        progress: 100,
        branch: info.name,
        commit_sha: head,
        finished_at: now,
      }
      scans.set(repoId, skipped)
      return HttpResponse.json(skipped, { status: 202 })
    }

    const started: ScanStatus = {
      scan_id: uuid(),
      phase: "running",
      progress: 0,
      branch: info.name,
      commit_sha: head,
      started_at: now,
    }
    scans.set(repoId, started)
    return HttpResponse.json(started, { status: 202 })
  }),

  http.get("*/api/repos/:repoId/scan/:scanId", ({ params }) => {
    const repoId = params.repoId as string
    if (!knownRepo(repoId)) return NOT_FOUND()
    if (!scans.has(repoId)) return NOT_FOUND()
    return HttpResponse.json(tick(repoId))
  }),

  http.post("*/api/repos/:repoId/scan/:scanId/stop", ({ params }) => {
    const repoId = params.repoId as string
    if (!knownRepo(repoId)) return NOT_FOUND()

    const current = scans.get(repoId)
    if (!current) return NOT_FOUND()

    // "The scan already reached a terminal phase" — you cannot cancel what is
    // no longer running, and saying so is more useful than a silent 202.
    if (current.phase !== "running" && current.phase !== "queued") {
      return fail(
        409,
        "SCAN_NOT_CANCELLABLE",
        "This scan can no longer be cancelled.",
      )
    }

    // 202: the flag is set and the phase comes back UNCHANGED. The client learns
    // the scan really stopped from the next poll, not from this response.
    cancelRequested.add(repoId)
    return HttpResponse.json(current, { status: 202 })
  }),

  // ── system ────────────────────────────────────────────────────────────────
  http.get("*/api/healthz", () => HttpResponse.json({ status: "ok" })),
]

// ── auth, for E2E only ──────────────────────────────────────────────────────

/**
 * `GET /api/auth/session` is NOT in `handlers`, and that is deliberate: with
 * mocking on in dev, MSW passes it straight through to the real API, which is
 * the only way a real Asgardeo sign-in can be tested locally.
 *
 * Playwright has the opposite need — there is no API running, and no headless
 * browser is going to complete an interactive OIDC consent screen. So these are
 * kept separate and switched on only when `NEXT_PUBLIC_API_MOCKING=e2e`.
 * See `browser.ts`.
 */
export const authHandlers = [
  http.get("*/api/auth/session", ({ cookies }) => {
    // The real API answers 401 when the session cookie is missing, and the app
    // rail redirects to /login on that — the behaviour a route-protection test
    // needs to be able to trigger.
    const name =
      process.env.NEXT_PUBLIC_SESSION_COOKIE_NAME ?? "codesage_session"
    if (!cookies[name]) {
      return fail(401, "NOT_AUTHENTICATED", "Sign in to continue.")
    }
    return HttpResponse.json(mockSession satisfies Session)
  }),
]
