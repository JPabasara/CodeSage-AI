import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, expect, test, vi } from "vitest"

import { AccountMenu, initialsOf } from "./account-menu"
import { mockSession } from "@/lib/mocks/fixtures"
import type { Session } from "@/lib/types"

const session = vi.hoisted(() => ({ current: null as Session | null }))
vi.mock("@/hooks/use-session", () => ({
  useSession: () => ({ data: session.current, loading: false }),
}))

const theme = vi.hoisted(() => ({ value: "system", set: vi.fn() }))
vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: theme.value, setTheme: theme.set }),
}))

beforeEach(() => {
  session.current = mockSession
  theme.set.mockClear()
  sessionStorage.clear()
})

// jsdom cannot navigate: a submitted form is recorded, then stopped.
function recordSubmits() {
  const submitted: HTMLFormElement[] = []
  const stop = (event: Event) => {
    submitted.push(event.target as HTMLFormElement)
    event.preventDefault()
  }
  document.addEventListener("submit", stop)
  return { submitted, done: () => document.removeEventListener("submit", stop) }
}

const openMenu = () =>
  userEvent.click(screen.getByRole("button", { name: "Account menu" }))

test.each([
  ["Janidu Pabasara", "j@x.dev", "JP"],
  [null, "priya.fernando@x.dev", "PF"],
  [null, null, "?"],
])("initials for %s / %s → %s", (name, email, expected) => {
  expect(initialsOf(name, email)).toBe(expected)
})

test("the menu shows who is signed in and how", async () => {
  render(<AccountMenu />)
  expect(
    screen.getByRole("button", { name: "Account menu" }),
  ).toHaveTextContent("JP")
  await openMenu()
  expect(await screen.findByText("Janidu Pabasara")).toBeVisible()
  expect(screen.getByText("janidu@example.com")).toBeVisible()
  expect(screen.getByText("Signed in with Github")).toBeVisible()
})

test("theme is chosen here: Light, Dark or System", async () => {
  render(<AccountMenu />)
  await openMenu()
  expect(
    await screen.findByRole("menuitemradio", { name: "System" }),
  ).toBeChecked()
  await userEvent.click(screen.getByRole("menuitemradio", { name: "Dark" }))
  expect(theme.set).toHaveBeenCalledWith("dark")
})

test("sign out asks first, and Cancel keeps you signed in", async () => {
  const forms = recordSubmits()
  render(<AccountMenu />)
  await openMenu()
  await userEvent.click(
    await screen.findByRole("menuitem", { name: /sign out/i }),
  )

  const dialog = await screen.findByRole("alertdialog", {
    name: "Sign out of CodeSage?",
  })
  expect(dialog).toBeVisible()
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }))

  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
  expect(forms.submitted).toHaveLength(0)
  forms.done()
})

test("Esc closes the confirmation without signing out", async () => {
  const forms = recordSubmits()
  render(<AccountMenu />)
  await openMenu()
  await userEvent.click(
    await screen.findByRole("menuitem", { name: /sign out/i }),
  )
  await screen.findByRole("alertdialog")
  await userEvent.keyboard("{Escape}")

  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
  expect(forms.submitted).toHaveLength(0)
  forms.done()
})

test("Sign out has the focus, so Enter confirms and posts the form", async () => {
  const forms = recordSubmits()
  render(<AccountMenu />)
  await openMenu()
  await userEvent.click(
    await screen.findByRole("menuitem", { name: /sign out/i }),
  )
  await screen.findByRole("alertdialog")

  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Sign out" })).toHaveFocus(),
  )
  await userEvent.keyboard("{Enter}")

  expect(forms.submitted).toHaveLength(1)
  expect(forms.submitted[0]).toHaveAttribute("method", "POST")
  expect(forms.submitted[0].action).toMatch(/\/api\/auth\/logout$/)
  // The sign-in page will say "You're signed out." once.
  expect(sessionStorage.getItem("codesage.signedOut")).toBe("1")
  expect(screen.getByRole("button", { name: "Signing out…" })).toBeDisabled()
  forms.done()
})
