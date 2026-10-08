import { render, screen, within } from "@testing-library/react"
import { expect, test, vi } from "vitest"

import ProductGuidePage from "./page"

vi.mock("next/image", () => ({
  default: (props: { alt: string }) => (
    <span role="img" aria-label={props.alt} />
  ),
}))

test("the public product guide explains scores, profiles and repository limits", () => {
  render(<ProductGuidePage />)

  expect(screen.getByRole("img", { name: "CodeSage AI" })).toBeInTheDocument()
  expect(
    screen.getByRole("heading", { name: "Understand CodeSage AI" }),
  ).toBeInTheDocument()
  expect(screen.getByText("Grade A")).toBeInTheDocument()
  expect(screen.getByText(/five custom profiles/i)).toBeInTheDocument()
  expect(screen.getByRole("link", { name: "Open CodeSage" })).toHaveAttribute(
    "href",
    "/login",
  )
})

test("every jump link lands on a section of the guide", () => {
  const { container } = render(<ProductGuidePage />)

  const jumps = within(
    screen.getByRole("navigation", { name: "On this page" }),
  ).getAllByRole("link")
  expect(jumps.length).toBeGreaterThan(0)
  for (const link of jumps) {
    const target = link.getAttribute("href")?.slice(1) ?? ""
    expect(container.querySelector(`section#${target}`)).not.toBeNull()
  }
})

test("roles and common questions are answered without signing in", () => {
  render(<ProductGuidePage />)

  const roles = screen.getByRole("table", { name: "Workspace roles" })
  expect(
    within(roles)
      .getAllByRole("rowheader")
      .map((cell) => cell.textContent),
  ).toEqual(["Org admin", "Manager", "Developer", "Viewer"])
  expect(
    screen.getByText("Why did my score change without a new scan?"),
  ).toBeInTheDocument()
})
