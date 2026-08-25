import { renderHook, waitFor } from "@testing-library/react"
import { expect, test } from "vitest"
import { useHealthReport } from "./use-health-report"
import { DEMO_REPO_ID } from "@/lib/mocks/fixtures"

// Proves the Phase 8 data path end-to-end in tests: hook → client → MSW handler.
// No fixture is imported here — the data arrives over (mocked) fetch, exactly as
// it will from the real backend.

test("starts loading, then resolves the report for the branch", async () => {
  const { result } = renderHook(() => useHealthReport(DEMO_REPO_ID, "main"))

  expect(result.current.loading).toBe(true)
  expect(result.current.data).toBeUndefined()

  await waitFor(() => expect(result.current.loading).toBe(false))

  expect(result.current.error).toBeUndefined()
  expect(result.current.data?.health_score).toBe(72)
  expect(result.current.data?.grade).toBe("B")
})

test("refetches when the branch changes", async () => {
  const { result, rerender } = renderHook(
    ({ branch }: { branch: string }) => useHealthReport(DEMO_REPO_ID, branch),
    { initialProps: { branch: "main" } },
  )

  await waitFor(() => expect(result.current.data?.health_score).toBe(72))

  rerender({ branch: "develop" })

  // stale data is cleared immediately, then the new branch resolves
  expect(result.current.loading).toBe(true)
  await waitFor(() => expect(result.current.data?.health_score).toBe(66))
})

test("surfaces an error for an unknown repo instead of throwing", async () => {
  const { result } = renderHook(() => useHealthReport("11111111-2222-3333-4444-555555555555", "main"))

  await waitFor(() => expect(result.current.loading).toBe(false))

  expect(result.current.error).toBeInstanceOf(Error)
  expect(result.current.data).toBeUndefined()
})
