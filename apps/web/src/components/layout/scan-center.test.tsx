import { act, render } from "@testing-library/react"
import { http, HttpResponse } from "msw"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

import { ScanCenter } from "./scan-center"
import { POLL_MS, scanKey, startScan, stopScan } from "@/hooks/use-scan-center"
import { DEMO_REPO_ID, WORKSPACE_ID } from "@/lib/mocks/fixtures"
import { server } from "@/lib/mocks/server"

const nav = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: vi.fn() }),
}))

const toasts = vi.hoisted(() => ({
  plain: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}))
vi.mock("sonner", () => ({
  toast: Object.assign(toasts.plain, {
    success: toasts.success,
    error: toasts.error,
  }),
}))

beforeEach(() => {
  vi.useFakeTimers()
  nav.push.mockClear()
  toasts.plain.mockClear()
  toasts.success.mockClear()
  toasts.error.mockClear()
})
afterEach(() => vi.useRealTimers())

const target = {
  workspaceId: WORKSPACE_ID,
  repoId: DEMO_REPO_ID,
  branch: "main",
  repoName: "acme-payments",
}
const polls = (n: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(POLL_MS * n)
  })

test("queued is acknowledged, and a finish says so with a way to the result", async () => {
  server.use(
    http.get("*/api/repos/:repoId/health", () =>
      HttpResponse.json({ health_score: 81.4, delta: 3, grade: "B" }),
    ),
  )
  render(<ScanCenter />)
  await act(() => startScan(target))
  expect(toasts.plain).toHaveBeenCalledWith(
    "Scan queued · acme-payments · main",
  )

  await polls(8)

  expect(toasts.success).toHaveBeenCalledWith(
    "Scan finished · health 81 (+3)",
    expect.objectContaining({ description: "acme-payments · main" }),
  )
  const { action } = toasts.success.mock.calls[0][1]
  action.onClick()
  expect(nav.push).toHaveBeenCalledWith(
    `/dashboard/${DEMO_REPO_ID}?branch=main`,
  )
})

test("a stop says the results are unchanged and offers Try again", async () => {
  render(<ScanCenter />)
  await act(() => startScan(target))
  await act(() => stopScan(scanKey(WORKSPACE_ID, DEMO_REPO_ID, "main")))
  await polls(1)

  expect(toasts.plain).toHaveBeenCalledWith(
    "Scan stopped · acme-payments · main",
    expect.objectContaining({
      description: "The previous results are unchanged.",
      action: expect.objectContaining({ label: "Try again" }),
    }),
  )
})

test("a start that fails explains, with Try again", async () => {
  server.use(
    http.post("*/api/repos/:repoId/scan", () =>
      HttpResponse.json(
        {
          detail: "GitHub is not answering right now.",
          code: "UPSTREAM_UNAVAILABLE",
        },
        { status: 503 },
      ),
    ),
  )
  render(<ScanCenter />)
  await act(() => startScan(target))

  expect(toasts.error).toHaveBeenCalledWith(
    "Couldn't start the scan",
    expect.objectContaining({
      description: "GitHub is not answering right now.",
      action: expect.objectContaining({ label: "Try again" }),
    }),
  )
})
