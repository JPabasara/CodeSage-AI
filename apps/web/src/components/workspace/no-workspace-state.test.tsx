import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, expect, test, vi } from "vitest"

import { WorkspaceGate, lockedPageFor } from "./no-workspace-state"
import { getWorkspaces } from "@/lib/api/client"
import {
  noteActiveWorkspace,
  resetWorkspaceScope,
} from "@/hooks/use-workspace-scope"

const nav = vi.hoisted(() => ({ pathname: "/projects" }))
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))

const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }))
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: toastSuccess, error: vi.fn() }),
}))

beforeEach(() => {
  nav.pathname = "/projects"
  toastSuccess.mockClear()
})

const page = <p>the real page</p>

test.each([
  ["/projects", "projects"],
  ["/profiles", "profiles"],
  ["/workspace", "workspace"],
  ["/dashboard/abc", "dashboard"],
  ["/dashboard/abc/history", "history"],
])("%s maps to the %s card", (path, expected) => {
  expect(lockedPageFor(path)).toBe(expected)
})

test("with a workspace, the page renders as usual", () => {
  render(<WorkspaceGate>{page}</WorkspaceGate>)
  expect(screen.getByText("the real page")).toBeVisible()
})

test("while the session loads, the page renders (its reads wait)", () => {
  resetWorkspaceScope() // the session has not answered yet
  render(<WorkspaceGate>{page}</WorkspaceGate>)
  expect(screen.getByText("the real page")).toBeVisible()
  expect(screen.queryByTestId("no-workspace-state")).toBeNull()
})

test.each([
  ["/projects", /connect repositories/i],
  ["/dashboard/abc", /see code health/i],
  ["/dashboard/abc/history", /keep scan history/i],
  ["/profiles", /belong to a workspace/i],
])("no workspace on %s: a friendly card, not the page", (path, heading) => {
  nav.pathname = path
  noteActiveWorkspace(null)
  render(<WorkspaceGate>{page}</WorkspaceGate>)

  expect(screen.getByRole("heading", { name: heading })).toBeVisible()
  expect(screen.queryByText("the real page")).toBeNull()
  expect(screen.getByText(/invited to a team\?/i)).toBeVisible()
  expect(screen.queryByRole("alert")).toBeNull() // not an error
})

test("creating from the card switches in and the page appears in place", async () => {
  noteActiveWorkspace(null)
  render(<WorkspaceGate>{page}</WorkspaceGate>)

  await userEvent.click(
    screen.getByRole("button", { name: "Create workspace" }),
  )
  const dialog = await screen.findByRole("dialog")
  await userEvent.type(
    within(dialog).getByLabelText(/workspace name/i),
    "Fresh Team",
  )
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Create workspace" }),
  )

  expect(await screen.findByText("the real page")).toBeVisible()
  expect(toastSuccess).toHaveBeenCalledWith(
    "Fresh Team is ready. Connect your first repository.",
  )
  const active = (await getWorkspaces()).find((w) => w.is_active)
  expect(active).toMatchObject({ name: "Fresh Team", role: "org-admin" })
})

test("the Workspace page offers the form inline", async () => {
  nav.pathname = "/workspace"
  noteActiveWorkspace(null)
  render(<WorkspaceGate>{page}</WorkspaceGate>)

  expect(
    screen.getByRole("heading", { name: "Create your workspace" }),
  ).toBeVisible()
  await userEvent.type(screen.getByLabelText(/workspace name/i), "Inline Co")
  await userEvent.click(
    screen.getByRole("button", { name: "Create workspace" }),
  )

  await waitFor(() => expect(screen.getByText("the real page")).toBeVisible())
})
