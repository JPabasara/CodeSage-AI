import { expect, test } from "vitest"

import {
  clearSelectedProjectId,
  LEGACY_SELECTED_PROJECT_KEY,
  migrateLegacySelection,
  readSelectedProjectId,
  repoIdFromDashboardPath,
  resolveSelectedProjectId,
  SELECTED_PROJECT_KEY,
  writeSelectedProjectId,
} from "./use-selected-project"

const FIRST_REPO_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7"
const SECOND_REPO_ID = "b4f0a9d2-3c81-4e57-9f26-1d5a8b7c0e34"
const UNKNOWN_REPO_ID = "11111111-2222-3333-4444-555555555555"

const WORKSPACE_ID = "1e2f3a4b-5c6d-4e7f-8091-a2b3c4d5e6f7"
const OTHER_WORKSPACE_ID = "2f3a4b5c-6d7e-4f80-91a2-b3c4d5e6f708"

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => {
      values.set(key, value)
    },
  }
}

test("saves and restores a selected project id", () => {
  const store = memoryStorage()

  writeSelectedProjectId(FIRST_REPO_ID, WORKSPACE_ID, store)

  expect(readSelectedProjectId(WORKSPACE_ID, store)).toBe(FIRST_REPO_ID)
})

test("each workspace remembers its own project", () => {
  const store = memoryStorage()

  writeSelectedProjectId(FIRST_REPO_ID, WORKSPACE_ID, store)
  writeSelectedProjectId(SECOND_REPO_ID, OTHER_WORKSPACE_ID, store)

  expect(readSelectedProjectId(WORKSPACE_ID, store)).toBe(FIRST_REPO_ID)
  expect(readSelectedProjectId(OTHER_WORKSPACE_ID, store)).toBe(SECOND_REPO_ID)
  // Neither answers for the other: that is the whole reason this is a map.
  expect(readSelectedProjectId(UNKNOWN_REPO_ID, store)).toBeUndefined()
})

test("clearing one workspace leaves the other alone", () => {
  const store = memoryStorage()
  writeSelectedProjectId(FIRST_REPO_ID, WORKSPACE_ID, store)
  writeSelectedProjectId(SECOND_REPO_ID, OTHER_WORKSPACE_ID, store)

  clearSelectedProjectId(WORKSPACE_ID, store)

  expect(readSelectedProjectId(WORKSPACE_ID, store)).toBeUndefined()
  expect(readSelectedProjectId(OTHER_WORKSPACE_ID, store)).toBe(SECOND_REPO_ID)
})

test("handles unavailable storage without throwing", () => {
  expect(readSelectedProjectId(WORKSPACE_ID, null)).toBeUndefined()
  expect(writeSelectedProjectId(FIRST_REPO_ID, WORKSPACE_ID, null)).toBe(
    FIRST_REPO_ID,
  )
  expect(() => clearSelectedProjectId(WORKSPACE_ID, null)).not.toThrow()
})

test("without a workspace nothing is stored, and the caller still gets its id", () => {
  const store = memoryStorage()

  // Onboarding: authenticated, no workspace. There is nothing to key a choice
  // by, so the choice is simply not remembered — not stored under a wrong key.
  expect(writeSelectedProjectId(FIRST_REPO_ID, null, store)).toBe(FIRST_REPO_ID)
  expect(store.getItem(SELECTED_PROJECT_KEY)).toBeNull()
})

test("ignores and drops values that are not a workspace-to-repository pair", () => {
  const store = memoryStorage()
  store.setItem(
    SELECTED_PROJECT_KEY,
    JSON.stringify({
      [WORKSPACE_ID]: "not-a-repo-id",
      "not-a-workspace": FIRST_REPO_ID,
    }),
  )

  expect(readSelectedProjectId(WORKSPACE_ID, store)).toBeUndefined()
})

test("corrupt storage reads as no preference rather than throwing", () => {
  const store = memoryStorage()
  store.setItem(SELECTED_PROJECT_KEY, "{not json")

  expect(readSelectedProjectId(WORKSPACE_ID, store)).toBeUndefined()
})

// ── migrating the pre-workspace key ─────────────────────────────────────────

test("a legacy selection moves under the workspace that actually has it", () => {
  const store = memoryStorage()
  store.setItem(LEGACY_SELECTED_PROJECT_KEY, FIRST_REPO_ID)

  migrateLegacySelection(WORKSPACE_ID, [FIRST_REPO_ID, SECOND_REPO_ID], store)

  expect(readSelectedProjectId(WORKSPACE_ID, store)).toBe(FIRST_REPO_ID)
  // Once per browser: the old key is gone whatever the outcome.
  expect(store.getItem(LEGACY_SELECTED_PROJECT_KEY)).toBeNull()
})

test("a legacy selection from another workspace is dropped, not adopted", () => {
  const store = memoryStorage()
  store.setItem(LEGACY_SELECTED_PROJECT_KEY, UNKNOWN_REPO_ID)

  migrateLegacySelection(WORKSPACE_ID, [FIRST_REPO_ID], store)

  // Adopting it would hand one workspace a project from another, which is the
  // bug the key change exists to prevent.
  expect(readSelectedProjectId(WORKSPACE_ID, store)).toBeUndefined()
  expect(store.getItem(LEGACY_SELECTED_PROJECT_KEY)).toBeNull()
})

test("migration waits for the project list rather than guessing", () => {
  const store = memoryStorage()
  store.setItem(LEGACY_SELECTED_PROJECT_KEY, FIRST_REPO_ID)

  migrateLegacySelection(WORKSPACE_ID, undefined, store)

  // Nothing is decided until the workspace's projects are known.
  expect(store.getItem(LEGACY_SELECTED_PROJECT_KEY)).toBe(FIRST_REPO_ID)
})

test("a choice already made under the new key wins over the legacy one", () => {
  const store = memoryStorage()
  writeSelectedProjectId(SECOND_REPO_ID, WORKSPACE_ID, store)
  store.setItem(LEGACY_SELECTED_PROJECT_KEY, FIRST_REPO_ID)

  migrateLegacySelection(WORKSPACE_ID, [FIRST_REPO_ID, SECOND_REPO_ID], store)

  expect(readSelectedProjectId(WORKSPACE_ID, store)).toBe(SECOND_REPO_ID)
})

// ── resolution ──────────────────────────────────────────────────────────────

test("reads the repo id from dashboard and history paths", () => {
  expect(repoIdFromDashboardPath(`/dashboard/${FIRST_REPO_ID}`)).toBe(
    FIRST_REPO_ID,
  )
  expect(repoIdFromDashboardPath(`/dashboard/${FIRST_REPO_ID}/history`)).toBe(
    FIRST_REPO_ID,
  )
})

test("URL repo id wins over stored project id", () => {
  expect(
    resolveSelectedProjectId({
      urlRepoId: SECOND_REPO_ID,
      storedRepoId: FIRST_REPO_ID,
      availableRepoIds: [FIRST_REPO_ID, SECOND_REPO_ID],
    }),
  ).toBe(SECOND_REPO_ID)
})

test("invalid stored ids fall back to the first available repo", () => {
  expect(
    resolveSelectedProjectId({
      storedRepoId: UNKNOWN_REPO_ID,
      availableRepoIds: [FIRST_REPO_ID, SECOND_REPO_ID],
    }),
  ).toBe(FIRST_REPO_ID)
})

test("can preserve an intentionally empty selection", () => {
  expect(
    resolveSelectedProjectId({
      availableRepoIds: [FIRST_REPO_ID, SECOND_REPO_ID],
      fallbackToFirstAvailable: false,
    }),
  ).toBeUndefined()
})

test("an explicit selection still works when first-repository fallback is disabled", () => {
  expect(
    resolveSelectedProjectId({
      storedRepoId: SECOND_REPO_ID,
      availableRepoIds: [FIRST_REPO_ID, SECOND_REPO_ID],
      fallbackToFirstAvailable: false,
    }),
  ).toBe(SECOND_REPO_ID)
})

test("an empty loaded project list clears the selection instead of keeping stale storage", () => {
  expect(
    resolveSelectedProjectId({
      storedRepoId: FIRST_REPO_ID,
      availableRepoIds: [],
    }),
  ).toBeUndefined()
})

test("the demo fallback is only for a list still loading, never an empty one", async () => {
  const { resolveSelectedProjectId } = await import("./use-selected-project")
  const demo = "7c9e6679-7425-40de-944b-e07fc1f90ae7"
  expect(resolveSelectedProjectId({ demoRepoId: demo })).toBe(demo)
  expect(
    resolveSelectedProjectId({ demoRepoId: demo, availableRepoIds: [] }),
  ).toBeUndefined()
})
