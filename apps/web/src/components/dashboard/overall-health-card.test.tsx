import { render, screen } from "@testing-library/react"
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
  expect(screen.getByText(/\+3 since last scan/)).toBeInTheDocument()
  expect(screen.getByText(/2 red issues/)).toBeInTheDocument()
})

test("renders a negative delta with a down marker and singular issue", () => {
  render(
    <OverallHealthCard
      score={40}
      grade="D"
      delta={-5}
      redIssueCount={1}
      categoryBreakdown={[{ category: "code-design", count: 1, debt: 3 }]}
    />,
  )
  expect(screen.getByText(/▼ -5 since last scan/)).toBeInTheDocument()
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

  // Total findings in the center of the donut: 2 + 5 + 1 + 3 + 4 = 15
  expect(screen.getByText("15")).toBeInTheDocument()
  expect(screen.getByText("total")).toBeInTheDocument()

  // Accessible legend exists
  const legend = screen.getByRole("list", { name: /category breakdown legend/i })
  expect(legend).toBeInTheDocument()

  // Each category and count is displayed in the legend
  for (const item of breakdown) {
    expect(screen.getByText(item.category)).toBeInTheDocument()
  }
  expect(screen.getByText("2")).toBeInTheDocument()
  expect(screen.getByText("5")).toBeInTheDocument()
  expect(screen.getByText("1")).toBeInTheDocument()
  expect(screen.getByText("3")).toBeInTheDocument()
  expect(screen.getByText("4")).toBeInTheDocument()

  // Chart container has an accessible aria-label summarizing the breakdown
  const chart = screen.getByLabelText(
    /category breakdown: 2 security, 5 code-design, 1 test, 3 documentation, 4 requirement\. total: 15/i,
  )
  expect(chart).toBeInTheDocument()

  // CATEGORY_COLORS maps strictly to dedicated --category-* tokens
  expect(CATEGORY_COLORS["code-design"]).toBe("var(--category-code-design)")
  expect(CATEGORY_COLORS["security"]).toBe("var(--category-security)")
  expect(CATEGORY_COLORS["test"]).toBe("var(--category-test)")
  expect(CATEGORY_COLORS["documentation"]).toBe(
    "var(--category-documentation)",
  )
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
