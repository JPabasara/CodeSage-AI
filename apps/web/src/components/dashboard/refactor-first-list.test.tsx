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

/** The open-finding buttons, not the per-row Mark as done actions. */
function findingCards() {
  return within(
    screen.getByRole("list", { name: /ranked refactor findings/i }),
  ).getAllByTestId("finding-card")
}

test("sorts findings by priority, highest first", () => {
  render(<RefactorFirstList findings={findings} />)

  expect(findingCards()[0]).toHaveTextContent("critical one")
})

const rankOf = (card: HTMLElement) =>
  card.querySelector("[data-slot=rank]")?.textContent

test("search narrows the list by words or file, and Clear filter resets it", async () => {
  const user = userEvent.setup()
  render(<RefactorFirstList findings={findings} />)

  await user.type(screen.getByRole("searchbox"), "b.ts")
  expect(findingCards()).toHaveLength(1)
  expect(findingCards()[0]).toHaveTextContent("critical one")

  await user.clear(screen.getByRole("searchbox"))
  await user.type(screen.getByRole("searchbox"), "nothing like this")
  expect(screen.getByText("No findings match this filter")).toBeInTheDocument()
  await user.click(screen.getByRole("button", { name: /clear filter/i }))
  expect(findingCards()).toHaveLength(3)
})

test("renders 1-based sequential rank numbers", () => {
  render(<RefactorFirstList findings={findings} />)
  const cards = findingCards()
  expect(rankOf(cards[0])).toBe("1")
  expect(rankOf(cards[1])).toBe("2")
  expect(rankOf(cards[2])).toBe("3")
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

test("cards include source and category without file paths", () => {
  render(<RefactorFirstList findings={findings} />)

  const critical = screen.getByRole("button", { name: /critical one/i })
  expect(critical).toHaveTextContent(/security/i)
  expect(critical).toHaveTextContent(/rule/i)
  expect(critical).not.toHaveTextContent("b.ts")
  expect(critical).not.toHaveAccessibleName(/b\.ts/)
})

test("renders full reason in title attribute for hover accessibility", () => {
  render(<RefactorFirstList findings={findings} />)
  const reasonText = screen.getByText("critical one")
  expect(reasonText).toHaveAttribute("title", "critical one")
})

const manyFindings = (count: number): Finding[] =>
  Array.from({ length: count }, (_, i) => ({
    fingerprint: `f-${i}`,
    source: "rule",
    category: "code-design",
    severity: "medium",
    file: `file-${i}.ts`,
    line: i + 1,
    symbol: `func${i}`,
    reason: `Finding number ${i + 1}`,
    status: "open",
    priority: count - i,
    pinned_by_floor: false,
  }))

test("pages ten findings at a time with stable ranks and bounded navigation", async () => {
  const user = userEvent.setup()
  render(<RefactorFirstList findings={manyFindings(23)} />)
  expect(findingCards()).toHaveLength(10)
  expect(screen.getByText("Page 1 of 3 · 1–10 of 23")).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled()
  expect(
    screen.queryByRole("button", { name: /^Load/ }),
  ).not.toBeInTheDocument()

  await user.click(screen.getByRole("button", { name: "Next" }))
  expect(findingCards()).toHaveLength(10)
  expect(rankOf(findingCards()[0])).toBe("11")
  expect(screen.queryByText("Finding number 1")).not.toBeInTheDocument()
  expect(screen.getByText("Page 2 of 3 · 11–20 of 23")).toBeInTheDocument()

  await user.click(screen.getByRole("button", { name: "Next" }))
  expect(findingCards()).toHaveLength(3)
  expect(rankOf(findingCards()[0])).toBe("21")
  expect(screen.getByRole("button", { name: "Next" })).toBeDisabled()
  await user.click(screen.getByRole("button", { name: "Previous" }))
  expect(screen.getByText("Page 2 of 3 · 11–20 of 23")).toBeInTheDocument()
})

test("a linked finding opens on its page", () => {
  const list = manyFindings(60)
  render(
    <RefactorFirstList
      findings={list}
      selectedFingerprint={list[40].fingerprint}
    />,
  )
  expect(findingCards()).toHaveLength(10)
  expect(screen.getByText("Page 5 of 6 · 41–50 of 60")).toBeInTheDocument()
  expect(
    screen.getByRole("button", { name: /Finding number 41$/, current: true }),
  ).toBeInTheDocument()
})

test("search resets pagination to the first page", async () => {
  const user = userEvent.setup()
  render(<RefactorFirstList findings={manyFindings(60)} />)
  await user.click(screen.getByRole("button", { name: "Next" }))
  expect(rankOf(findingCards()[0])).toBe("11")
  await user.type(screen.getByRole("searchbox"), "Finding")
  expect(findingCards()).toHaveLength(10)
  expect(rankOf(findingCards()[0])).toBe("1")
})

test("shrinking the result set clamps the active page", async () => {
  const user = userEvent.setup()
  const list = manyFindings(23)
  const view = render(<RefactorFirstList findings={list} />)
  await user.click(screen.getByRole("button", { name: "Next" }))
  await user.click(screen.getByRole("button", { name: "Next" }))
  view.rerender(<RefactorFirstList findings={list.slice(0, 12)} />)
  expect(screen.getByText("Page 2 of 2 · 11–12 of 12")).toBeInTheDocument()
  expect(findingCards()).toHaveLength(2)
  await user.click(screen.getByRole("button", { name: "Previous" }))
  expect(rankOf(findingCards()[0])).toBe("1")
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

test("zero findings displays the celebratory empty state", () => {
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

test("filtered to nothing names the active filter and provides a clear filter button", async () => {
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

  // The search box, then the filter toolbar's one stop, then the list.
  await userEvent.tab()
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

test("done findings are hidden by default and can be shown", async () => {
  const user = userEvent.setup()
  const withDone: Finding[] = [
    ...findings,
    {
      ...findings[0],
      fingerprint: "done",
      reason: "finished item",
      status: "done",
    },
  ]
  render(<RefactorFirstList findings={withDone} />)

  expect(screen.queryByText("finished item")).not.toBeInTheDocument()
  expect(screen.getByText(/3 open.*1 done/i)).toBeInTheDocument()
  await user.click(screen.getByRole("button", { name: /show done \(1\)/i }))

  expect(screen.getByText("finished item")).toBeInTheDocument()
  expect(
    screen.getByRole("button", { name: /show done \(1\)/i }),
  ).toHaveAttribute("aria-pressed", "true")
})

test("mark as done is a separate action from opening the finding", async () => {
  const onSelect = vi.fn()
  const onStatusChange = vi.fn()
  render(
    <RefactorFirstList
      findings={findings}
      canTriage
      onSelect={onSelect}
      onStatusChange={onStatusChange}
    />,
  )

  const criticalCard = screen.getByRole("button", { name: /critical one/i })
  await userEvent.click(
    within(criticalCard.closest("li")!).getByRole("button", {
      name: "Mark as done",
    }),
  )

  expect(onStatusChange).toHaveBeenCalledWith(findings[1], "done")
  expect(onSelect).not.toHaveBeenCalled()
})

test("all-done snapshots explain why the list is empty", async () => {
  const done = findings.map((finding) => ({
    ...finding,
    status: "done" as const,
  }))
  render(<RefactorFirstList findings={done} />)

  expect(screen.getByText("All findings are marked done")).toBeInTheDocument()
  await userEvent.click(
    screen.getByRole("button", { name: "Show done findings" }),
  )
  expect(screen.getByText("critical one")).toBeInTheDocument()
})

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

test("uses configured test visibility while preserving the Show excluded findings toggle", async () => {
  const scoped = [
    {
      ...findings[0],
      fingerprint: "production",
      reason: "production finding",
      source_scope: "production" as const,
    },
    {
      ...findings[1],
      fingerprint: "test",
      reason: "test finding",
      source_scope: "test" as const,
    },
  ]
  const view = render(<RefactorFirstList findings={scoped} />)
  expect(screen.getByText("production finding")).toBeInTheDocument()
  expect(screen.queryByText("test finding")).not.toBeInTheDocument()
  const toggle = screen.getByRole("button", { name: "Show excluded findings" })
  expect(toggle).toHaveAttribute("aria-pressed", "false")
  await userEvent.click(toggle)
  expect(screen.getByText("test finding")).toBeInTheDocument()
  await userEvent.click(toggle)
  expect(screen.queryByText("test finding")).not.toBeInTheDocument()
  view.rerender(
    <RefactorFirstList findings={scoped} includeTestFindingsByDefault />,
  )
  expect(screen.getByText("test finding")).toBeInTheDocument()
})

test("summarizes method signatures while preserving the selected finding", async () => {
  const user = userEvent.setup()
  const onSelect = vi.fn()
  const symbol =
    "org.joda.time.format.PeriodFormatterBuilder$FieldFormatter.parseInto/4[org.joda.time.ReadWritablePeriod,java.lang.String,int,java.util.Locale]"
  const finding: Finding = {
    ...findings[0],
    symbol,
    rule_id: "long-method",
    reason: `${symbol}() is 123 lines long, over the limit of 80 - extract cohesive blocks into helpers.`,
  }
  render(<RefactorFirstList findings={[finding]} onSelect={onSelect} />)
  const card = findingCards()[0]
  expect(card).toHaveTextContent(
    "Extract smaller helper methods from this long method.",
  )
  expect(card).not.toHaveTextContent("org.joda")
  expect(card).not.toHaveAccessibleName(/org\.joda/)
  expect(card).not.toHaveTextContent(finding.file)
  await user.click(card)
  expect(onSelect).toHaveBeenCalledWith(finding)
})

test("removes the file path embedded in large-file summaries", () => {
  render(
    <RefactorFirstList
      findings={[
        {
          ...findings[0],
          rule_id: "large-file",
          reason:
            "a.ts is 900 lines long, over the limit of 800 - consider splitting it by responsibility.",
        },
      ]}
    />,
  )
  expect(findingCards()[0]).toHaveTextContent(
    "Split this large file into smaller files by responsibility.",
  )
  expect(findingCards()[0]).not.toHaveTextContent("a.ts")
})
