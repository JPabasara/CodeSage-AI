// The fake backend (MSW request handlers).
//
// Each entry answers one endpoint the real API owns. MSW intercepts `fetch()` at
// the network layer, so components call `/api/...` and never know the response
// came from here. The same handlers feed the dev app, component tests and
// Playwright.
//
//   scoring.ts   the stored facts, and the formula over them
//   fixtures.ts  those facts as payloads, scored under Balanced
//   handlers.ts  the HTTP surface: status codes, error envelopes, query
//                parameters, and the little mutable state a fake backend needs
//
// Status codes are not decoration: `POST …/scan` answers 202 because the work is
// queued rather than done, and a client written against a 200 will be surprised.
import { http, HttpResponse } from "msw"
import type {
  ApiError,
  ApplyProfileRequest,
  CategoryWeights,
  ConnectRepoRequest,
  CreateInvitationRequest,
  CreateProfileRequest,
  CreateWorkspaceRequest,
  Invitation,
  Member,
  ProjectProfile,
  Repo,
  Role,
  ScanStatus,
  ScoreProfile,
  Session,
  UpdateProfileRequest,
  UpdateWorkspaceRequest,
  Workspace,
} from "@/lib/types"
import {
  MAX_CUSTOM_PROFILES,
  WEIGHT_MAX,
  WEIGHT_MIN,
  TRUST_MAX,
  TRUST_MIN,
} from "@/lib/types"
import {
  balancedProfile,
  DEMO_REPO_ID,
  INVITED_WORKSPACE_ID,
  MOCK_INVITATION_TOKEN,
  mockBranches,
  mockInvitations,
  mockMembers,
  mockProfiles,
  mockRepos,
  mockSession,
  mockSessionViewer,
  mockWorkspaces,
  nimbusRepos,
  PERMISSIONS_BY_ROLE,
  reportFor,
  UNSCANNED_REPO_ID,
  WORKSPACE_ID,
} from "./fixtures"
import { scanHistoryFor } from "./scoring"

// ── error helper ────────────────────────────────────────────────────────────

/** Typed, so an envelope missing `code` fails the build. */
const fail = (status: number, code: ApiError["code"], detail: string) =>
  HttpResponse.json({ detail, code } satisfies ApiError, { status })

const NOT_FOUND = () => fail(404, "NOT_FOUND", "Not found.")

// ── mutable server state ────────────────────────────────────────────────────
//
// MSW handlers run in the page, not the service worker, so module variables die
// on every navigation — apply a profile, refresh, and it silently reverts. The
// mutable half is mirrored into sessionStorage: per tab, and invisible to Node,
// where the module variables are the whole story.

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

const WORKSPACES_KEY = "codesage.mock.workspaces"
const ACTIVE_WORKSPACE_KEY = "codesage.mock.active-workspace"

/**
 * Everything one workspace owns.
 *
 * Kept as a record per workspace rather than a set of global variables because
 * the whole point of the second workspace is that switching to it must not show
 * the first one's projects, profiles or assignments — a bug that is only
 * catchable if the mock really holds two separate sets.
 */
interface WorkspaceRecord {
  name: string
  description: string | null
  website_url: string | null
  role: Role
  created_at: string | null
  updated_at: string | null
  member_count: number
  members: Member[]
  invitations: Invitation[]
  repos: Repo[]
  pool: StoredProfile[]
  defaultProfileId: string
  assignments: Record<string, string>
}

function seedWorkspaces(): Record<string, WorkspaceRecord> {
  const seeded: Record<string, WorkspaceRecord> = {}
  for (const workspace of mockWorkspaces) {
    const isPrimary = workspace.workspace_id === WORKSPACE_ID
    seeded[workspace.workspace_id] = {
      name: workspace.name,
      description: workspace.description ?? null,
      website_url: workspace.website_url ?? null,
      role: workspace.role,
      created_at: workspace.created_at ?? null,
      updated_at: workspace.updated_at ?? null,
      member_count: workspace.member_count ?? 1,
      // Copies: a test that deactivates someone must not edit the fixture.
      members: structuredClone(mockMembers[workspace.workspace_id] ?? []),
      invitations: structuredClone(
        mockInvitations[workspace.workspace_id] ?? [],
      ),
      repos: isPrimary ? [...mockRepos] : [...nimbusRepos],
      pool: seedPool(),
      defaultProfileId: balancedProfile.id,
      assignments: {},
    }
  }
  return seeded
}

/**
 * E2E only: start signed in with no workspace at all, which is the state
 * onboarding exists for and the one state a seeded mock can never reach on its
 * own. Read once, at module load, and only until a workspace is actually
 * created — after that the persisted value is the answer.
 */
function startsWithoutWorkspace(): boolean {
  if (typeof document === "undefined") return false
  return document.cookie.includes("codesage_e2e_workspace=none")
}

let workspaceRecords: Record<string, WorkspaceRecord> = restore(
  WORKSPACES_KEY,
  seedWorkspaces(),
)

// A tab restored from before members existed: seed them rather than crash.
for (const [id, record] of Object.entries(workspaceRecords)) {
  record.members ??= structuredClone(mockMembers[id] ?? [])
  record.invitations ??= structuredClone(mockInvitations[id] ?? [])
}

let activeWorkspaceId: string | null = restore(
  ACTIVE_WORKSPACE_KEY,
  startsWithoutWorkspace() ? null : WORKSPACE_ID,
)

// The active workspace's state, unpacked so every handler below reads it the
// way it always has. `loadWorkspace` is the only place that swaps them, which
// is what makes a switch atomic rather than four separate assignments a handler
// could half-miss.
let connected: Repo[] = []

/**
 * The half of a profile the workspace actually stores.
 *
 * `is_active`, `usage_count` and `editable` are deliberately not in here: they
 * are facts about the pool, not about the row, and storing them would let the
 * default flag drift on to two profiles at once. They are derived in `out()` on
 * every read, exactly as the API derives them.
 */
type StoredProfile = Pick<
  ScoreProfile,
  "id" | "name" | "weights" | "trust_s" | "is_preset"
>

// A declaration, not a const: `seedWorkspaces` above calls it while the module
// is still initialising, and an arrow assigned to a const is not yet there.
function seedPool(): StoredProfile[] {
  return mockProfiles.map(({ id, name, weights, trust_s, is_preset }) => ({
    id,
    name,
    weights,
    trust_s,
    is_preset,
  }))
}

/** Three built-ins, then whatever this workspace has authored — at most five. */
let pool: StoredProfile[] = []

/** One pointer per workspace, which is why "exactly one default" needs no rule. */
let defaultProfileId: string = balancedProfile.id

/** repo id → the profile it names explicitly. Absent means it inherits. */
let assignments: Record<string, string> = {}

/** Fold the unpacked state back into the record it came from. */
function packWorkspace() {
  const record = activeWorkspaceId
    ? workspaceRecords[activeWorkspaceId]
    : undefined
  if (!record) return
  record.repos = connected
  record.pool = pool
  record.defaultProfileId = defaultProfileId
  record.assignments = assignments
}

/** Read the active workspace's record into the variables the handlers use. */
function unpackWorkspace() {
  const record = activeWorkspaceId
    ? workspaceRecords[activeWorkspaceId]
    : undefined
  connected = record?.repos ?? []
  pool = record?.pool ?? []
  defaultProfileId = record?.defaultProfileId ?? balancedProfile.id
  assignments = record?.assignments ?? {}
}

/** Make `workspaceId` the one every other handler reads. */
function loadWorkspace(workspaceId: string | null) {
  packWorkspace()
  activeWorkspaceId = workspaceId
  unpackWorkspace()
}

function persistState() {
  packWorkspace()
  persist(WORKSPACES_KEY, workspaceRecords)
  persist(ACTIVE_WORKSPACE_KEY, activeWorkspaceId)
}

// Unpack rather than load: at module start there is nothing to fold back yet,
// and packing first would write these empty defaults over the seeded workspace.
unpackWorkspace()

const defaultBranch = mockBranches.find((b) => b.is_default) ?? mockBranches[0]

function branchInfoFor(name: string | null | undefined) {
  return mockBranches.find((b) => b.name === name) ?? defaultBranch
}

/** A repo id we know about — either seeded or connected during this session. */
const knownRepo = (repoId: string) => connected.find((r) => r.id === repoId)

// ── the scan state machine (in-memory, one running scan per repo) ───────────

const SCAN_STEP = 17 // % added per poll → ~6 polls from 0 to done

/**
 * The pipeline is clone → extract → detect → finalize, and the cancel flag is
 * read only between stages — never inside finalize, because a half-written
 * snapshot reads exactly like a complete one. Past this progress Stop is
 * accepted but the scan still completes.
 */
const FINALIZE_AT = 85

const scans = new Map<string, ScanStatus>()

/**
 * Stop only requests cancellation; the scan keeps reporting "running" until the
 * next poll. Returning "cancelled" straight from the POST would let the UI skip
 * the polling path the real backend needs.
 */
const cancelRequested = new Set<string>()

/**
 * Head SHA of the last successful scan per repo+branch — what skip-if-unchanged
 * compares against. Using the last *successful* one stops a cancelled attempt
 * being mistaken for a stored snapshot.
 */
const lastSuccessfulSha = new Map<string, string>()

/**
 * How many health requests answer 503 SCORE_PENDING once a scan completes.
 *
 * The real API stores the snapshot and scores it in a background task, so there
 * is a genuine window where the snapshot exists and its score does not. Faking
 * that window is the point: without it the client's pending path is dead code in
 * dev and in Playwright, and the first time anyone sees it is the demo. Two asks
 * (~4s at the client's poll interval) is long enough to read the message.
 */
const PENDING_ASKS_AFTER_SCAN = 2

/** repo@branch → how many more health requests still answer SCORE_PENDING. */
const pendingScores = new Map<string, number>()

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
  if (done.branch) {
    // The snapshot is stored the moment the scan finishes; the score is not.
    pendingScores.set(scanKey(repoId, done.branch), PENDING_ASKS_AFTER_SCAN)
    if (done.commit_sha) {
      lastSuccessfulSha.set(scanKey(repoId, done.branch), done.commit_sha)
    }
  }
  return done
}

export function resetMockBackend() {
  scans.clear()
  cancelRequested.clear()
  lastSuccessfulSha.clear()
  pendingScores.clear()
  // Cleared first: `loadWorkspace` folds the current state back into its record
  // on the way out, which would copy the finished test's projects and profiles
  // straight into the freshly seeded ones.
  activeWorkspaceId = null
  workspaceRecords = seedWorkspaces()
  loadWorkspace(WORKSPACE_ID)
  storage()?.removeItem(WORKSPACES_KEY)
  storage()?.removeItem(ACTIVE_WORKSPACE_KEY)
}

// ── the workspace profile pool ──────────────────────────────────────────────

const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n))

const WEIGHT_KEYS: (keyof CategoryWeights)[] = [
  "security",
  "code_design",
  "requirement",
  "documentation",
  "test",
]

const clampWeights = (weights: CategoryWeights): CategoryWeights => ({
  security: clamp(weights.security, WEIGHT_MIN, WEIGHT_MAX),
  code_design: clamp(weights.code_design, WEIGHT_MIN, WEIGHT_MAX),
  requirement: clamp(weights.requirement, WEIGHT_MIN, WEIGHT_MAX),
  documentation: clamp(weights.documentation, WEIGHT_MIN, WEIGHT_MAX),
  test: clamp(weights.test, WEIGHT_MIN, WEIGHT_MAX),
})

/** How many projects name this profile explicitly. The default is not counted. */
const usageCount = (profileId: string) =>
  Object.values(assignments).filter((id) => id === profileId).length

/** A stored row as the wire shows it, with the pool-level facts derived. */
function out(stored: StoredProfile): ScoreProfile {
  return {
    ...stored,
    is_active: stored.id === defaultProfileId,
    usage_count: usageCount(stored.id),
    // The three built-ins are refused every write by the database itself; the
    // flag only saves the client a round trip to find that out.
    editable: !stored.is_preset,
  }
}

const customProfiles = () => pool.filter((profile) => !profile.is_preset)

/** Built-ins in their seeded order first, then the workspace's own by name. */
function poolOut(): ScoreProfile[] {
  const builtIns = pool.filter((profile) => profile.is_preset)
  const custom = [...customProfiles()].sort((a, b) =>
    a.name.localeCompare(b.name),
  )
  return [...builtIns, ...custom].map(out)
}

const findProfile = (profileId: string | undefined) =>
  profileId ? pool.find((profile) => profile.id === profileId) : undefined

/** The workspace default. One always exists, so this never falls through. */
const defaultProfile = (): StoredProfile =>
  findProfile(defaultProfileId) ?? pool[0]

/**
 * The profile one repository is really scored with: its override if it has one,
 * otherwise the workspace default. Every derived read — the dashboard and the
 * scan history — goes through here, which is what makes an override visible
 * everywhere at once.
 */
const effectiveFor = (repoId: string): ScoreProfile =>
  out(findProfile(assignments[repoId]) ?? defaultProfile())

function projectProfileOut(repoId: string): ProjectProfile {
  const override = findProfile(assignments[repoId])
  const workspaceDefault = out(defaultProfile())
  return {
    repo_id: repoId,
    inherited: !override,
    effective: override ? out(override) : workspaceDefault,
    workspace_default: workspaceDefault,
    // Null exactly when `inherited` is true — the two cannot disagree here
    // because both are read off the same lookup.
    override: override ? out(override) : null,
  }
}

/** Is the name free, after the same trim and lower-case the database applies? */
function nameIsTaken(name: string, excludingId?: string) {
  const normalized = name.trim().toLowerCase()
  return pool.some(
    (profile) =>
      profile.id !== excludingId &&
      profile.name.trim().toLowerCase() === normalized,
  )
}

const nameConflict = () =>
  fail(
    409,
    "PROFILE_NAME_CONFLICT",
    "Another profile in this workspace already uses that name.",
  )

const builtInRefused = () =>
  fail(
    409,
    "PROFILE_BUILT_IN",
    "Built-in profiles cannot be edited or deleted. Clone one instead.",
  )

const invalid = (errors: { field: string; detail: string }[]) =>
  HttpResponse.json(
    {
      detail: "The request could not be processed.",
      code: "VALIDATION_FAILED",
      errors,
    } satisfies ApiError,
    { status: 422 },
  )

/**
 * A malformed body is not the same as an out-of-range one: the first is 422, the
 * second is clamped and accepted with 200. Keeping both is what teaches the UI
 * that a 422 exists.
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
 * The same rules for a PATCH, where every field is optional.
 *
 * `null` is not the same as omitted and is rejected: there is no profile with no
 * security weight, so a client that sends one is confused about what it is
 * asking for rather than asking for a default.
 */
function patchErrors(body: unknown): { field: string; detail: string }[] {
  const errors: { field: string; detail: string }[] = []
  if (typeof body !== "object" || body === null) {
    return [{ field: "body", detail: "Input should be a valid object." }]
  }
  const b = body as Record<string, unknown>

  if ("name" in b && (typeof b.name !== "string" || b.name.trim() === "")) {
    errors.push({ field: "name", detail: "Input should be a valid string." })
  }
  if ("weights" in b) {
    if (typeof b.weights !== "object" || b.weights === null) {
      errors.push({
        field: "weights",
        detail: "Input should be a valid object.",
      })
    } else {
      for (const [key, value] of Object.entries(
        b.weights as Record<string, unknown>,
      )) {
        if (!WEIGHT_KEYS.includes(key as keyof CategoryWeights)) {
          errors.push({ field: `weights.${key}`, detail: "Unknown category." })
        } else if (typeof value !== "number" || Number.isNaN(value)) {
          errors.push({
            field: `weights.${key}`,
            detail: "Input should be a valid number.",
          })
        }
      }
    }
  }
  if (
    "trust_s" in b &&
    (typeof b.trust_s !== "number" || Number.isNaN(b.trust_s))
  ) {
    errors.push({ field: "trust_s", detail: "Input should be a valid number." })
  }
  return errors
}

/**
 * The built-in these exact numbers are, if they still are one.
 *
 * Matched on values rather than on the name the client sent: once a slider has
 * moved the profile is no longer that preset, and a built-in row cannot be
 * written to anyway.
 */
function matchingBuiltIn(
  weights: CategoryWeights,
  trustS: number,
): StoredProfile | undefined {
  const near = (x: number, y: number) => Math.abs(x - y) < 1e-9
  return pool.find(
    (profile) =>
      profile.is_preset &&
      near(profile.trust_s, trustS) &&
      WEIGHT_KEYS.every((key) => near(profile.weights[key], weights[key])),
  )
}

/**
 * Where the superseded `PUT /api/profiles/active` writes its numbers.
 *
 * It re-uses a row rather than adding one, because that endpoint is the pre-pool
 * "the workspace has a profile and Apply replaces it" contract: creating a row
 * per Apply would march a workspace into the five-custom limit through a UI that
 * never offered to name or keep them.
 */
function legacyCustomTarget(): StoredProfile {
  const current = defaultProfile()
  if (!current.is_preset) return current
  const existing = customProfiles()
  if (existing.length > 0) return existing[existing.length - 1]
  const created: StoredProfile = {
    id: uuid(),
    name: "Custom",
    weights: balancedProfile.weights,
    trust_s: balancedProfile.trust_s,
    is_preset: false,
  }
  pool = [...pool, created]
  return created
}

/**
 * Clamp these six numbers and make them the workspace default.
 *
 * Values that are exactly a built-in's SELECT that built-in rather than writing
 * to it; anything else is written to the workspace's own custom row.
 */
function applyToWorkspace(body: ApplyProfileRequest): ScoreProfile {
  const weights = clampWeights(body.weights)
  const trustS = clamp(body.trust_s, TRUST_MIN, TRUST_MAX)

  let target = matchingBuiltIn(weights, trustS)
  if (!target) {
    target = legacyCustomTarget()
    target.name = body.name ?? "Custom"
    target.weights = weights
    target.trust_s = trustS
  }

  defaultProfileId = target.id
  persistState()
  return out(target)
}

// ── the endpoints ───────────────────────────────────────────────────────────
//
// Three auth endpoints are deliberately absent: /login, /callback and /logout are
// navigations, not fetches, so a service worker never sees them. Only
// /api/auth/session is mockable, and only for E2E — see `authHandlers`.

/** One workspace as the wire shows it, with the session-dependent bits derived. */
function workspaceOut(workspaceId: string): Workspace {
  const record = workspaceRecords[workspaceId]
  const isActive = workspaceId === activeWorkspaceId
  return {
    workspace_id: workspaceId,
    name: record.name,
    description: record.description,
    website_url: record.website_url,
    role: record.role,
    is_active: isActive,
    created_at: record.created_at,
    updated_at: record.updated_at,
    // Derived on read, never stored: both change whenever a project or a member
    // does, and a stored copy would be wrong more often than right.
    project_count: isActive ? connected.length : record.repos.length,
    // Active members only: pending invitations and deactivated people are
    // not counted, which is what the contract says.
    member_count: record.members
      ? record.members.filter((m) => m.status === "active").length
      : record.member_count,
  }
}

/** The signed-in mock user's own membership row, in a workspace just made. */
function creatorMembership(role: Role): Member {
  return {
    membership_id: uuid(),
    user_id: mockSession.user_id,
    email: mockSession.email ?? null,
    name: mockSession.name ?? null,
    role,
    status: "active",
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const ROLES: Role[] = ["org-admin", "manager", "developer", "viewer"]

/** Every member write needs `member:manage`, which only an org-admin holds. */
function forbidUnlessAdmin() {
  const record = activeWorkspaceId ? workspaceRecords[activeWorkspaceId] : null
  if (record?.role === "org-admin") return null
  return fail(403, "FORBIDDEN", "Only an org-admin can manage members.")
}

/** Demoting or deactivating the only active org-admin would orphan the workspace. */
function isLastAdmin(members: Member[], target: Member) {
  if (target.status !== "active" || target.role !== "org-admin") return false
  return (
    members.filter((m) => m.status === "active" && m.role === "org-admin")
      .length === 1
  )
}

const workspaceIds = () => Object.keys(workspaceRecords)

/** A website that is not an http(s) URL is a 422, not a silently stored string. */
function websiteErrors(value: unknown): { field: string; detail: string }[] {
  if (value === undefined || value === null) return []
  if (typeof value !== "string") {
    return [{ field: "website_url", detail: "Input should be a valid URL." }]
  }
  if (value.trim() === "") return []
  try {
    const url = new URL(value)
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return [{ field: "website_url", detail: "Input should be a valid URL." }]
    }
  } catch {
    return [{ field: "website_url", detail: "Input should be a valid URL." }]
  }
  return []
}

/** Whitespace-only text is stored as absent rather than as content. */
const trimmedOrNull = (value: string | null | undefined) => {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

/**
 * Endpoints that answer without a workspace. Everything else is scoped to one,
 * and answers 409 until there is one to be scoped to — which is what sends a
 * brand-new user to onboarding rather than to an empty-looking app.
 */
const WORKSPACE_FREE = [
  "/api/auth/session",
  "/api/auth/workspaces",
  "/api/invitations/accept",
  "/api/healthz",
]

export const handlers = [
  // Registered first on purpose: MSW takes the first handler that matches, and
  // returning nothing falls through to the real one below.
  http.all("*/api/*", ({ request }) => {
    if (activeWorkspaceId) return
    const path = new URL(request.url).pathname
    if (WORKSPACE_FREE.some((prefix) => path.startsWith(prefix))) return
    return fail(
      409,
      "WORKSPACE_REQUIRED",
      "Create or join a workspace before using this.",
    )
  }),

  // ── workspaces ────────────────────────────────────────────────────────────
  http.get("*/api/auth/workspaces", () =>
    // Reachable without a workspace, where it is an empty array — the state
    // onboarding exists for, not an error.
    HttpResponse.json(workspaceIds().map(workspaceOut)),
  ),

  http.post("*/api/auth/workspaces", async ({ request }) => {
    const body = (await request
      .json()
      .catch(() => null)) as Partial<CreateWorkspaceRequest> | null
    const errors = websiteErrors(body?.website_url)
    if (typeof body?.name !== "string" || body.name.trim() === "") {
      errors.push({ field: "name", detail: "Input should be a valid string." })
    }
    if (errors.length > 0 || !body?.name) return invalid(errors)

    const now = new Date().toISOString()
    const workspaceId = uuid()
    workspaceRecords = {
      ...workspaceRecords,
      [workspaceId]: {
        name: body.name.trim(),
        description: trimmedOrNull(body.description),
        website_url: trimmedOrNull(body.website_url),
        // The creator is its org-admin, in one transaction with the workspace.
        role: "org-admin",
        created_at: now,
        updated_at: now,
        member_count: 1,
        members: [creatorMembership("org-admin")],
        invitations: [],
        // Genuinely empty: no repository is created, and the Projects page
        // says so rather than inventing a demo one.
        repos: [],
        pool: seedPool(),
        defaultProfileId: balancedProfile.id,
        assignments: {},
      },
    }
    loadWorkspace(workspaceId)
    persistState()
    return HttpResponse.json(workspaceOut(workspaceId), { status: 201 })
  }),

  http.put("*/api/auth/workspaces/active", async ({ request }) => {
    const body = (await request.json().catch(() => null)) as {
      workspace_id?: unknown
    } | null
    if (typeof body?.workspace_id !== "string") {
      return invalid([
        { field: "workspace_id", detail: "Input should be a valid UUID." },
      ])
    }
    // A membership that is missing, inactive, invited or someone else's all
    // answer the same 404: which of those it is, is not ours to reveal.
    if (!workspaceRecords[body.workspace_id]) return NOT_FOUND()

    loadWorkspace(body.workspace_id)
    persistState()
    return HttpResponse.json(workspaceOut(body.workspace_id))
  }),

  http.get("*/api/auth/workspaces/:workspaceId", ({ params }) => {
    const workspaceId = params.workspaceId as string
    // Only the ACTIVE workspace is readable. Another one you belong to is a 404:
    // the session binds one workspace, and reading past it would defeat the
    // isolation every other endpoint depends on.
    if (workspaceId !== activeWorkspaceId) return NOT_FOUND()
    return HttpResponse.json(workspaceOut(workspaceId))
  }),

  http.patch(
    "*/api/auth/workspaces/:workspaceId",
    async ({ params, request }) => {
      const workspaceId = params.workspaceId as string
      if (workspaceId !== activeWorkspaceId) return NOT_FOUND()
      const record = workspaceRecords[workspaceId]
      if (record.role !== "org-admin") {
        return fail(
          403,
          "FORBIDDEN",
          "Only an org-admin can change workspace settings.",
        )
      }

      const body = (await request
        .json()
        .catch(() => null)) as Partial<UpdateWorkspaceRequest> | null
      if (body === null) {
        return invalid([
          { field: "body", detail: "Input should be a valid object." },
        ])
      }
      const errors = websiteErrors(body.website_url)
      if (
        "name" in body &&
        (typeof body.name !== "string" || body.name.trim() === "")
      ) {
        errors.push({
          field: "name",
          detail: "Input should be a valid string.",
        })
      }
      if (errors.length > 0) return invalid(errors)

      // Partial: an omitted field is left alone, and an explicit null clears it.
      // Collapsing those two would make "remove the description" unexpressible.
      if (body.name !== undefined) record.name = body.name.trim()
      if ("description" in body) {
        record.description = trimmedOrNull(body.description)
      }
      if ("website_url" in body) {
        record.website_url = trimmedOrNull(body.website_url)
      }
      record.updated_at = new Date().toISOString()
      persistState()
      return HttpResponse.json(workspaceOut(workspaceId))
    },
  ),

  // ── members & invitations ─────────────────────────────────────────────────
  http.get("*/api/members", () => {
    const record = workspaceRecords[activeWorkspaceId as string]
    return HttpResponse.json({
      members: record.members ?? [],
      pending_invitations: record.invitations ?? [],
    })
  }),

  http.post("*/api/invitations/accept", async ({ request }) => {
    const body = (await request.json().catch(() => null)) as {
      token?: unknown
    } | null
    // One answer for every kind of unusable token, as on the real API. The
    // seeded token works once: after that its workspace is already joined.
    if (
      body?.token !== MOCK_INVITATION_TOKEN ||
      workspaceRecords[INVITED_WORKSPACE_ID]
    ) {
      return NOT_FOUND()
    }
    const now = new Date().toISOString()
    const membership = creatorMembership("developer")
    workspaceRecords = {
      ...workspaceRecords,
      [INVITED_WORKSPACE_ID]: {
        name: "Orbit Studio",
        description: "The workspace the seeded invitation joins.",
        website_url: null,
        role: "developer",
        created_at: now,
        updated_at: now,
        member_count: 2,
        members: [
          {
            membership_id: uuid(),
            user_id: uuid(),
            email: "owner@orbit.example.com",
            name: "Orbit Owner",
            role: "org-admin",
            status: "active",
          },
          membership,
        ],
        invitations: [],
        repos: [],
        pool: seedPool(),
        defaultProfileId: balancedProfile.id,
        assignments: {},
      },
    }
    persistState()
    return HttpResponse.json({
      workspace_id: INVITED_WORKSPACE_ID,
      membership_id: membership.membership_id,
      role: "developer",
    })
  }),

  http.post("*/api/invitations", async ({ request }) => {
    const denied = forbidUnlessAdmin()
    if (denied) return denied
    const record = workspaceRecords[activeWorkspaceId as string]
    const body = (await request
      .json()
      .catch(() => null)) as Partial<CreateInvitationRequest> | null
    const email = typeof body?.email === "string" ? body.email.trim() : ""
    const errors: { field: string; detail: string }[] = []
    if (!EMAIL.test(email)) {
      errors.push({ field: "email", detail: "Enter a valid email address." })
    }
    if (!body?.role || !ROLES.includes(body.role)) {
      errors.push({ field: "role", detail: "Input should be a valid role." })
    }
    if (errors.length > 0 || !body?.role) return invalid(errors)

    const normalized = email.toLowerCase()
    const taken =
      record.invitations.some((i) => i.email === normalized) ||
      record.members.some(
        (m) => m.status === "active" && m.email?.toLowerCase() === normalized,
      )
    if (taken) {
      return fail(
        409,
        "CONFLICT",
        "That address is already a member or already invited.",
      )
    }
    // A mailbox the mock cannot deliver to. The real API rolls the invitation
    // back when Resend refuses it, so nothing is stored here either.
    if (normalized.endsWith("@bounce.example")) {
      return fail(
        503,
        "UPSTREAM_UNAVAILABLE",
        "The invitation email could not be sent.",
      )
    }
    const invitation: Invitation = {
      invitation_id: uuid(),
      email: normalized,
      role: body.role,
      expires_at: new Date(Date.now() + 72 * 3600 * 1000).toISOString(),
    }
    record.invitations = [...record.invitations, invitation]
    persistState()
    const origin =
      typeof location === "undefined"
        ? "http://localhost:3000"
        : location.origin
    return HttpResponse.json(
      {
        ...invitation,
        invitation_url: `${origin}/invitations/accept?token=${uuid()}`,
      },
      { status: 201 },
    )
  }),

  http.delete("*/api/invitations/:invitationId", ({ params }) => {
    const denied = forbidUnlessAdmin()
    if (denied) return denied
    const record = workspaceRecords[activeWorkspaceId as string]
    const before = record.invitations.length
    record.invitations = record.invitations.filter(
      (i) => i.invitation_id !== params.invitationId,
    )
    if (record.invitations.length === before) return NOT_FOUND()
    persistState()
    return new HttpResponse(null, { status: 204 })
  }),

  http.patch(
    "*/api/members/:membershipId/role",
    async ({ params, request }) => {
      const denied = forbidUnlessAdmin()
      if (denied) return denied
      const record = workspaceRecords[activeWorkspaceId as string]
      const body = (await request.json().catch(() => null)) as {
        role?: Role
      } | null
      if (!body?.role || !ROLES.includes(body.role)) {
        return invalid([
          { field: "role", detail: "Input should be a valid role." },
        ])
      }
      const target = record.members.find(
        (m) => m.membership_id === params.membershipId,
      )
      if (!target) return NOT_FOUND()
      if (body.role !== "org-admin" && isLastAdmin(record.members, target)) {
        return fail(409, "CONFLICT", "A workspace needs an active org-admin.")
      }
      target.role = body.role
      // The session's role comes from this record, so a self-change is real.
      if (target.user_id === mockSession.user_id) record.role = body.role
      persistState()
      return HttpResponse.json(target)
    },
  ),

  http.delete("*/api/members/:membershipId", ({ params }) => {
    const denied = forbidUnlessAdmin()
    if (denied) return denied
    const record = workspaceRecords[activeWorkspaceId as string]
    const target = record.members.find(
      (m) => m.membership_id === params.membershipId,
    )
    if (!target || target.status !== "active") return NOT_FOUND()
    if (isLastAdmin(record.members, target)) {
      return fail(409, "CONFLICT", "A workspace needs an active org-admin.")
    }
    target.status = "inactive"
    persistState()
    return new HttpResponse(null, { status: 204 })
  }),

  // ── projects ──────────────────────────────────────────────────────────────
  http.get("*/api/projects", () => HttpResponse.json(connected)),

  http.delete("*/api/projects/:repoId", ({ params }) => {
    const repoId = params.repoId as string
    const index = connected.findIndex((repo) => repo.id === repoId)
    if (index < 0) return fail(404, "NOT_FOUND", "Not found.")
    connected = connected.filter((repo) => repo.id !== repoId)
    // The assignment row is keyed by repository and cascades with it, so a
    // profile does not stay undeletable because a removed project still names
    // it.
    if (assignments[repoId]) {
      assignments = Object.fromEntries(
        Object.entries(assignments).filter(([id]) => id !== repoId),
      )
    }
    persistState()
    return new HttpResponse(null, { status: 204 })
  }),

  // Connect a repository. Each failure code needs its own message on screen —
  // "400 Bad Request" tells someone who pasted a private repo nothing useful.
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
    // The 13H.1 guardrails: refused before a project exists.
    if (name.startsWith("nojava-")) {
      return HttpResponse.json(
        {
          detail:
            "We couldn't find any Java in this repository. CodeSage reads Java for now; more languages are coming soon.",
          code: "REPOSITORY_HAS_NO_JAVA",
          languages: ["Python", "Shell"],
        } satisfies ApiError,
        { status: 400 },
      )
    }
    if (name.startsWith("huge-")) {
      return fail(
        400,
        "REPOSITORY_TOO_LARGE",
        "This repository is larger than 300 MB, the most CodeSage can analyse today.",
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
    connected = [...connected, repo]
    persistState()
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

    // No repo, no such branch, or never scanned successfully — the client
    // renders the empty state, not an error.
    if (repoId === UNSCANNED_REPO_ID) {
      return fail(404, "NOT_FOUND", "This branch has not been scanned yet.")
    }

    const url = new URL(request.url)
    const branch = url.searchParams.get("branch") ?? defaultBranch.name
    if (!mockBranches.some((b) => b.name === branch)) {
      return fail(404, "NOT_FOUND", "No such branch.")
    }

    // 503, not 404 and not an empty report: the snapshot is there, its score is
    // not yet. Answering 200 with a zero would be the harmful version of this —
    // "scored 0" and "not scored" must never look the same.
    const stillScoring = pendingScores.get(scanKey(repoId, branch)) ?? 0
    if (stillScoring > 0) {
      pendingScores.set(scanKey(repoId, branch), stillScoring - 1)
      return fail(
        503,
        "SCORE_PENDING",
        "The dashboard score is still being prepared. Please try again shortly.",
      )
    }

    return HttpResponse.json(
      reportFor(
        repoId,
        branch,
        branchInfoFor(branch).is_default,
        effectiveFor(repoId),
        url.searchParams.get("snapshot_id") ?? undefined,
      ),
    )
  }),

  // Scan history, derived under the same effective profile — which is why
  // switching profiles redraws this list as well as the dashboard.
  http.get("*/api/repos/:repoId/scans", ({ params, request }) => {
    const repoId = params.repoId as string
    if (!knownRepo(repoId)) return NOT_FOUND()
    if (repoId === UNSCANNED_REPO_ID) return HttpResponse.json([])

    const branch = new URL(request.url).searchParams.get("branch")
    const info = branchInfoFor(branch)
    const scale =
      (repoId === DEMO_REPO_ID ? 1 : 1.7) * (info.is_default ? 1 : 1.2)
    return HttpResponse.json(
      scanHistoryFor(effectiveFor(repoId), info.name, scale),
    )
  }),

  // ── profiles ──────────────────────────────────────────────────────────────
  //
  // Route order is load-bearing: `/profiles/active` and `/profiles/default` are
  // registered before `/profiles/:profileId`, or the parameterised route would
  // swallow both and answer 404 for a word that is not a uuid.

  http.get("*/api/profiles", () => HttpResponse.json(poolOut())),

  http.post("*/api/profiles", async ({ request }) => {
    const body = await request.json().catch(() => null)
    const errors = validationErrors(body)
    const named = body as { name?: unknown } | null
    if (typeof named?.name !== "string" || named.name.trim() === "") {
      errors.push({ field: "name", detail: "Input should be a valid string." })
    }
    if (errors.length > 0) return invalid(errors)

    const created = body as CreateProfileRequest
    // Checked before the name, because a full pool is a different thing to fix
    // than a clashing name and the user should be told the blocking one.
    if (customProfiles().length >= MAX_CUSTOM_PROFILES) {
      return fail(
        409,
        "PROFILE_LIMIT_REACHED",
        "A workspace can hold at most five custom scoring profiles.",
      )
    }
    if (nameIsTaken(created.name)) return nameConflict()

    const stored: StoredProfile = {
      id: uuid(),
      name: created.name.trim(),
      weights: clampWeights(created.weights),
      trust_s: clamp(created.trust_s, TRUST_MIN, TRUST_MAX),
      is_preset: false,
    }
    pool = [...pool, stored]
    persistState()
    // 201, and NOT the default: authoring a profile and choosing the one in
    // force are separate, deliberate acts.
    return HttpResponse.json(out(stored), { status: 201 })
  }),

  // Superseded by GET /api/profiles/default, which it now answers identically.
  http.get("*/api/profiles/active", () =>
    HttpResponse.json(out(defaultProfile())),
  ),

  // Superseded by POST /api/profiles plus PUT /api/profiles/default.
  http.put("*/api/profiles/active", async ({ request }) => {
    const body = await request.json().catch(() => null)
    const errors = validationErrors(body)
    if (errors.length > 0) return invalid(errors)
    return HttpResponse.json(applyToWorkspace(body as ApplyProfileRequest))
  }),

  http.get("*/api/profiles/default", () =>
    HttpResponse.json(out(defaultProfile())),
  ),

  http.put("*/api/profiles/default", async ({ request }) => {
    const body = (await request.json().catch(() => null)) as {
      profile_id?: unknown
    } | null
    if (typeof body?.profile_id !== "string") {
      return invalid([
        { field: "profile_id", detail: "Input should be a valid UUID." },
      ])
    }
    const target = findProfile(body.profile_id)
    // A profile from another workspace answers 404, the same as an id that
    // exists nowhere: whether a foreign workspace holds one is not ours to say.
    if (!target) return NOT_FOUND()

    defaultProfileId = target.id
    persistState()
    // Idempotent: the second PUT of the same id changes nothing, and neither
    // writes a snapshot or starts a scan.
    return HttpResponse.json(out(target))
  }),

  http.get("*/api/profiles/:profileId", ({ params }) => {
    const stored = findProfile(params.profileId as string)
    return stored ? HttpResponse.json(out(stored)) : NOT_FOUND()
  }),

  http.patch("*/api/profiles/:profileId", async ({ params, request }) => {
    const stored = findProfile(params.profileId as string)
    if (!stored) return NOT_FOUND()
    if (stored.is_preset) return builtInRefused()

    const body = await request.json().catch(() => null)
    const errors = patchErrors(body)
    if (errors.length > 0) return invalid(errors)

    const patch = body as UpdateProfileRequest
    if (patch.name !== undefined && nameIsTaken(patch.name, stored.id)) {
      return nameConflict()
    }

    // A partial update: an omitted weight keeps its stored value, which is what
    // makes this safe to send from a form that tracks only what changed.
    const merged = { ...stored.weights, ...(patch.weights ?? {}) }
    stored.name = patch.name === undefined ? stored.name : patch.name.trim()
    stored.weights = clampWeights(merged)
    stored.trust_s = clamp(
      patch.trust_s === undefined ? stored.trust_s : patch.trust_s,
      TRUST_MIN,
      TRUST_MAX,
    )
    persistState()
    // Every project using it is now scored differently — deliberately, and with
    // no scan: that is what a shared pool is for.
    return HttpResponse.json(out(stored))
  }),

  http.delete("*/api/profiles/:profileId", ({ params }) => {
    const stored = findProfile(params.profileId as string)
    if (!stored) return NOT_FOUND()
    if (stored.is_preset) return builtInRefused()
    if (stored.id === defaultProfileId || usageCount(stored.id) > 0) {
      // The two foreign keys would refuse the row anyway; checking first is what
      // turns that refusal into a code the UI can explain.
      return fail(
        409,
        "PROFILE_IN_USE",
        "This profile is the workspace default or is assigned to a project. " +
          "Change those selections before deleting it.",
      )
    }
    pool = pool.filter((profile) => profile.id !== stored.id)
    persistState()
    return new HttpResponse(null, { status: 204 })
  }),

  // ── one project's profile ─────────────────────────────────────────────────
  http.get("*/api/projects/:repoId/profile", ({ params }) => {
    const repoId = params.repoId as string
    if (!knownRepo(repoId)) return NOT_FOUND()
    return HttpResponse.json(projectProfileOut(repoId))
  }),

  http.put("*/api/projects/:repoId/profile", async ({ params, request }) => {
    const repoId = params.repoId as string
    if (!knownRepo(repoId)) return NOT_FOUND()

    const body = (await request.json().catch(() => null)) as {
      profile_id?: unknown
    } | null
    if (typeof body?.profile_id !== "string") {
      return invalid([
        { field: "profile_id", detail: "Input should be a valid UUID." },
      ])
    }
    // Only this workspace's pool is addressable, so a cross-workspace
    // assignment is unrepresentable rather than merely rejected.
    if (!findProfile(body.profile_id)) return NOT_FOUND()

    // One override per project — the repository is the key — so this replaces
    // any previous choice rather than adding to it.
    assignments = { ...assignments, [repoId]: body.profile_id }
    persistState()
    return HttpResponse.json(projectProfileOut(repoId))
  }),

  http.delete("*/api/projects/:repoId/profile", ({ params }) => {
    const repoId = params.repoId as string
    if (!knownRepo(repoId)) return NOT_FOUND()

    // Idempotent: clearing a project that has no override succeeds and returns
    // the same inherited state.
    assignments = Object.fromEntries(
      Object.entries(assignments).filter(([id]) => id !== repoId),
    )
    persistState()
    return HttpResponse.json(projectProfileOut(repoId))
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

    // Skip-if-unchanged: the head SHA matches the last successful scan, so
    // nothing is queued and the existing scan_id comes back as `done`. Still
    // 202 — the client learns this from the phase, not the status code.
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

  // Before `:scanId`, or "active" would be taken for a scan id.
  http.get("*/api/repos/:repoId/scan/active", ({ params, request }) => {
    const repoId = params.repoId as string
    if (!knownRepo(repoId)) return NOT_FOUND()
    const branch = new URL(request.url).searchParams.get("branch")
    const current = scans.get(repoId)
    const active =
      current &&
      (current.phase === "queued" || current.phase === "running") &&
      (!branch || current.branch === branch)
    return active
      ? HttpResponse.json(current)
      : new HttpResponse(null, { status: 204 })
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
 * Kept out of `handlers` on purpose: in dev, MSW passes /api/auth/session through
 * to the real API, which is the only way to test a real sign-in locally.
 * Playwright has the opposite need — no API, and no headless browser completes an
 * OIDC consent screen — so these switch on only for `e2e`.
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
    // A second cookie forces the role. Sign-in is bypassed in E2E anyway, and
    // "a viewer is offered no write controls" cannot be journey-tested at all
    // without a session that really lacks the grant. It is inert in the dev app,
    // where nothing sets this cookie.
    const forcedViewer = cookies["codesage_e2e_role"] === "viewer"
    const identity = forcedViewer ? mockSessionViewer : mockSession

    if (!activeWorkspaceId) {
      // Authenticated, with nowhere to work yet. A real state, not a failure —
      // and a different one from 401, which is why the web must not treat them
      // alike.
      return HttpResponse.json({
        ...identity,
        workspace_id: null,
        needs_workspace_setup: true,
        role: null,
        permissions: [],
      } satisfies Session)
    }

    // Role and permissions come from the ACTIVE workspace's membership, so
    // switching workspaces really does change what this session may do.
    const role: Role = forcedViewer
      ? "viewer"
      : workspaceRecords[activeWorkspaceId].role
    return HttpResponse.json({
      ...identity,
      workspace_id: activeWorkspaceId,
      needs_workspace_setup: false,
      role,
      permissions: PERMISSIONS_BY_ROLE[role],
    } satisfies Session)
  }),
]
