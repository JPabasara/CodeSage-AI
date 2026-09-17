import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, test, vi } from "vitest"

import { ErrorState } from "./error-state"

test("says what failed, why, and offers a way out", async () => {
  const onRetry = vi.fn()
  render(
    <ErrorState
      title="Couldn’t load projects"
      detail="Something broke."
      onRetry={onRetry}
    />,
  )

  // role="alert", so a screen reader is told when this replaces the skeleton.
  expect(screen.getByRole("alert")).toBeInTheDocument()
  expect(screen.getByText("Couldn’t load projects")).toBeInTheDocument()
  expect(screen.getByText("Something broke.")).toBeInTheDocument()

  await userEvent.click(screen.getByRole("button", { name: "Retry" }))
  expect(onRetry).toHaveBeenCalledTimes(1)
})

test("with no onRetry there is no button, and with no detail no second line", () => {
  render(<ErrorState title="Couldn’t load projects" />)

  expect(screen.getByText("Couldn’t load projects")).toBeInTheDocument()
  expect(screen.queryByRole("button")).not.toBeInTheDocument()
  expect(screen.getByRole("alert").textContent).toBe("Couldn’t load projects")
})
