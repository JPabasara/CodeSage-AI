import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { SkipLink } from "./skip-link"

describe("SkipLink", () => {
  it("renders with default targetId #main-content and text", () => {
    render(<SkipLink />)
    const link = screen.getByRole("link", { name: "Skip to content" })
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute("href", "#main-content")
    expect(link).toHaveClass("sr-only")
  })

  it("accepts a custom targetId", () => {
    render(<SkipLink targetId="custom-content" />)
    const link = screen.getByRole("link", { name: "Skip to content" })
    expect(link).toHaveAttribute("href", "#custom-content")
  })
})
