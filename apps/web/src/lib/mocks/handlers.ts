// The fake backend (MSW request handlers).
import { http, HttpResponse } from "msw"
import type {
  ApiError,
  ApplyProfileRequest,
  CategoryWeights,
  ConnectRepoRequest,
  CreateInvitationRequest,
  CreateProfileRequest,
  CreateWorkspaceRequest,
  DeleteWorkspaceRequest,
  FindingStatus,
  HealthReport,
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
import { FINDING_FACTS, SNAPSHOTS, scanHistoryFor } from "./scoring"
import { STAGE_BANDS, stageOf } from "@/lib/scan-progress"

/** Typed, so an envelope missing `code` fails the build. */
const fail = (status: number, code: ApiError["code"], detail: string) =>
  HttpResponse.json({ detail, code } satisfies ApiError, { status })

const NOT_FOUND = () => fail(404, "NOT_FOUND", "Not found.")

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
const FINDING_STATUSES_KEY = "codesage.mock.finding-statuses"

let findingStatuses: Record<string, FindingStatus> = restore(
  FINDING_STATUSES_KEY,
  {},
)

function findingStatusKey(snapshotId: string, fingerprint: string) {
  return `${activeWorkspaceId ?? "no-workspace"}:${snapshotId}:${fingerprint}`
}

function withFindingStatuses(report: HealthReport): HealthReport {
  return {
    ...report,
    // This is deliberately an overlay after scoring.
    findings: report.findings.map((finding) => ({
      ...finding,
      status:
        findingStatuses[
          findingStatusKey(report.snapshot_id, finding.fingerprint)
        ] ?? finding.status,
    })),
  }
}

// Everything one workspace owns.
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

// The active workspace's state, unpacked so every handler below reads it the way it always has.
let connected: Repo[] = []

type StoredProfile = Pick<
  ScoreProfile,
  "id" | "name" | "weights" | "trust_s" | "is_preset"
>

function seedPool(): StoredProfile[] {
  return mockProfiles.map(({ id, name, weights, trust_s, is_preset }) => ({
    id,
    name,
    weights,
    trust_s,
    is_preset,
  }))
}

let pool: StoredProfile[] = []

/** One pointer per workspace, which is why "exactly one default" needs no rule. */
let defaultProfileId: string = balancedProfile.id

let assignments: Record<string, string> = {}

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

unpackWorkspace()

const defaultBranch = mockBranches.find((b) => b.is_default) ?? mockBranches[0]

function branchInfoFor(name: string | null | undefined) {
  return mockBranches.find((b) => b.name === name) ?? defaultBranch
}

/** A repo id we know about — either seeded or connected during this session. */
const knownRepo = (repoId: string) => connected.find((r) => r.id === repoId)

const SCAN_STEP = 17 // % added per poll → ~6 polls from 0 to done

const SLOW_SCAN_STEP = 4

function scanStep() {
  const slow =
    typeof document !== "undefined" &&
    document.cookie.includes("codesage_e2e_slow_scan=1")
  return slow ? SLOW_SCAN_STEP : SCAN_STEP
}

const FINALIZE_AT = 85

const scans = new Map<string, ScanStatus>()

const cancelRequested = new Set<string>()

// Head SHA of the last successful scan per repo+branch — what skip-if-unchanged compares against.
const lastSuccessfulSha = new Map<string, string>()

const PENDING_ASKS_AFTER_SCAN = 2

/** repo@branch → how many more health requests still answer SCORE_PENDING. */
const pendingScores = new Map<string, number>()

const scanKey = (repoId: string, branch: string) => `${repoId}@${branch}`

function uuid(): string {
  return crypto.randomUUID()
}

function idleScan(): ScanStatus {
  return { scan_id: uuid(), phase: "idle", progress: 0 }
}

/** How many Java files the demo repository "has", for "Reading 1,240 Java files". */
const MOCK_JAVA_FILES = 1240

const MOCK_TYPICAL_SECONDS = 5

function withStage(status: ScanStatus): ScanStatus {
  const stage = stageOf({ progress: status.progress })
  const [start, end] = STAGE_BANDS.reading_code
  const reading = stage === "reading_code"
  return {
    ...status,
    stage,
    files_total: reading ? MOCK_JAVA_FILES : null,
    files_done: reading
      ? Math.round(
          ((status.progress - start) / (end - start)) * MOCK_JAVA_FILES,
        )
      : null,
    typical_seconds: MOCK_TYPICAL_SECONDS,
  }
}

function tick(repoId: string): ScanStatus {
  const current = scans.get(repoId) ?? idleScan()
  if (current.phase !== "running") return current

  const now = new Date().toISOString()

  // The worker reads the cancel flag between pipeline stages and stops at the first boundary.
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

  const progress = Math.min(100, current.progress + scanStep())
  if (progress < 100) {
    const next: ScanStatus = withStage({ ...current, progress })
    scans.set(repoId, next)
    return next
  }

  const done: ScanStatus = {
    ...current,
    phase: "done",
    progress: 100,
    finished_at: now,
    stage: null,
    files_done: null,
    files_total: null,
  }
  scans.set(repoId, done)
  if (done.branch) {
    // The snapshot is stored the moment the scan finishes; the score is not.
    pendingScores.set(scanKey(repoId, done.branch), PENDING_ASKS_AFTER_SCAN)
    newestSnapshot.set(scanKey(repoId, done.branch), {
      snapshot_id: uuid(),
      scanned_at: now,
      commit_sha: done.commit_sha ?? undefined,
    })
    if (done.commit_sha) {
      lastSuccessfulSha.set(scanKey(repoId, done.branch), done.commit_sha)
    }
  }
  return done
}

const newestSnapshot = new Map<
  string,
  { snapshot_id: string; scanned_at: string; commit_sha?: string }
>()

export const PROFILE_RESCORE_MS = 1_500

/** repo id → when its re-score (after a profile change) is done. */
const rescoringUntil = new Map<string, number>()

function markRescoring(repoIds: string[]) {
  const until = Date.now() + PROFILE_RESCORE_MS
  for (const repoId of repoIds) {
    if (repoId !== UNSCANNED_REPO_ID) rescoringUntil.set(repoId, until)
  }
}

const isRescoring = (repoId: string) =>
  (rescoringUntil.get(repoId) ?? 0) > Date.now()

export function resetMockBackend() {
  scans.clear()
  newestSnapshot.clear()
  rescoringUntil.clear()
  cancelRequested.clear()
  lastSuccessfulSha.clear()
  pendingScores.clear()
  findingStatuses = {}
  activeWorkspaceId = null
  workspaceRecords = seedWorkspaces()
  loadWorkspace(WORKSPACE_ID)
  storage()?.removeItem(WORKSPACES_KEY)
  storage()?.removeItem(ACTIVE_WORKSPACE_KEY)
  storage()?.removeItem(FINDING_STATUSES_KEY)
}

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

function out(stored: StoredProfile): ScoreProfile {
  return {
    ...stored,
    is_active: stored.id === defaultProfileId,
    usage_count: usageCount(stored.id),
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

// The same rules for a PATCH, where every field is optional.
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

// The built-in these exact numbers are, if they still are one.
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

// Where the superseded `PUT /api/profiles/active` writes its numbers.
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

// Clamp these six numbers and make them the workspace default.
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
    project_count: isActive ? connected.length : record.repos.length,
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

const WORKSPACE_FREE = [
  "/api/auth/session",
  "/api/auth/workspaces",
  "/api/invitations/accept",
  "/api/healthz",
]

export const handlers = [
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

  http.get("*/api/auth/workspaces", () =>
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
    if (!workspaceRecords[body.workspace_id]) return NOT_FOUND()

    loadWorkspace(body.workspace_id)
    persistState()
    return HttpResponse.json(workspaceOut(body.workspace_id))
  }),

  http.get("*/api/auth/workspaces/:workspaceId", ({ params }) => {
    const workspaceId = params.workspaceId as string
    // Only the ACTIVE workspace is readable.
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

  http.delete(
    "*/api/auth/workspaces/:workspaceId",
    async ({ params, request }) => {
      const workspaceId = params.workspaceId as string
      if (workspaceId !== activeWorkspaceId) return NOT_FOUND()
      const record = workspaceRecords[workspaceId]
      if (record.role !== "org-admin") {
        return fail(
          403,
          "FORBIDDEN",
          "Only an org-admin can delete a workspace.",
        )
      }

      const body = (await request
        .json()
        .catch(() => null)) as Partial<DeleteWorkspaceRequest> | null
      if (body?.confirmation_name !== record.name) {
        return invalid([
          {
            field: "confirmation_name",
            detail: "Enter the exact workspace name.",
          },
        ])
      }

      const repoIds = new Set(record.repos.map((repo) => repo.id))
      const hasActiveScan = [...scans.entries()].some(
        ([repoId, scan]) =>
          repoIds.has(repoId) &&
          (scan.phase === "queued" || scan.phase === "running"),
      )
      if (hasActiveScan) {
        return fail(
          409,
          "WORKSPACE_SCAN_RUNNING",
          "Stop or wait for workspace scans before deleting it.",
        )
      }

      delete workspaceRecords[workspaceId]
      for (const repoId of repoIds) {
        scans.delete(repoId)
        rescoringUntil.delete(repoId)
        cancelRequested.delete(repoId)
        for (const key of [...newestSnapshot.keys()]) {
          if (key.startsWith(`${repoId}@`)) newestSnapshot.delete(key)
        }
        for (const key of [...lastSuccessfulSha.keys()]) {
          if (key.startsWith(`${repoId}@`)) lastSuccessfulSha.delete(key)
        }
        for (const key of [...pendingScores.keys()]) {
          if (key.startsWith(`${repoId}@`)) pendingScores.delete(key)
        }
      }
      // Like the API: the session drops to no workspace, even when another one is available.
      loadWorkspace(null)
      persistState()
      return new HttpResponse(null, { status: 204 })
    },
  ),

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
    // One answer for every kind of unusable token, as on the real API.
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
    // A mailbox the mock cannot deliver to.
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

  http.get("*/api/projects", () => HttpResponse.json(connected)),

  http.delete("*/api/projects/:repoId", ({ params }) => {
    const repoId = params.repoId as string
    const index = connected.findIndex((repo) => repo.id === repoId)
    if (index < 0) return fail(404, "NOT_FOUND", "Not found.")
    connected = connected.filter((repo) => repo.id !== repoId)
    if (assignments[repoId]) {
      assignments = Object.fromEntries(
        Object.entries(assignments).filter(([id]) => id !== repoId),
      )
    }
    persistState()
    return new HttpResponse(null, { status: 204 })
  }),

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

  http.get("*/api/repos/:repoId/branches", ({ params }) => {
    if (!knownRepo(params.repoId as string)) return NOT_FOUND()
    return HttpResponse.json(mockBranches)
  }),

  http.get("*/api/repos/:repoId/health", ({ params, request }) => {
    const repoId = params.repoId as string
    const repo = knownRepo(repoId)
    if (!repo) return NOT_FOUND()

    if (repoId === UNSCANNED_REPO_ID) {
      return fail(404, "NOT_FOUND", "This branch has not been scanned yet.")
    }

    const url = new URL(request.url)
    const branch = url.searchParams.get("branch") ?? defaultBranch.name
    if (!mockBranches.some((b) => b.name === branch)) {
      return fail(404, "NOT_FOUND", "No such branch.")
    }

    // 503, not 404 and not an empty report: the snapshot is there, its score is not yet.
    const stillScoring = pendingScores.get(scanKey(repoId, branch)) ?? 0
    if (
      isRescoring(repoId) &&
      branchInfoFor(branch).is_default &&
      !url.searchParams.get("snapshot_id")
    ) {
      return fail(
        503,
        "SCORE_PENDING",
        "The dashboard score is still being prepared. Please try again shortly.",
      )
    }
    if (stillScoring > 0) {
      pendingScores.set(scanKey(repoId, branch), stillScoring - 1)
      return fail(
        503,
        "SCORE_PENDING",
        "The dashboard score is still being prepared. Please try again shortly.",
      )
    }

    const requested = url.searchParams.get("snapshot_id") ?? undefined
    const newest = newestSnapshot.get(scanKey(repoId, branch))
    const asksForNewest =
      newest && (!requested || requested === newest.snapshot_id)
    const report = reportFor(
      repoId,
      branch,
      branchInfoFor(branch).is_default,
      effectiveFor(repoId),
      asksForNewest ? undefined : requested,
    )
    const selectedReport = asksForNewest
      ? {
          ...report,
          snapshot_id: newest.snapshot_id,
          scanned_at: newest.scanned_at,
          commit_sha: newest.commit_sha ?? report.commit_sha,
        }
      : report
    const response = withFindingStatuses(selectedReport)
    return HttpResponse.json(
      url.searchParams.get("include_findings") === "false"
        ? { ...response, findings: [] }
        : response,
    )
  }),

  http.get("*/api/repos/:repoId/health/findings", ({ params, request }) => {
    const repoId = params.repoId as string
    if (!knownRepo(repoId)) return NOT_FOUND()
    const url = new URL(request.url)
    const branch = url.searchParams.get("branch") ?? defaultBranch.name
    if (!mockBranches.some((item) => item.name === branch)) return NOT_FOUND()
    const requested = url.searchParams.get("snapshot_id") ?? undefined
    const report = withFindingStatuses(
      reportFor(
        repoId,
        branch,
        branchInfoFor(branch).is_default,
        effectiveFor(repoId),
        requested,
      ),
    )
    const limit = Math.min(
      100,
      Math.max(1, Number(url.searchParams.get("limit") ?? 25)),
    )
    const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0))
    return HttpResponse.json({
      items: report.findings.slice(offset, offset + limit),
      total: report.findings.length,
      limit,
      offset,
    })
  }),

  http.put(
    "*/api/snapshots/:snapshotId/findings/:fingerprint/status",
    async ({ params, request, cookies }) => {
      const role =
        cookies["codesage_e2e_role"] === "viewer"
          ? "viewer"
          : activeWorkspaceId
            ? workspaceRecords[activeWorkspaceId]?.role
            : undefined
      if (!role || !PERMISSIONS_BY_ROLE[role].includes("finding:triage")) {
        return fail(
          403,
          "FORBIDDEN",
          "You do not have permission to update finding status.",
        )
      }

      const body = (await request.json().catch(() => null)) as {
        status?: unknown
      } | null
      if (body?.status !== "open" && body?.status !== "done") {
        return fail(422, "VALIDATION_FAILED", "Status must be open or done.")
      }

      const snapshotId = String(params.snapshotId)
      const fingerprint = String(params.fingerprint)
      const snapshotExists =
        SNAPSHOTS.some((snapshot) => snapshot.snapshot_id === snapshotId) ||
        Array.from(newestSnapshot.values()).some(
          (snapshot) => snapshot.snapshot_id === snapshotId,
        )
      if (
        !snapshotExists ||
        !FINDING_FACTS.some((finding) => finding.fingerprint === fingerprint)
      ) {
        return NOT_FOUND()
      }
      const key = findingStatusKey(snapshotId, fingerprint)
      findingStatuses = { ...findingStatuses, [key]: body.status }
      persist(FINDING_STATUSES_KEY, findingStatuses)
      return new HttpResponse(null, { status: 204 })
    },
  ),

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
    return HttpResponse.json(out(stored), { status: 201 })
  }),

  // Superseded by GET /api/profiles/default, which it now answers identically.
  http.get("*/api/profiles/active", () =>
    HttpResponse.json(out(defaultProfile())),
  ),

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
    if (!target) return NOT_FOUND()

    const changedDefault = defaultProfileId !== target.id
    defaultProfileId = target.id
    persistState()
    // Only the projects that inherit the default are re-scored.
    if (changedDefault) {
      markRescoring(connected.map((r) => r.id).filter((id) => !assignments[id]))
    }
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

    const merged = { ...stored.weights, ...(patch.weights ?? {}) }
    stored.name = patch.name === undefined ? stored.name : patch.name.trim()
    stored.weights = clampWeights(merged)
    stored.trust_s = clamp(
      patch.trust_s === undefined ? stored.trust_s : patch.trust_s,
      TRUST_MIN,
      TRUST_MAX,
    )
    persistState()
    return HttpResponse.json(out(stored))
  }),

  http.delete("*/api/profiles/:profileId", ({ params }) => {
    const stored = findProfile(params.profileId as string)
    if (!stored) return NOT_FOUND()
    if (stored.is_preset) return builtInRefused()
    if (stored.id === defaultProfileId || usageCount(stored.id) > 0) {
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
    if (!findProfile(body.profile_id)) return NOT_FOUND()

    const changedAssignment = assignments[repoId] !== body.profile_id
    assignments = { ...assignments, [repoId]: body.profile_id }
    persistState()
    if (changedAssignment) markRescoring([repoId])
    return HttpResponse.json(projectProfileOut(repoId))
  }),

  http.delete("*/api/projects/:repoId/profile", ({ params }) => {
    const repoId = params.repoId as string
    if (!knownRepo(repoId)) return NOT_FOUND()

    // Idempotent: clearing a project that has no override succeeds and returns the same inherited state.
    assignments = Object.fromEntries(
      Object.entries(assignments).filter(([id]) => id !== repoId),
    )
    persistState()
    return HttpResponse.json(projectProfileOut(repoId))
  }),

  http.get("*/api/activity", () => {
    const nameOf = (repoId: string) => {
      const repo = knownRepo(repoId)
      return repo ? `${repo.owner}/${repo.name}` : repoId
    }
    const running = [...scans.entries()]
      .filter(
        ([repoId, scan]) =>
          knownRepo(repoId) &&
          (scan.phase === "queued" || scan.phase === "running"),
      )
      .map(([repoId, status]) => ({
        repo_id: repoId,
        repo_name: nameOf(repoId),
        status,
      }))
    // Scores still pending: a finished scan's (counted in asks) and a profile change's (on its own clock).
    const left = new Map<string, number>()
    for (const [key, asks] of pendingScores) {
      const repoId = key.split("@")[0] ?? ""
      if (asks > 0 && knownRepo(repoId)) {
        left.set(repoId, (left.get(repoId) ?? 0) + 1)
      }
    }
    for (const repoId of rescoringUntil.keys()) {
      if (isRescoring(repoId) && knownRepo(repoId) && !left.has(repoId)) {
        left.set(repoId, 1)
      }
    }
    const rescoring = [...left.entries()].map(([repoId, snapshotsLeft]) => ({
      repo_id: repoId,
      repo_name: nameOf(repoId),
      snapshots_left: snapshotsLeft,
    }))
    return HttpResponse.json({ scans: running, rescoring })
  }),

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
      stage: "cloning",
      typical_seconds: MOCK_TYPICAL_SECONDS,
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

    if (current.phase !== "running" && current.phase !== "queued") {
      return fail(
        409,
        "SCAN_NOT_CANCELLABLE",
        "This scan can no longer be cancelled.",
      )
    }

    // 202: the flag is set and the phase comes back UNCHANGED.
    cancelRequested.add(repoId)
    return HttpResponse.json(current, { status: 202 })
  }),

  http.get("*/api/healthz", () => HttpResponse.json({ status: "ok" })),
]

export const authHandlers = [
  http.get("*/api/auth/session", ({ cookies }) => {
    const name =
      process.env.NEXT_PUBLIC_SESSION_COOKIE_NAME ?? "codesage_session"
    if (!cookies[name]) {
      return fail(401, "NOT_AUTHENTICATED", "Sign in to continue.")
    }
    // A second cookie forces the role.
    const forcedViewer = cookies["codesage_e2e_role"] === "viewer"
    const identity = forcedViewer ? mockSessionViewer : mockSession

    if (!activeWorkspaceId) {
      // Authenticated, with nowhere to work yet.
      return HttpResponse.json({
        ...identity,
        workspace_id: null,
        needs_workspace_setup: true,
        role: null,
        permissions: [],
      } satisfies Session)
    }

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
  http.put("*/api/auth/tour", async ({ request }) => {
    const body = (await request.json()) as { status?: string }
    if (body.status !== "completed" && body.status !== "skipped") {
      return fail(422, "VALIDATION_FAILED", "Choose completed or skipped.")
    }
    return new HttpResponse(null, { status: 204 })
  }),
]
