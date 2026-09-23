import { expect, test } from "vitest"

import {
  SELECTED_PROJECT_KEY,
  readSelectedProjectId,
  repoIdFromDashboardPath,
  resolveSelectedProjectId,
  writeSelectedProjectId,
} from "./use-selected-project"

const FIRST_REPO_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7"
const SECOND_REPO_ID = "b4f0a9d2-3c81-4e57-9f26-1d5a8b7c0e34"
const UNKNOWN_REPO_ID = "11111111-2222-3333-4444-555555555555"

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

  writeSelectedProjectId(FIRST_REPO_ID, store)

  expect(readSelectedProjectId(store)).toBe(FIRST_REPO_ID)
})

test("handles unavailable storage without throwing", () => {
  expect(readSelectedProjectId(null)).toBeUndefined()
  expect(writeSelectedProjectId(FIRST_REPO_ID, null)).toBe(FIRST_REPO_ID)
})

test("ignores and clears invalid stored values", () => {
  const store = memoryStorage()
  store.setItem(SELECTED_PROJECT_KEY, "not-a-repo-id")

  expect(readSelectedProjectId(store)).toBeUndefined()
  expect(store.getItem(SELECTED_PROJECT_KEY)).toBeNull()
})

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
