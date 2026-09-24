import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, expect, test, vi } from "vitest"

import { isProjectPage, ProjectSwitcher } from "./project-switcher"
import { readSelectedProjectId } from "@/hooks/use-selected-project"
import {
  DEMO_REPO_ID,
  SECOND_REPO_ID,
  WORKSPACE_ID,
} from "@/lib/mocks/fixtures"

const nav = vi.hoisted(() => ({ pathname: "/", push: vi.fn() }))
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: nav.push, replace: vi.fn() }),
}))

beforeEach(() => {
  localStorage.clear()
  nav.push.mockClear()
  nav.pathname = `/dashboard/${DEMO_REPO_ID}`
})

const trigger = () => screen.findByRole("combobox", { name: /^Project:/ })

test.each([
  ["/dashboard/x", true],
  ["/dashboard/x/history", true],
  ["/profiles", false],
  ["/projects", false],
  ["/workspace", false],
])("%s is a project page: %s", (path, expected) => {
  expect(isProjectPage(path)).toBe(expected)
})

test("lists only the active workspace's projects, with the current one marked", async () => {
  render(<ProjectSwitcher />)
  await userEvent.click(await trigger())

  const options = await screen.findAllByRole("option")
  const names = options.map((o) => o.textContent)
  expect(names.some((n) => n?.includes("web-store"))).toBe(true)
  expect(names.some((n) => n?.includes("nimbus"))).toBe(false)
  expect(await trigger()).toHaveAccessibleName("Project: acme-payments")
})

test("on the Dashboard, switching opens the other project's Dashboard", async () => {
  render(<ProjectSwitcher />)
  await userEvent.click(await trigger())
  await userEvent.click(
    await screen.findByRole("option", { name: /web-store/ }),
  )

  // A bare URL: branch, snapshot and finding belonged to the project left.
  expect(nav.push).toHaveBeenCalledWith(`/dashboard/${SECOND_REPO_ID}`)
})

test("on Scan History, it stays on Scan History", async () => {
  nav.pathname = `/dashboard/${DEMO_REPO_ID}/history`
  render(<ProjectSwitcher />)
  await userEvent.click(await trigger())
  await userEvent.click(
    await screen.findByRole("option", { name: /web-store/ }),
  )

  expect(nav.push).toHaveBeenCalledWith(`/dashboard/${SECOND_REPO_ID}/history`)
})

test("off a dashboard page, the choice is remembered without navigating", async () => {
  nav.pathname = "/projects"
  render(<ProjectSwitcher />)
  await userEvent.click(await trigger())
  await userEvent.click(
    await screen.findByRole("option", { name: /web-store/ }),
  )

  await waitFor(() =>
    expect(readSelectedProjectId(WORKSPACE_ID)).toBe(SECOND_REPO_ID),
  )
  expect(nav.push).not.toHaveBeenCalled()
})

test("Manage projects goes to Projects", async () => {
  render(<ProjectSwitcher />)
  await userEvent.click(await trigger())
  await userEvent.click(
    await screen.findByRole("option", { name: /manage projects/i }),
  )
  expect(nav.push).toHaveBeenCalledWith("/projects")
})
