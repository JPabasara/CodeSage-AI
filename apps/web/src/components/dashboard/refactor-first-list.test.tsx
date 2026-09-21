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

function findingCards() {
  return within(
    screen.getByRole("list", { name: /ranked refactor findings/i }),
  ).getAllByRole("button")
}

test("sorts findings by priority, highest first", () => {
  render(<RefactorFirstList findings={findings} />)

  expect(findingCards()[0]).toHaveTextContent("critical one")
})

test("labels the list as ranked by priority", () => {
  render(<RefactorFirstList findings={findings} />)
  expect(screen.getByText(/ranked by priority/i)).toBeInTheDocument()
})

test("clicking a finding card fires onSelect with that finding", async () => {
  const onSelect = vi.fn()
  render(<RefactorFirstList findings={findings} onSelect={onSelect} />)

  await userEvent.click(screen.getByRole("button", { name: /critical one/i }))

  expect(onSelect).toHaveBeenCalledWith(findings[1])
})

test("cards include source, category and compact location", () => {
  render(<RefactorFirstList findings={findings} />)

  const critical = screen.getByRole("button", { name: /critical one/i })
  expect(critical).toHaveTextContent("security")
  expect(critical).toHaveTextContent("rule")
  expect(critical).toHaveTextContent("b.ts:2")
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

  expect(screen.queryByRole("table")).not.toBeInTheDocument()
})

test("filtered to nothing names the active filter and provides a clear filter button (U-14)", async () => {
  const user = userEvent.setup()
  render(<RefactorFirstList findings={findings} />)

  await user.click(
    screen.getByRole("combobox", { name: /filter by debt type/i }),
  )
  await user.click(await screen.findByRole("option", { name: "test" }))

  expect(screen.getByText("No findings match this filter")).toBeInTheDocument()
  expect(screen.getByText(/test.*filter/i)).toBeInTheDocument()
  expect(
    screen.queryByText("No refactoring issues found"),
  ).not.toBeInTheDocument()

  const clearBtn = screen.getByRole("button", { name: /clear filter/i })
  expect(clearBtn).toBeInTheDocument()

  await user.click(clearBtn)
  expect(screen.getByText("critical one")).toBeInTheDocument()
  expect(screen.getByText("low one")).toBeInTheDocument()
  expect(screen.getByText("medium one")).toBeInTheDocument()
  expect(
    screen.queryByText("No findings match this filter"),
  ).not.toBeInTheDocument()
})

test("a finding card is a tab stop", async () => {
  render(<RefactorFirstList findings={findings} />)

  const card = screen.getByRole("button", { name: /critical one/i })

  await userEvent.tab()
  await userEvent.tab()
  expect(card).toHaveFocus()
})

test("Enter on a focused card opens that finding", async () => {
  const onSelect = vi.fn()
  render(<RefactorFirstList findings={findings} onSelect={onSelect} />)

  const card = screen.getByRole("button", { name: /critical one/i })
  card.focus()
  await userEvent.keyboard("{Enter}")

  expect(onSelect).toHaveBeenCalledWith(findings[1])
})

test("Space on a focused card opens it too, without scrolling the page", async () => {
  const onSelect = vi.fn()
  render(<RefactorFirstList findings={findings} onSelect={onSelect} />)

  const card = screen.getByRole("button", { name: /critical one/i })
  card.focus()
  await userEvent.keyboard(" ")

  expect(onSelect).toHaveBeenCalledWith(findings[1])
})

test("the selected card says so to a screen reader, not only in colour", () => {
  render(<RefactorFirstList findings={findings} selectedFingerprint="b" />)

  const selected = screen.getByRole("button", {
    name: /critical one/i,
    current: true,
  })
  expect(selected).toHaveAttribute("aria-current", "true")
  expect(
    screen.getByRole("button", { name: /medium one/i }),
  ).not.toHaveAttribute("aria-current")
})
