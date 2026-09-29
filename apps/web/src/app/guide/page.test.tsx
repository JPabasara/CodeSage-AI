import { render, screen } from "@testing-library/react"
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
