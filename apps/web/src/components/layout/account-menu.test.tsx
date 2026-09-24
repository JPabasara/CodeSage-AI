import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, expect, test, vi } from "vitest"

import { AccountMenu, initialsOf } from "./account-menu"
import { AppRail } from "./app-rail"
import { SidebarProvider } from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"
import { mockSession } from "@/lib/mocks/fixtures"
import type { Session } from "@/lib/types"

const session = vi.hoisted(() => ({ current: null as Session | null }))
vi.mock("@/hooks/use-session", () => ({
  useSession: () => ({ data: session.current, loading: false }),
}))

const theme = vi.hoisted(() => ({ value: "system", set: vi.fn() }))
vi.mock("next-themes", () => ({
  useTheme: () => ({
    theme: theme.value,
    resolvedTheme: "light",
    setTheme: theme.set,
  }),
}))

vi.mock("next/navigation", () => ({
  usePathname: () => "/projects",
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock("@/hooks/use-projects", () => ({
  useProjects: () => ({ data: [] }),
}))

/** Theme and Sign out sit at the foot of the rail, not behind the avatar. */
function renderRail() {
  return render(
    <TooltipProvider>
      <SidebarProvider>
        <AppRail />
      </SidebarProvider>
    </TooltipProvider>,
  )
}

const openSignOut = async () => {
  renderRail()
  await userEvent.click(screen.getByRole("button", { name: /sign out/i }))
}

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

test("the avatar menu is only who is signed in: no theme, no sign out", async () => {
  render(<AccountMenu />)
  await openMenu()
  await screen.findByText("Janidu Pabasara")
  expect(screen.queryByRole("menuitemradio")).not.toBeInTheDocument()
  expect(
    screen.queryByRole("menuitem", { name: /sign out/i }),
  ).not.toBeInTheDocument()
})

test("the rail's Theme item offers Light, Dark and System default", async () => {
  renderRail()
  await userEvent.click(screen.getByRole("button", { name: "Theme" }))

  const options = await screen.findAllByRole("menuitemradio")
  expect(options.map((option) => option.textContent)).toEqual([
    "Light",
    "Dark",
    "System default",
  ])
  expect(
    screen.getByRole("menuitemradio", { name: "System default" }),
  ).toBeChecked()
  await userEvent.click(screen.getByRole("menuitemradio", { name: "Dark" }))
  expect(theme.set).toHaveBeenCalledWith("dark")
})

test("sign out asks first, and Cancel keeps you signed in", async () => {
  const forms = recordSubmits()
  await openSignOut()

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
  await openSignOut()
  await screen.findByRole("alertdialog")
  await userEvent.keyboard("{Escape}")

  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
  expect(forms.submitted).toHaveLength(0)
  forms.done()
})

test("Sign out has the focus, so Enter confirms and posts the form", async () => {
  const forms = recordSubmits()
  await openSignOut()
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
