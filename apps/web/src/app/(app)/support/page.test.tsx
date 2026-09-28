import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, expect, test, vi } from "vitest"

import SupportPage from "./page"

const startTour = vi.hoisted(() => vi.fn())

vi.mock("@/components/tour/product-tour", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/components/tour/product-tour")>()
  return {
    ...original,
    useProductTour: () => ({ active: false, startTour }),
  }
})

beforeEach(() => startTour.mockClear())

test("the trial page can replay all or one lesson", async () => {
  const user = userEvent.setup()
  render(<SupportPage />)

  expect(
    screen.getByRole("heading", { name: "New User Trial" }),
  ).toBeInTheDocument()
  expect(screen.queryByRole("tab")).not.toBeInTheDocument()

  await user.click(screen.getByRole("button", { name: /start full trial/i }))
  expect(startTour).toHaveBeenCalledWith("full")

  await user.click(screen.getByRole("button", { name: "Learn Dashboard" }))
  expect(startTour).toHaveBeenCalledWith("dashboard")
})
