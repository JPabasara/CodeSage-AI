import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, expect, test, vi } from "vitest"
import { DisableRuleButton } from "./disable-rule-button"
import { FindingDetailPanel } from "./finding-detail-panel"
import type { Finding } from "@/lib/types"

const { getWorkspaceRules, updateWorkspaceRules } = vi.hoisted(() => ({
  getWorkspaceRules: vi.fn(),
  updateWorkspaceRules: vi.fn(),
}))
vi.mock("@/lib/api/client", () => ({ getWorkspaceRules, updateWorkspaceRules }))
beforeEach(() => {
  getWorkspaceRules
    .mockReset()
    .mockResolvedValue({ disabled_rule_ids: ["large-file"] })
  updateWorkspaceRules.mockReset().mockResolvedValue({})
})
async function confirm() {
  await userEvent.click(
    screen.getByRole("button", { name: "Disable this rule" }),
  )
  return within(screen.getByRole("dialog"))
}
test("confirms workspace scope and preserves other disabled rules", async () => {
  render(<DisableRuleButton ruleId="pmd:EmptyCatchBlock" />)
  const dialog = await confirm()
  expect(
    dialog.getByText(/future scans across all repositories/),
  ).toBeInTheDocument()
  expect(
    dialog.getByRole("link", { name: "Profiles → Rules" }),
  ).toHaveAttribute("href", "/profiles")
  expect(updateWorkspaceRules).not.toHaveBeenCalled()
  await userEvent.click(dialog.getByRole("button", { name: "Disable rule" }))
  await screen.findByRole("button", { name: "Rule disabled" })
  expect(updateWorkspaceRules).toHaveBeenCalledWith([
    "large-file",
    "pmd:EmptyCatchBlock",
  ])
})
test("cancel makes no API changes", async () => {
  render(<DisableRuleButton ruleId="long-method" />)
  const dialog = await confirm()
  await userEvent.click(dialog.getByRole("button", { name: "Cancel" }))
  expect(getWorkspaceRules).not.toHaveBeenCalled()
  expect(updateWorkspaceRules).not.toHaveBeenCalled()
})
test("an already disabled rule needs no write", async () => {
  render(<DisableRuleButton ruleId="large-file" />)
  const dialog = await confirm()
  await userEvent.click(dialog.getByRole("button", { name: "Disable rule" }))
  expect(
    await screen.findByRole("button", { name: "Rule disabled" }),
  ).toBeDisabled()
  expect(updateWorkspaceRules).not.toHaveBeenCalled()
})
test("failed saves remain open for retry", async () => {
  updateWorkspaceRules.mockRejectedValueOnce(new Error("Forbidden"))
  render(<DisableRuleButton ruleId="long-method" />)
  const dialog = await confirm()
  await userEvent.click(dialog.getByRole("button", { name: "Disable rule" }))
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not disable this rule",
  )
  await userEvent.click(dialog.getByRole("button", { name: "Disable rule" }))
  await screen.findByRole("button", { name: "Rule disabled" })
  expect(updateWorkspaceRules).toHaveBeenCalledTimes(2)
})
const finding: Finding = {
  fingerprint: "test",
  source: "rule",
  category: "code-design",
  severity: "medium",
  file: "Main.java",
  line: 1,
  symbol: "main",
  rule_id: "long-method",
  reason: "Long method",
  status: "open",
  priority: 1,
  pinned_by_floor: false,
}
test("only authorized panels with deterministic rules offer the action", () => {
  const view = render(
    <FindingDetailPanel finding={finding} onClose={vi.fn()} />,
  )
  expect(
    screen.queryByRole("button", { name: "Disable this rule" }),
  ).not.toBeInTheDocument()
  view.rerender(
    <FindingDetailPanel finding={finding} onClose={vi.fn()} canDisableRules />,
  )
  expect(
    screen.getByRole("button", { name: "Disable this rule" }),
  ).toBeInTheDocument()
  for (const other of [
    { ...finding, source: "satd" as const },
    { ...finding, rule_id: "comment-pattern" },
    { ...finding, rule_id: undefined },
  ]) {
    view.rerender(
      <FindingDetailPanel finding={other} onClose={vi.fn()} canDisableRules />,
    )
    expect(
      screen.queryByRole("button", { name: "Disable this rule" }),
    ).not.toBeInTheDocument()
  }
})
