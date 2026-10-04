import { delay, http, HttpResponse } from "msw"
import { expect, test } from "vitest"

import { FINDINGS_PAGE_SIZE, getHealthReport } from "@/lib/api/client"
import { server } from "@/lib/mocks/server"

const REPO = "11111111-1111-4111-8111-111111111111"

test("the summary and the first page load together, later pages one at a time", async () => {
  const total = FINDINGS_PAGE_SIZE * 2 + 100
  const findings = Array.from({ length: total }, (_, index) => ({
    fingerprint: `f${index}`,
  }))
  const offsets: number[] = []
  const limits: number[] = []
  let inFlight = 0
  let mostAtOnce = 0
  let pagesAtOnce = 0
  let mostPagesAtOnce = 0

  const track = async (isPage: boolean, answer: () => Response) => {
    inFlight += 1
    mostAtOnce = Math.max(mostAtOnce, inFlight)
    if (isPage) {
      pagesAtOnce += 1
      mostPagesAtOnce = Math.max(mostPagesAtOnce, pagesAtOnce)
    }
    await delay(20)
    inFlight -= 1
    if (isPage) pagesAtOnce -= 1
    return answer()
  }

  server.use(
    http.get("*/api/repos/:repoId/health", ({ request }) =>
      track(false, () => {
        expect(new URL(request.url).searchParams.get("include_findings")).toBe(
          "false",
        )
        return HttpResponse.json({ snapshot_id: "s1", findings: [] })
      }),
    ),
    http.get("*/api/repos/:repoId/health/findings", ({ request }) =>
      track(true, () => {
        const params = new URL(request.url).searchParams
        const offset = Number(params.get("offset"))
        const limit = Number(params.get("limit"))
        offsets.push(offset)
        limits.push(limit)
        return HttpResponse.json({
          items: findings.slice(offset, offset + limit),
          total,
          limit,
          offset,
        })
      }),
    ),
  )

  const report = await getHealthReport(REPO, "main")

  expect(report.findings).toHaveLength(total)
  expect(report.findings.at(-1)).toEqual({ fingerprint: `f${total - 1}` })
  expect(offsets).toEqual([0, FINDINGS_PAGE_SIZE, FINDINGS_PAGE_SIZE * 2])
  expect(new Set(limits)).toEqual(new Set([FINDINGS_PAGE_SIZE]))
  // The summary overlaps the first page; pages never overlap each other.
  expect(mostAtOnce).toBe(2)
  expect(mostPagesAtOnce).toBe(1)
})

test("a repository that fits in one page costs exactly two requests", async () => {
  let requests = 0
  server.use(
    http.get("*/api/repos/:repoId/health", () => {
      requests += 1
      return HttpResponse.json({ snapshot_id: "s1", findings: [] })
    }),
    http.get("*/api/repos/:repoId/health/findings", () => {
      requests += 1
      return HttpResponse.json({
        items: [{ fingerprint: "only" }],
        total: 1,
        limit: FINDINGS_PAGE_SIZE,
        offset: 0,
      })
    }),
  )

  const report = await getHealthReport(REPO, "main")

  expect(report.findings).toEqual([{ fingerprint: "only" }])
  expect(requests).toBe(2)
})
