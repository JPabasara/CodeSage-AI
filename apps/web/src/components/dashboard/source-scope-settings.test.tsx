import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, expect, test, vi } from "vitest"

import { SourceScopeSettings } from "@/components/dashboard/source-scope-settings"
import type { TreeNode } from "@/lib/types"

const getSourceScopeConfig = vi.fn()
const updateSourceScopeConfig = vi.fn()

vi.mock("@/lib/api/client", () => ({
  getSourceScopeConfig: (...args: unknown[]) => getSourceScopeConfig(...args),
  updateSourceScopeConfig: (...args: unknown[]) =>
    updateSourceScopeConfig(...args),
}))

const nodes: TreeNode[] = [
  {
    path: "src/test/java/com/acme/ThingTest.java",
    name: "ThingTest.java",
    type: "file",
    health_score: 80,
    grade: "B",
    debt_score: 1,
  },
]

beforeEach(() => {
  getSourceScopeConfig.mockReset()
  updateSourceScopeConfig.mockReset()
  getSourceScopeConfig.mockResolvedValue({
    test_path_patterns: ["**/src/test/**"],
    production_path_overrides: [],
  })
  updateSourceScopeConfig.mockResolvedValue({
    test_path_patterns: ["**/src/test/**"],
    production_path_overrides: ["src/test/java/com/acme/ThingTest.java"],
  })
})

test("shows saved test matches as checked tree nodes", async () => {
  const user = userEvent.setup()
  render(<SourceScopeSettings repoId="repo-1" nodes={nodes} />)

  await user.click(screen.getByRole("button", { name: "Configure test paths" }))

  expect(
    await screen.findByRole("checkbox", { name: "ThingTest.java" }),
  ).toBeChecked()
  expect(screen.getByText("1 files selected")).toBeInTheDocument()
})

test("unchecking a broad glob match saves a production override", async () => {
  const user = userEvent.setup()
  render(<SourceScopeSettings repoId="repo-1" nodes={nodes} />)

  await user.click(screen.getByRole("button", { name: "Configure test paths" }))
  const checkbox = await screen.findByRole("checkbox", {
    name: "ThingTest.java",
  })
  await user.click(checkbox)
  await user.click(screen.getByRole("button", { name: "Save configuration" }))

  await waitFor(() =>
    expect(updateSourceScopeConfig).toHaveBeenCalledWith("repo-1", {
      test_path_patterns: ["**/src/test/**"],
      production_path_overrides: ["src/test/java/com/acme/ThingTest.java"],
    }),
  )
})
