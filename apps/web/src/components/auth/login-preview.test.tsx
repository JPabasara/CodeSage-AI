import { render, screen } from "@testing-library/react"
import { expect, test } from "vitest"

import { LoginPreview } from "./login-preview"

test("the preview is a picture: hidden from assistive tech, nothing to click or focus", () => {
  const { container } = render(<LoginPreview />)
  const preview = screen.getByTestId("login-preview")

  expect(preview).toHaveAttribute("aria-hidden", "true")
  expect(
    container.querySelectorAll("a, button, input, [tabindex]"),
  ).toHaveLength(0)
})

test("it shows the three dashboard tiles with made-up numbers", () => {
  const { container } = render(<LoginPreview />)

  for (const title of ["Code health", "Health trend", "File health map"]) {
    expect(screen.getByText(title)).toBeInTheDocument()
  }
  // One hoverable point per scan on the trend, one row per tree node.
  expect(container.querySelectorAll("[data-trend-point]")).toHaveLength(8)
  expect(container.querySelectorAll("[data-tree-row]").length).toBeGreaterThan(
    5,
  )
})
