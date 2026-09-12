import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, expect, test, vi } from "vitest"

import { ThemeToggle } from "./theme-toggle"
import { SidebarProvider } from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"

// next-themes is stubbed rather than wrapped in a real provider: the thing worth
// testing is that the button offers the OTHER theme and asks for exactly that
// one. Whether localStorage works is next-themes' own problem, and the e2e
// covers it end to end anyway.
const { setTheme, useTheme } = vi.hoisted(() => {
  const setTheme = vi.fn()
  return {
    setTheme,
    useTheme: vi.fn(() => ({ resolvedTheme: "light", setTheme })),
  }
})
vi.mock("next-themes", () => ({ useTheme }))

/** The toggle is a sidebar row, so it needs the rail's two contexts. */
function renderToggle() {
  return render(
    <TooltipProvider>
      <SidebarProvider>
        <ThemeToggle />
      </SidebarProvider>
    </TooltipProvider>,
  )
}

beforeEach(() => {
  setTheme.mockClear()
  useTheme.mockReturnValue({ resolvedTheme: "light", setTheme })
})

test("in light mode it offers dark, and asks for exactly that", async () => {
  renderToggle()

  const button = await screen.findByRole("button", {
    name: /switch to dark mode/i,
  })
  expect(button).toHaveTextContent("Dark mode")

  await userEvent.click(button)
  expect(setTheme).toHaveBeenCalledWith("dark")
})

test("in dark mode it offers light, and asks for exactly that", async () => {
  useTheme.mockReturnValue({ resolvedTheme: "dark", setTheme })
  renderToggle()

  const button = await screen.findByRole("button", {
    name: /switch to light mode/i,
  })
  expect(button).toHaveTextContent("Light mode")

  await userEvent.click(button)
  expect(setTheme).toHaveBeenCalledWith("light")
})

test("the accessible name says what pressing does, not what the theme is", async () => {
  renderToggle()

  // "Dark mode, button" does not tell a screen reader user whether pressing
  // turns it on or off. The visible label stays short; the name spells it out.
  expect(
    await screen.findByRole("button", { name: "Switch to dark mode" }),
  ).toBeInTheDocument()
  expect(
    screen.queryByRole("button", { name: "Dark mode" }),
  ).not.toBeInTheDocument()
})
