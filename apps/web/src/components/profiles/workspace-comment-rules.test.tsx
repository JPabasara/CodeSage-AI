import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, expect, test, vi } from "vitest"
import { WorkspaceCommentRules } from "./workspace-comment-rules"
import { ApiRequestError } from "@/lib/api/client"
import type { CommentRule } from "@/lib/types"

const getWorkspaceRules = vi.fn()
const updateWorkspaceCommentRules = vi.fn()
const testCommentPattern = vi.fn()
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  getWorkspaceRules: (...args: unknown[]) => getWorkspaceRules(...args),
  updateWorkspaceCommentRules: (...args: unknown[]) =>
    updateWorkspaceCommentRules(...args),
  testCommentPattern: (...args: unknown[]) => testCommentPattern(...args),
}))
const existing: CommentRule = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Security markers",
  match_type: "keyword",
  pattern: "SECURITY-TODO",
  case_sensitive: false,
  category: "security",
  severity: "high",
  enabled: true,
}
beforeEach(() => {
  getWorkspaceRules
    .mockReset()
    .mockResolvedValue({ rules: [], disabled_rule_ids: [], comment_rules: [] })
  updateWorkspaceCommentRules.mockReset().mockImplementation(async (rules) => ({
    rules: [],
    disabled_rule_ids: [],
    comment_rules: rules,
  }))
  testCommentPattern.mockReset().mockResolvedValue({ matched: true })
})
async function open(canEdit = true) {
  render(<WorkspaceCommentRules canEdit={canEdit} />)
  await userEvent.click(
    screen.getByRole("button", { name: "View comment rules" }),
  )
  await waitFor(() =>
    expect(
      screen.queryByText("Loading comment rules…"),
    ).not.toBeInTheDocument(),
  )
}

test("admin can test and save a regex comment rule with category and severity", async () => {
  await open()
  await userEvent.click(screen.getByRole("tab", { name: "Add rule" }))
  await userEvent.type(
    screen.getByRole("textbox", { name: "Comment rule name" }),
    "Security markers",
  )
  await userEvent.selectOptions(
    screen.getByRole("combobox", { name: "Comment match type" }),
    "regex",
  )
  await userEvent.type(
    screen.getByRole("textbox", { name: "Comment pattern" }),
    "\\bSECURITY-TODO\\b",
  )
  await userEvent.selectOptions(
    screen.getByRole("combobox", { name: "Comment category" }),
    "security",
  )
  await userEvent.selectOptions(
    screen.getByRole("combobox", { name: "Comment severity" }),
    "high",
  )
  await userEvent.type(
    screen.getByRole("textbox", { name: "Sample comment" }),
    "// SECURITY-TODO: fix auth",
  )
  await userEvent.click(screen.getByRole("button", { name: "Test pattern" }))
  expect(
    await screen.findByText("Pattern matches this sample."),
  ).toBeInTheDocument()
  expect(updateWorkspaceCommentRules).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole("button", { name: "Add rule" }))
  expect(
    await screen.findByRole("button", { name: "Edit Security markers" }),
  ).toBeInTheDocument()
  await userEvent.click(
    screen.getByRole("button", { name: "Save comment rules" }),
  )
  await screen.findByText("Saved. Run a new scan to apply these comment rules.")
  expect(updateWorkspaceCommentRules).toHaveBeenCalledWith([
    expect.objectContaining({
      name: "Security markers",
      pattern: "\\bSECURITY-TODO\\b",
      match_type: "regex",
      category: "security",
      severity: "high",
      enabled: true,
    }),
  ])
})

test("invalid patterns are reported before a rule is added", async () => {
  testCommentPattern.mockRejectedValue(
    new ApiRequestError(422, "VALIDATION_FAILED", "Invalid comment pattern."),
  )
  await open()
  await userEvent.click(screen.getByRole("tab", { name: "Add rule" }))
  await userEvent.type(
    screen.getByRole("textbox", { name: "Comment rule name" }),
    "Broken",
  )
  await userEvent.selectOptions(
    screen.getByRole("combobox", { name: "Comment match type" }),
    "regex",
  )
  await userEvent.type(
    screen.getByRole("textbox", { name: "Comment pattern" }),
    "[[",
  )
  await userEvent.click(screen.getByRole("button", { name: "Add rule" }))
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Invalid comment pattern.",
  )
  expect(
    screen.getByRole("button", { name: "Save comment rules" }),
  ).toBeDisabled()
  expect(
    screen.queryByRole("button", { name: "Edit Broken" }),
  ).not.toBeInTheDocument()
})

test("read-only users can search, inspect and test but cannot edit", async () => {
  getWorkspaceRules.mockResolvedValue({
    rules: [],
    disabled_rule_ids: [],
    comment_rules: [existing],
  })
  await open(false)
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument()
  expect(
    screen.queryByRole("button", { name: "Remove Security markers" }),
  ).not.toBeInTheDocument()
  await userEvent.type(
    screen.getByRole("searchbox", { name: "Search comment rules" }),
    "absent",
  )
  expect(
    screen.getByText("No comment rules match your search."),
  ).toBeInTheDocument()
  await userEvent.clear(
    screen.getByRole("searchbox", { name: "Search comment rules" }),
  )
  await userEvent.click(
    screen.getByRole("button", { name: "Inspect Security markers" }),
  )
  expect(
    screen.getByRole("textbox", { name: "Comment pattern" }),
  ).toBeDisabled()
  await userEvent.type(
    screen.getByRole("textbox", { name: "Sample comment" }),
    "// SECURITY-TODO: fix",
  )
  await userEvent.click(screen.getByRole("button", { name: "Test pattern" }))
  await screen.findByText("Pattern matches this sample.")
  expect(
    screen.queryByRole("button", { name: "Save comment rules" }),
  ).not.toBeInTheDocument()
  expect(updateWorkspaceCommentRules).not.toHaveBeenCalled()
})

test("editing preserves rule IDs and removing leaves the remaining rule unchanged", async () => {
  const second = {
    ...existing,
    id: "00000000-0000-4000-8000-000000000002",
    name: "Other markers",
  }
  getWorkspaceRules.mockResolvedValue({
    rules: [],
    disabled_rule_ids: [],
    comment_rules: [existing, second],
  })
  await open()
  await userEvent.click(
    screen.getByRole("button", { name: "Edit Security markers" }),
  )
  await userEvent.selectOptions(
    screen.getByRole("combobox", { name: "Comment severity" }),
    "critical",
  )
  await userEvent.click(screen.getByRole("button", { name: "Update rule" }))
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Update rule" }),
    ).not.toBeInTheDocument(),
  )
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument()
  expect(
    screen.queryByRole("button", { name: /Move .* (up|down)/ }),
  ).not.toBeInTheDocument()
  await userEvent.click(
    screen.getByRole("button", { name: "Remove Other markers" }),
  )
  await userEvent.click(
    screen.getByRole("button", { name: "Save comment rules" }),
  )
  await screen.findByText("Saved. Run a new scan to apply these comment rules.")
  expect(updateWorkspaceCommentRules).toHaveBeenCalledWith([
    { ...existing, severity: "critical" },
  ])
})

test("load failures cannot overwrite rules", async () => {
  getWorkspaceRules.mockRejectedValue(new Error("offline"))
  await open()
  await screen.findByRole("alert")
  expect(
    screen.getByRole("button", { name: "Save comment rules" }),
  ).toBeDisabled()
})

test("starts on added rules and keeps an unfinished draft when switching tabs", async () => {
  await open()
  expect(screen.getByRole("tab", { name: "Added rules (0)" })).toHaveAttribute(
    "aria-selected",
    "true",
  )
  expect(
    screen.queryByRole("textbox", { name: "Comment rule name" }),
  ).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole("tab", { name: "Add rule" }))
  await userEvent.type(
    screen.getByRole("textbox", { name: "Comment rule name" }),
    "Draft rule",
  )
  await userEvent.click(screen.getByRole("tab", { name: "Added rules (0)" }))
  expect(
    screen.getByRole("searchbox", { name: "Search comment rules" }),
  ).toBeInTheDocument()
  await userEvent.click(screen.getByRole("tab", { name: "Add rule" }))
  expect(
    screen.getByRole("textbox", { name: "Comment rule name" }),
  ).toHaveValue("Draft rule")
  expect(updateWorkspaceCommentRules).not.toHaveBeenCalled()
})
