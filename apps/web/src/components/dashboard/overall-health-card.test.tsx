import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, test } from "vitest"

import {
  CATEGORY_COLORS,
  OverallHealthCard,
} from "@/components/dashboard/overall-health-card"
import type { CategoryBreakdownItem } from "@/lib/types"

test("shows the grade, positive delta, and red-issue count", () => {
  render(
    <OverallHealthCard
      score={88}
      grade="A"
      delta={3}
      redIssueCount={2}
      categoryBreakdown={[{ category: "security", count: 1, debt: 8 }]}
    />,
  )
  expect(screen.getByText("A")).toBeInTheDocument()
  expect(screen.getByText("Up +3")).toBeInTheDocument()
  expect(screen.getByText(/since last scan/)).toBeInTheDocument()
  expect(screen.getByText(/2 red issues/)).toBeInTheDocument()
})

test("renders a negative delta with a down label and singular issue", () => {
  render(
    <OverallHealthCard
      score={40}
      grade="D"
      delta={-5}
      redIssueCount={1}
      categoryBreakdown={[{ category: "code-design", count: 1, debt: 3 }]}
    />,
  )
  expect(screen.getByText("Down -5")).toBeInTheDocument()
  expect(screen.getByText(/since last scan/)).toBeInTheDocument()
  expect(screen.getByText(/1 red issue$/)).toBeInTheDocument()
})

test("renders category legend with counts, center total, and distinct colors (#113)", () => {
  const breakdown: CategoryBreakdownItem[] = [
    { category: "security", count: 2, debt: 10 },
    { category: "code-design", count: 5, debt: 15 },
    { category: "test", count: 1, debt: 2 },
    { category: "documentation", count: 3, debt: 6 },
    { category: "requirement", count: 4, debt: 8 },
  ]

  render(
    <OverallHealthCard
      score={75}
      grade="C"
      delta={0}
      redIssueCount={2}
      categoryBreakdown={breakdown}
    />,
  )

  expect(screen.getByText("15")).toBeInTheDocument()
  expect(screen.getByText("total")).toBeInTheDocument()

  const legend = screen.getByRole("list", {
    name: /category breakdown legend/i,
  })
  expect(legend).toBeInTheDocument()

  for (const item of breakdown) {
    expect(screen.getByText(item.category)).toBeInTheDocument()
  }
  expect(screen.getByText("2")).toBeInTheDocument()
  expect(screen.getByText("5")).toBeInTheDocument()
  expect(screen.getByText("1")).toBeInTheDocument()
  expect(screen.getByText("3")).toBeInTheDocument()
  expect(screen.getByText("4")).toBeInTheDocument()

  const chart = screen.getByLabelText(
    /category breakdown: 2 security, 5 code-design, 1 test, 3 documentation, 4 requirement\. total: 15/i,
  )
  expect(chart).toBeInTheDocument()

  expect(CATEGORY_COLORS["code-design"]).toBe("var(--category-code-design)")
  expect(CATEGORY_COLORS["security"]).toBe("var(--category-security)")
  expect(CATEGORY_COLORS["test"]).toBe("var(--category-test)")
  expect(CATEGORY_COLORS["documentation"]).toBe("var(--category-documentation)")
  expect(CATEGORY_COLORS["requirement"]).toBe("var(--category-requirement)")
})

test("handles zero findings gracefully with 0 total and empty aria label (#113)", () => {
  render(
    <OverallHealthCard
      score={100}
      grade="A"
      delta={5}
      redIssueCount={0}
      categoryBreakdown={[]}
    />,
  )

  expect(screen.getByText("0")).toBeInTheDocument()
  expect(screen.getByText("total")).toBeInTheDocument()
  expect(
    screen.getByLabelText(/category breakdown: zero findings/i),
  ).toBeInTheDocument()
})

// ── pie only, with the details on hover and on the keyboard (13F) ──────────

const fiveCategories: CategoryBreakdownItem[] = [
  { category: "security", count: 2, debt: 10 },
  { category: "code-design", count: 5, debt: 15 },
  { category: "test", count: 1, debt: 2 },
  { category: "documentation", count: 3, debt: 6 },
  { category: "requirement", count: 4, debt: 8 },
]

function renderFive() {
  render(
    <OverallHealthCard
      score={75}
      grade="C"
      delta={0}
      redIssueCount={2}
      categoryBreakdown={fiveCategories}
    />,
  )
  return screen.getByRole("group", { name: /category breakdown:/i })
}

test("the category list is for screen readers only; the card shows just the donut", () => {
  renderFive()

  const legend = screen.getByRole("list", {
    name: /category breakdown legend/i,
  })
  expect(legend).toHaveClass("sr-only")
  // Each entry carries the same words the tooltip does.
  expect(legend).toHaveTextContent("security · 2 findings · 13%")
  expect(legend).toHaveTextContent("code-design · 5 findings · 33%")
})

test("focusing the chart shows the first slice, and arrow keys step through them", async () => {
  const user = userEvent.setup()
  const chart = renderFive()
  const live = () =>
    document.getElementById(chart.getAttribute("aria-describedby")!)!

  await user.tab()
  expect(chart).toHaveFocus()
  expect(live()).toHaveTextContent("Security · 2 findings · 13%")

  await user.keyboard("{ArrowRight}")
  expect(live()).toHaveTextContent("Code-design · 5 findings · 33%")

  await user.keyboard("{ArrowLeft}{ArrowLeft}")
  // Wraps around from the first slice to the last.
  expect(live()).toHaveTextContent("Requirement · 4 findings · 27%")

  await user.keyboard("{Home}")
  expect(live()).toHaveTextContent("Security · 2 findings · 13%")

  await user.keyboard("{End}")
  expect(live()).toHaveTextContent("Requirement · 4 findings · 27%")

  await user.keyboard("{Escape}")
  expect(live()).toHaveTextContent("")
})

test("a chart with no findings is not a tab stop", async () => {
  const user = userEvent.setup()
  render(
    <OverallHealthCard
      score={100}
      grade="A"
      delta={0}
      redIssueCount={0}
      categoryBreakdown={[]}
    />,
  )
  await user.tab()
  expect(
    screen.getByRole("img", { name: /category breakdown: zero findings/i }),
  ).not.toHaveFocus()
})
