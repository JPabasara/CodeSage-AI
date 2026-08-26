import { render, screen } from "@testing-library/react"
import { expect, test } from "vitest"

import { OverallHealthCard } from "@/components/dashboard/overall-health-card"

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
