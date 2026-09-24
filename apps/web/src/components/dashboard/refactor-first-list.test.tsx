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

test("renders explicit rank (#) badge with 1-based sequential rank numbers", () => {
  render(<RefactorFirstList findings={findings} />)
  const cards = findingCards()
  expect(cards[0]).toHaveTextContent("#1")
  expect(cards[1]).toHaveTextContent("#2")
  expect(cards[2]).toHaveTextContent("#3")
})

test("renders count badge and explanatory ranking subtitle", () => {
  render(<RefactorFirstList findings={findings} />)
  const heading = screen.getByRole("heading", { name: /refactor first/i })
  expect(heading).toBeInTheDocument()
  expect(
    screen.getByText("Ranked by severity × risk — start at the top."),
  ).toBeInTheDocument()
  expect(within(heading.parentElement!).getByText("3")).toBeInTheDocument()
})

test("cards include source, category and compact location", () => {
  render(<RefactorFirstList findings={findings} />)

  const critical = screen.getByRole("button", { name: /critical one/i })
  expect(critical).toHaveTextContent("security")
  expect(critical).toHaveTextContent("rule")
  expect(critical).toHaveTextContent("b.ts:2")
})

test("renders full reason in title attribute for hover accessibility", () => {
  render(<RefactorFirstList findings={findings} />)
  const reasonText = screen.getByText("critical one")
  expect(reasonText).toHaveAttribute("title", "critical one")
})

test("caps findings list to 10 items and toggles show all / show top 10", async () => {
  const fifteenFindings: Finding[] = Array.from({ length: 15 }, (_, i) => ({
    fingerprint: `f-${i}`,
    source: "rule",
    category: "code-design",
    severity: "medium",
    file: `file-${i}.ts`,
    line: i + 1,
    symbol: `func${i}`,
    reason: `Finding number ${i + 1}`,
    status: "open",
    priority: 15 - i,
    pinned_by_floor: false,
  }))

  const user = userEvent.setup()
  render(<RefactorFirstList findings={fifteenFindings} />)

  expect(findingCards().length).toBe(10)

  const toggleBtn = screen.getByRole("button", {
    name: /show all 15 findings/i,
  })
  expect(toggleBtn).toBeInTheDocument()

  await user.click(toggleBtn)

  expect(findingCards().length).toBe(15)
  expect(
    screen.getByRole("button", { name: /show top 10/i }),
  ).toBeInTheDocument()

  await user.click(screen.getByRole("button", { name: /show top 10/i }))
  expect(findingCards().length).toBe(10)
})

test("clicking a finding card fires onSelect with that finding", async () => {
  const onSelect = vi.fn()
  render(<RefactorFirstList findings={findings} onSelect={onSelect} />)

  await userEvent.click(screen.getByRole("button", { name: /critical one/i }))

  expect(onSelect).toHaveBeenCalledWith(findings[1])
})

test("filters the list by debt type and updates count badge", async () => {
  const user = userEvent.setup()
  render(<RefactorFirstList findings={findings} />)

  const heading = screen.getByRole("heading", { name: /refactor first/i })
  expect(within(heading.parentElement!).getByText("3")).toBeInTheDocument()

  await user.click(
    screen.getByRole("combobox", { name: /filter by debt type/i }),
  )
  await user.click(await screen.findByRole("option", { name: "security" }))

  expect(screen.getByText("critical one")).toBeInTheDocument()
  expect(screen.queryByText("low one")).not.toBeInTheDocument()
  expect(within(heading.parentElement!).getByText("1 of 3")).toBeInTheDocument()
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

// ── source and severity filters (13F) ──────────────────────────────────────

const mixed: Finding[] = [
  ...findings,
  {
    fingerprint: "d",
    source: "satd",
    category: "documentation",
    severity: "high",
    file: "d.ts",
    line: 4,
    symbol: null,
    reason: "satd high one",
    status: "open",
    priority: 20,
    pinned_by_floor: false,
    comment_text: "TODO: document this",
    confidence: 0.9,
  },
  {
    fingerprint: "e",
    source: "satd",
    category: "code-design",
    severity: "low",
    file: "e.ts",
    line: 5,
    symbol: null,
    reason: "satd low one",
    status: "open",
    priority: 1,
    pinned_by_floor: false,
  },
]

const sourceButton = (name: string) =>
  within(screen.getByRole("group", { name: /filter by source/i })).getByRole(
    "button",
    { name },
  )
const severityButton = (name: string) =>
  within(screen.getByRole("group", { name: /filter by severity/i })).getByRole(
    "button",
    { name },
  )
const countBadge = () =>
  screen.getByRole("heading", { name: /refactor first/i }).parentElement!

test("the source filter shows only SATD or only rule-based findings", async () => {
  const user = userEvent.setup()
  render(<RefactorFirstList findings={mixed} />)

  expect(sourceButton("All")).toHaveAttribute("aria-pressed", "true")

  await user.click(sourceButton("SATD"))
  expect(sourceButton("SATD")).toHaveAttribute("aria-pressed", "true")
  expect(sourceButton("All")).toHaveAttribute("aria-pressed", "false")
  expect(screen.getByText("satd high one")).toBeInTheDocument()
  expect(screen.getByText("satd low one")).toBeInTheDocument()
  expect(screen.queryByText("critical one")).not.toBeInTheDocument()
  expect(within(countBadge()).getByText("2 of 5")).toBeInTheDocument()

  await user.click(sourceButton("Rule-based"))
  expect(screen.getByText("critical one")).toBeInTheDocument()
  expect(screen.queryByText("satd high one")).not.toBeInTheDocument()
  expect(within(countBadge()).getByText("3 of 5")).toBeInTheDocument()
})

test("every severity starts on, and turning one off hides its findings", async () => {
  const user = userEvent.setup()
  render(<RefactorFirstList findings={mixed} />)

  for (const name of ["Critical", "High", "Medium", "Low"]) {
    expect(severityButton(name)).toHaveAttribute("aria-pressed", "true")
  }

  await user.click(severityButton("Low"))
  expect(severityButton("Low")).toHaveAttribute("aria-pressed", "false")
  expect(screen.queryByText("low one")).not.toBeInTheDocument()
  expect(screen.queryByText("satd low one")).not.toBeInTheDocument()
  expect(screen.getByText("critical one")).toBeInTheDocument()
  expect(within(countBadge()).getByText("3 of 5")).toBeInTheDocument()
})

test("source, severity and type filters combine", async () => {
  const user = userEvent.setup()
  render(<RefactorFirstList findings={mixed} />)

  await user.click(sourceButton("SATD"))
  await user.click(severityButton("High"))

  // SATD and not high leaves only the low SATD finding.
  expect(screen.getByText("satd low one")).toBeInTheDocument()
  expect(screen.queryByText("satd high one")).not.toBeInTheDocument()
  expect(within(countBadge()).getByText("1 of 5")).toBeInTheDocument()
})

test("Clear filter resets source, severity and type together", async () => {
  const user = userEvent.setup()
  render(<RefactorFirstList findings={mixed} />)

  await user.click(sourceButton("SATD"))
  await user.click(severityButton("High"))
  await user.click(severityButton("Low"))

  expect(screen.getByText("No findings match this filter")).toBeInTheDocument()
  await user.click(screen.getByRole("button", { name: /clear filter/i }))

  expect(sourceButton("All")).toHaveAttribute("aria-pressed", "true")
  for (const name of ["Critical", "High", "Medium", "Low"]) {
    expect(severityButton(name)).toHaveAttribute("aria-pressed", "true")
  }
  expect(within(countBadge()).getByText("5")).toBeInTheDocument()
})
