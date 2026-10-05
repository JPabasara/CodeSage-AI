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
  render(<SourceScopeSettings repoId="repo-1" nodes={nodes} canEdit />)

  await user.click(screen.getByRole("button", { name: "Directory exclusions" }))

  expect(
    await screen.findByRole("checkbox", { name: "ThingTest.java" }),
  ).toBeChecked()
  expect(screen.getAllByRole("radio")).toHaveLength(2)
  expect(
    screen.getByText(
      /Detected test files and directories are ticked automatically/,
    ),
  ).toBeInTheDocument()
  expect(screen.getByText("1 files selected")).toBeInTheDocument()
})

test("unchecking a broad glob match saves a production override", async () => {
  const user = userEvent.setup()
  render(<SourceScopeSettings repoId="repo-1" nodes={nodes} canEdit />)

  await user.click(screen.getByRole("button", { name: "Directory exclusions" }))
  const checkbox = await screen.findByRole("checkbox", {
    name: "ThingTest.java",
  })
  await user.click(checkbox)
  await user.click(screen.getByRole("button", { name: "Save configuration" }))

  await waitFor(() =>
    expect(updateSourceScopeConfig).toHaveBeenCalledWith("repo-1", {
      test_path_patterns: ["**/src/test/**"],
      production_path_overrides: ["src/test/java/com/acme/ThingTest.java"],
      scan_excluded_directories: false,
      hide_excluded_findings: false,
    }),
  )
})

test("read-only users can inspect exclusions but cannot change them", async () => {
  render(<SourceScopeSettings repoId="repo-1" nodes={nodes} />)
  await userEvent.click(
    screen.getByRole("button", { name: "Directory exclusions" }),
  )
  const checkbox = await screen.findByRole("checkbox", {
    name: "ThingTest.java",
  })
  expect(checkbox).toBeChecked()
  expect(checkbox).toBeDisabled()
  expect(
    screen.queryByRole("button", { name: "Save configuration" }),
  ).not.toBeInTheDocument()
  expect(updateSourceScopeConfig).not.toHaveBeenCalled()
})

test.each([
  ["Exclude from scans", false, false],
  ["Hide from Refactor first by default", true, true],
])(
  "%s saves the corresponding scan and visibility settings",
  async (label, scan, hide) => {
    render(<SourceScopeSettings repoId="repo-1" nodes={nodes} canEdit />)
    await userEvent.click(
      screen.getByRole("button", { name: "Directory exclusions" }),
    )
    await screen.findByRole("checkbox", { name: "ThingTest.java" })
    expect(
      screen.getByRole("radio", { name: "Exclude from scans" }),
    ).toBeChecked()
    await userEvent.click(screen.getByRole("radio", { name: label }))
    await userEvent.click(
      screen.getByRole("button", { name: "Save configuration" }),
    )
    expect(updateSourceScopeConfig).toHaveBeenCalledWith(
      "repo-1",
      expect.objectContaining({
        scan_excluded_directories: scan,
        hide_excluded_findings: hide,
      }),
    )
  },
)

test("switching from hidden findings to skipping clears both settings", async () => {
  getSourceScopeConfig.mockResolvedValue({
    test_path_patterns: [],
    production_path_overrides: [],
    scan_excluded_directories: true,
    hide_excluded_findings: true,
    file_paths: ["src/main/A.java"],
  })
  render(<SourceScopeSettings repoId="repo-1" canEdit initialOpen />)
  await screen.findByRole("checkbox", { name: "src" })
  expect(
    screen.getByRole("radio", { name: "Hide from Refactor first by default" }),
  ).toBeChecked()
  await userEvent.click(
    screen.getByRole("radio", { name: "Exclude from scans" }),
  )
  await userEvent.click(
    screen.getByRole("button", { name: "Save configuration" }),
  )
  expect(updateSourceScopeConfig).toHaveBeenCalledWith(
    "repo-1",
    expect.objectContaining({
      scan_excluded_directories: false,
      hide_excluded_findings: false,
    }),
  )
})

test.each([false, true])(
  "directory search works in a read-only dialog with initialOpen=%s",
  async (initialOpen) => {
    getSourceScopeConfig.mockResolvedValue({
      test_path_patterns: ["**/src/test/**"],
      production_path_overrides: [],
      file_paths: ["src/test/ThingTest.java", "src/main/App.java"],
    })
    render(<SourceScopeSettings repoId="repo-1" initialOpen={initialOpen} />)
    if (!initialOpen)
      await userEvent.click(
        screen.getByRole("button", { name: "Directory exclusions" }),
      )
    await screen.findByRole("checkbox", { name: "src" })
    expect(
      screen.getByRole("button", { name: "Expand src" }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("checkbox", { name: "ThingTest.java" }),
    ).not.toBeInTheDocument()
    const search = screen.getByRole("searchbox", {
      name: "Search files and directories",
    })
    await userEvent.type(search, "  SRC/TEST  ")
    expect(
      screen.getByRole("checkbox", { name: "ThingTest.java" }),
    ).toBeChecked()
    expect(
      screen.getByRole("checkbox", { name: "ThingTest.java" }),
    ).toBeDisabled()
    expect(
      screen.queryByRole("checkbox", { name: "App.java" }),
    ).not.toBeInTheDocument()
    await userEvent.clear(search)
    // Search temporarily opens matching ancestors without changing expansion preferences.
    expect(
      screen.queryByRole("checkbox", { name: "ThingTest.java" }),
    ).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Expand src" }))
    await userEvent.click(screen.getByRole("button", { name: "Expand main" }))
    expect(
      screen.getByRole("checkbox", { name: "App.java" }),
    ).toBeInTheDocument()
  },
)

test("filtered folder checkboxes still select the entire folder and save hidden choices", async () => {
  getSourceScopeConfig.mockResolvedValue({
    test_path_patterns: [],
    production_path_overrides: [],
    file_paths: [
      "src/main/Alpha.java",
      "src/main/Beta.java",
      "src/test/ThingTest.java",
    ],
  })
  render(<SourceScopeSettings repoId="repo-1" canEdit initialOpen />)
  await screen.findByRole("checkbox", { name: "src" })
  const search = screen.getByRole("searchbox", {
    name: "Search files and directories",
  })
  await userEvent.type(search, "ALPHA")
  expect(
    screen.queryByRole("checkbox", { name: "Beta.java" }),
  ).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole("checkbox", { name: "main" }))
  expect(screen.getByText("2 files selected")).toBeInTheDocument()
  await userEvent.clear(search)
  await userEvent.click(screen.getByRole("button", { name: "Expand src" }))
  await userEvent.click(screen.getByRole("button", { name: "Expand main" }))
  expect(screen.getByRole("checkbox", { name: "Beta.java" })).toBeChecked()
  await userEvent.type(search, "no-matching-path")
  expect(
    screen.getByText("No files or directories match your search."),
  ).toBeInTheDocument()
  await userEvent.click(
    screen.getByRole("button", { name: "Save configuration" }),
  )
  expect(updateSourceScopeConfig).toHaveBeenCalledWith(
    "repo-1",
    expect.objectContaining({ test_path_patterns: ["src/main/**"] }),
  )
})

test("shows loading text before directories arrive, then starts with folders collapsed", async () => {
  let resolve!: (config: unknown) => void
  getSourceScopeConfig.mockReturnValue(
    new Promise((done) => {
      resolve = done
    }),
  )
  render(<SourceScopeSettings repoId="repo-1" canEdit initialOpen />)
  expect(screen.getByRole("status")).toHaveTextContent("Loading directories…")
  expect(
    screen.queryByText("No Java files are available to select."),
  ).not.toBeInTheDocument()
  resolve({
    test_path_patterns: [],
    production_path_overrides: [],
    file_paths: ["src/main/App.java"],
  })
  await screen.findByRole("button", { name: "Expand src" })
  expect(screen.queryByRole("status")).not.toBeInTheDocument()
  expect(
    screen.queryByRole("checkbox", { name: "App.java" }),
  ).not.toBeInTheDocument()
})
