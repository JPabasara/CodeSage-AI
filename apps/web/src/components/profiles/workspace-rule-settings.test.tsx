import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, expect, test, vi } from "vitest"
import { WorkspaceRuleSettings } from "./workspace-rule-settings"

const getWorkspaceRules = vi.fn()
const updateWorkspaceRules = vi.fn()
vi.mock("@/lib/api/client", () => ({
  getWorkspaceRules: (...args: unknown[]) => getWorkspaceRules(...args),
  updateWorkspaceRules: (...args: unknown[]) => updateWorkspaceRules(...args),
}))
const rules = [
  {
    rule_id: "large-file",
    category: "code-design",
    description: "Large files.",
  },
  {
    rule_id: "hardcoded-secret",
    category: "security",
    description: "Secrets in code.",
  },
]
beforeEach(() => {
  getWorkspaceRules
    .mockReset()
    .mockResolvedValue({ rules, disabled_rule_ids: [] })
  updateWorkspaceRules
    .mockReset()
    .mockImplementation(async (disabled_rule_ids) => ({
      rules,
      disabled_rule_ids,
    }))
})
async function open() {
  await userEvent.click(
    screen.getByRole("button", { name: "View workspace rules" }),
  )
  return screen.findByRole("checkbox", { name: "large file" })
}

test("rules start selected and only changed selections can be saved", async () => {
  render(<WorkspaceRuleSettings canEdit />)
  const checkbox = await open()
  expect(checkbox).toBeChecked()
  expect(
    screen.getByRole("checkbox", { name: "hardcoded secret" }),
  ).toBeChecked()
  expect(screen.getByRole("button", { name: "Save rules" })).toBeDisabled()
  await userEvent.click(checkbox)
  await userEvent.click(screen.getByRole("button", { name: "Save rules" }))
  await screen.findByText("Saved. Run a new scan to apply these rules.")
  expect(updateWorkspaceRules).toHaveBeenCalledWith(["large-file"])
  expect(screen.getByRole("button", { name: "Save rules" })).toBeDisabled()
  expect(screen.getByText(/even without a new commit/)).toBeInTheDocument()
})

test("read-only users can inspect saved choices", async () => {
  getWorkspaceRules.mockResolvedValue({
    rules,
    disabled_rule_ids: ["large-file"],
  })
  render(<WorkspaceRuleSettings canEdit={false} />)
  expect(await open()).not.toBeChecked()
  for (const checkbox of screen.getAllByRole("checkbox"))
    expect(checkbox).toBeDisabled()
  expect(
    screen.queryByRole("button", { name: "Save rules" }),
  ).not.toBeInTheDocument()
})

test("failed loads cannot overwrite workspace selection", async () => {
  getWorkspaceRules.mockRejectedValue(new Error("offline"))
  render(<WorkspaceRuleSettings canEdit />)
  await userEvent.click(
    screen.getByRole("button", { name: "View workspace rules" }),
  )
  await screen.findByRole("alert")
  expect(screen.getByRole("button", { name: "Save rules" })).toBeDisabled()
  expect(updateWorkspaceRules).not.toHaveBeenCalled()
})

test("failed save preserves choices and allows retry", async () => {
  updateWorkspaceRules.mockRejectedValueOnce(new Error("offline"))
  render(<WorkspaceRuleSettings canEdit />)
  const checkbox = await open()
  await userEvent.click(checkbox)
  await userEvent.click(screen.getByRole("button", { name: "Save rules" }))
  await screen.findByRole("alert")
  expect(checkbox).not.toBeChecked()
  await userEvent.click(screen.getByRole("button", { name: "Save rules" }))
  await waitFor(() => expect(updateWorkspaceRules).toHaveBeenCalledTimes(2))
  await screen.findByText("Saved. Run a new scan to apply these rules.")
})

test("search matches names, descriptions and categories without changing selections", async () => {
  render(<WorkspaceRuleSettings canEdit />)
  await open()
  const search = screen.getByRole("searchbox", { name: "Search rules" })
  for (const query of ["  LARGE  ", "code design", "large-file"]) {
    await userEvent.clear(search)
    await userEvent.type(search, query)
    expect(screen.getByRole("checkbox", { name: "large file" })).toBeChecked()
    expect(
      screen.queryByRole("checkbox", { name: "hardcoded secret" }),
    ).not.toBeInTheDocument()
  }
  await userEvent.click(screen.getByRole("checkbox", { name: "large file" }))
  await userEvent.clear(search)
  await userEvent.type(search, "Secrets in code")
  expect(
    screen.getByRole("checkbox", { name: "hardcoded secret" }),
  ).toBeChecked()
  await userEvent.clear(search)
  await userEvent.type(search, "no-matching-rule")
  expect(screen.getByText("No rules match your search.")).toBeInTheDocument()
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: "Save rules" }))
  expect(updateWorkspaceRules).toHaveBeenCalledWith(["large-file"])
})

test("read-only users can search and clearing search restores all choices", async () => {
  render(<WorkspaceRuleSettings canEdit={false} />)
  await open()
  const search = screen.getByRole("searchbox", { name: "Search rules" })
  await userEvent.type(search, "security")
  expect(
    screen.getByRole("checkbox", { name: "hardcoded secret" }),
  ).toBeDisabled()
  expect(
    screen.queryByRole("checkbox", { name: "large file" }),
  ).not.toBeInTheDocument()
  await userEvent.clear(search)
  expect(screen.getByRole("checkbox", { name: "large file" })).toBeChecked()
})
