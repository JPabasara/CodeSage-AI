import { beforeEach, expect, test } from "vitest"

import {
  readSelectedBranch,
  SELECTED_BRANCH_KEY,
  writeSelectedBranch,
} from "./use-selected-branch"

beforeEach(() => localStorage.clear())

test("remembered per workspace and repository", () => {
  writeSelectedBranch("ws-1", "repo-a", "develop")
  writeSelectedBranch("ws-1", "repo-b", "release")

  expect(readSelectedBranch("ws-1", "repo-a")).toBe("develop")
  expect(readSelectedBranch("ws-1", "repo-b")).toBe("release")
  // Another workspace never reads this one's choice.
  expect(readSelectedBranch("ws-2", "repo-a")).toBeUndefined()
})

test("no workspace, nothing remembered", () => {
  writeSelectedBranch(null, "repo-a", "develop")
  expect(localStorage.getItem(SELECTED_BRANCH_KEY)).toBeNull()
  expect(readSelectedBranch(null, "repo-a")).toBeUndefined()
})

test("a corrupt value is treated as nothing remembered", () => {
  localStorage.setItem(SELECTED_BRANCH_KEY, "{not json")
  expect(readSelectedBranch("ws-1", "repo-a")).toBeUndefined()
  writeSelectedBranch("ws-1", "repo-a", "main")
  expect(readSelectedBranch("ws-1", "repo-a")).toBe("main")
})
