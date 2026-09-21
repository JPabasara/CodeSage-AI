import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, test, vi } from "vitest"

import { RefactorFirstList } from "@/components/dashboard/refactor-first-list"
import type { Finding } from "@/lib/types"

const findings: Finding[] = [
  {
    fingerprint: "a",
    source: "rule",
    category: "code-design",
    severity: "low",
    file: "a.ts",
    line: 1,
    symbol: "x",
    reason: "low one",
    status: "open",
    priority: 2,
    pinned_by_floor: false,
  },
  {
    fingerprint: "b",
    source: "rule",
    category: "security",
    severity: "critical",
    file: "b.ts",
    line: 2,
    symbol: "y",
    reason: "critical one",
    status: "open",
    priority: 40,
    pinned_by_floor: false,
  },
  {
    fingerprint: "c",
    source: "rule",
    category: "code-design",
    severity: "medium",
    file: "c.ts",
    line: 3,
    symbol: "z",
    reason: "medium one",
    status: "open",
    priority: 9,
    pinned_by_floor: false,
  },
]

test("sorts findings by priority, highest first", () => {
  render(<RefactorFirstList findings={findings} />)
  const rows = screen.getAllByRole("row")
  // rows[0] is the header; the first data row must be the highest-priority finding
  expect(within(rows[1]).getByText("critical one")).toBeInTheDocument()
})

test("labels the list as ranked by priority", () => {
  render(<RefactorFirstList findings={findings} />)
  expect(screen.getByText(/ranked by priority/i)).toBeInTheDocument()
})

test("clicking a row fires onSelect with that finding", async () => {
  const onSelect = vi.fn()
  render(<RefactorFirstList findings={findings} onSelect={onSelect} />)
  await userEvent.click(screen.getByText("critical one"))
  expect(onSelect).toHaveBeenCalledWith(findings[1])
})

test("filters the list by debt type", async () => {
  const user = userEvent.setup()
  render(<RefactorFirstList findings={findings} />)

  await user.click(
    screen.getByRole("combobox", { name: /filter by debt type/i }),
  )
  await user.click(await screen.findByRole("option", { name: "security" }))

  expect(screen.getByText("critical one")).toBeInTheDocument()
  expect(screen.queryByText("low one")).not.toBeInTheDocument()
})

test("zero findings displays the celebratory empty state (U-14)", () => {
  render(<RefactorFirstList findings={[]} />)

  expect(screen.getByText("No refactoring issues found")).toBeInTheDocument()
  expect(
    screen.getByText(
      /the scan found no technical debt or refactoring issues on this branch/i,
    ),
  ).toBeInTheDocument()
  expect(
    screen.getByText(
      /run a new scan after pushing code changes to keep track of code health/i,
    ),
  ).toBeInTheDocument()

  // Must not render a table
  expect(screen.queryByRole("table")).not.toBeInTheDocument()
})

test("filtered to nothing names the active filter and provides a clear filter button (U-14)", async () => {
  const user = userEvent.setup()
  render(<RefactorFirstList findings={findings} />)

  // findings only has code-design and security, so filtering by "test" produces 0 rows
  await user.click(
    screen.getByRole("combobox", { name: /filter by debt type/i }),
  )
  await user.click(await screen.findByRole("option", { name: "test" }))

  // Names what is empty and states which filter
  expect(screen.getByText("No findings match this filter")).toBeInTheDocument()
  expect(
    screen.getByText(/no findings match the “test” filter/i),
  ).toBeInTheDocument()

  // Visually and textually distinct: must NOT show the zero-findings clean copy
  expect(
    screen.queryByText("No refactoring issues found"),
  ).not.toBeInTheDocument()

  // Offers clear-filter action
  const clearBtn = screen.getByRole("button", { name: /clear filter/i })
  expect(clearBtn).toBeInTheDocument()

  // Clicking clear-filter resets the filter and restores all findings
  await user.click(clearBtn)
  expect(screen.getByText("critical one")).toBeInTheDocument()
  expect(screen.getByText("low one")).toBeInTheDocument()
  expect(screen.getByText("medium one")).toBeInTheDocument()
  expect(
    screen.queryByText("No findings match this filter"),
  ).not.toBeInTheDocument()
})

// ── keyboard operability (U-9, #115) ────────────────────────────────────────
//
// These rows were `onClick` on a plain <tr>: no tab stop, no key handler. The
// core triage flow — open the worst finding — could not be reached by keyboard
// at all, which is the single biggest thing U-9 asks about.

test("a finding row is a tab stop", async () => {
  render(<RefactorFirstList findings={findings} />)

  const row = screen.getAllByRole("row")[1] // [0] is the header
  expect(row).toHaveAttribute("tabindex", "0")

  await userEvent.tab()
  // The filter is the first stop on this component; the first row follows it.
  await userEvent.tab()
  expect(row).toHaveFocus()
})

test("Enter on a focused row opens that finding", async () => {
  const onSelect = vi.fn()
  render(<RefactorFirstList findings={findings} onSelect={onSelect} />)

  const row = screen.getAllByRole("row")[1]
  row.focus()
  await userEvent.keyboard("{Enter}")

  expect(onSelect).toHaveBeenCalledWith(findings[1]) // the critical one, sorted first
})

test("Space on a focused row opens it too, without scrolling the page", async () => {
  const onSelect = vi.fn()
  render(<RefactorFirstList findings={findings} onSelect={onSelect} />)

  const row = screen.getAllByRole("row")[1]
  row.focus()
  await userEvent.keyboard(" ")

  expect(onSelect).toHaveBeenCalledWith(findings[1])
})

test("the selected row says so to a screen reader, not only in colour", async () => {
  render(<RefactorFirstList findings={findings} selectedFingerprint="b" />)

  const row = screen.getAllByRole("row")[1]
  expect(row).toHaveAttribute("aria-current", "true")
  // and the unselected one does not claim to be current
  expect(screen.getAllByRole("row")[2]).not.toHaveAttribute("aria-current")
})
