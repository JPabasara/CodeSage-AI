import { afterEach, expect, test } from "vitest"

import {
  clearQueryCache,
  fetchShared,
  forgetScanResults,
  forgetScores,
  readCached,
} from "./query-cache"

afterEach(() => clearQueryCache())

const seed = (...keys: string[]) =>
  Promise.all(keys.map((key) => fetchShared(key, () => Promise.resolve(key))))

test("a finished scan forgets only that branch's report and history", async () => {
  await seed(
    "0:health:r1:main:latest",
    "0:health:r1:main:snap-1",
    "0:health:r1:dev:latest",
    "0:health:r2:main:latest",
    "0:scans:r1:main",
    "0:projects",
    "0:profiles",
  )

  forgetScanResults("r1", "main")

  expect(readCached("0:health:r1:main:latest")).toBeUndefined()
  expect(readCached("0:health:r1:main:snap-1")).toBeUndefined()
  expect(readCached("0:scans:r1:main")).toBeUndefined()
  expect(readCached("0:projects")).toBeUndefined() // the list's health hint
  // Other branches, other projects and profiles did not change.
  expect(readCached("0:health:r1:dev:latest")).toBeDefined()
  expect(readCached("0:health:r2:main:latest")).toBeDefined()
  expect(readCached("0:profiles")).toBeDefined()
})

test("a profile write forgets every report but not unrelated reads", async () => {
  await seed(
    "0:health:r1:main:latest",
    "0:health:r2:dev:latest",
    "0:projects/r1/profile",
    "0:profiles",
    "0:members",
    "0:branches:r1",
  )

  forgetScores()

  expect(readCached("0:health:r1:main:latest")).toBeUndefined()
  expect(readCached("0:health:r2:dev:latest")).toBeUndefined()
  expect(readCached("0:projects/r1/profile")).toBeUndefined()
  expect(readCached("0:profiles")).toBeUndefined()
  expect(readCached("0:members")).toBeDefined()
  expect(readCached("0:branches:r1")).toBeDefined()
})

test("an answer that lands after it was forgotten is not cached", async () => {
  let resolve!: (value: string) => void
  const request = fetchShared(
    "0:health:r1:main:latest",
    () => new Promise<string>((res) => (resolve = res)),
  )
  forgetScores() // a profile changed while the report was on its way
  resolve("pre-write report")
  await request

  expect(readCached("0:health:r1:main:latest")).toBeUndefined()
})

test("a failed read drops the old answer", async () => {
  await seed("0:health:r1:main:latest")
  await expect(
    fetchShared("0:health:r1:main:latest", () =>
      Promise.reject(new Error("gone")),
    ),
  ).rejects.toThrow("gone")
  expect(readCached("0:health:r1:main:latest")).toBeUndefined()
})
