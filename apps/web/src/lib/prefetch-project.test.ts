import { http } from "msw"
import { afterEach, expect, test, vi } from "vitest"

import { healthKey } from "@/hooks/use-health-report"
import { readWorkspaceEpoch } from "@/hooks/use-workspace-scope"
import { DEMO_REPO_ID } from "@/lib/mocks/fixtures"
import { server } from "@/lib/mocks/server"
import {
  cancelProjectPrefetch,
  PREFETCH_WAIT_MS,
  prefetchProject,
} from "@/lib/prefetch-project"
import { readCached } from "@/lib/query-cache"

const repo = { id: DEMO_REPO_ID, default_branch: "main" }

afterEach(() => {
  cancelProjectPrefetch()
  vi.useRealTimers()
})

function countRequests() {
  const seen: string[] = []
  server.events.on("request:start", ({ request }) => {
    seen.push(new URL(request.url).pathname)
  })
  return seen
}

test("resting on a project warms its branches, report and history, and its route", async () => {
  const prefetchRoute = vi.fn()

  prefetchProject(repo, prefetchRoute)
  await vi.waitFor(
    () => {
      const epoch = readWorkspaceEpoch()
      expect(readCached(healthKey(epoch, DEMO_REPO_ID, "main"))).toBeDefined()
      expect(readCached(`${epoch}:branches:${DEMO_REPO_ID}`)).toBeDefined()
      expect(readCached(`${epoch}:scans:${DEMO_REPO_ID}:main`)).toBeDefined()
    },
    { timeout: 3000 },
  )
  expect(prefetchRoute).toHaveBeenCalledWith(`/dashboard/${DEMO_REPO_ID}`)
})

test("sweeping past a project, or leaving it, fetches nothing", async () => {
  vi.useFakeTimers()
  const seen = countRequests()
  const prefetchRoute = vi.fn()

  prefetchProject(repo, prefetchRoute)
  vi.advanceTimersByTime(PREFETCH_WAIT_MS - 1)
  cancelProjectPrefetch()
  vi.advanceTimersByTime(PREFETCH_WAIT_MS * 2)

  expect(prefetchRoute).not.toHaveBeenCalled()
  expect(seen).toEqual([])
  server.events.removeAllListeners()
})

test("a project already in the cache is not asked for again", async () => {
  const seen = countRequests()
  prefetchProject(repo)
  await vi.waitFor(() => expect(seen.length).toBeGreaterThanOrEqual(3), {
    timeout: 3000,
  })
  await new Promise((resolve) => setTimeout(resolve, 200))
  const first = seen.length

  server.use(
    http.get("*/api/repos/:repoId/*", () => {
      throw new Error("asked again")
    }),
  )
  prefetchProject(repo)
  await new Promise((resolve) => setTimeout(resolve, PREFETCH_WAIT_MS + 100))

  expect(seen.length).toBe(first)
  server.events.removeAllListeners()
})
