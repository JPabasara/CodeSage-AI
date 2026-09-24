import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, expect, test, vi } from "vitest"

import WorkspacePage from "./page"
import * as client from "@/lib/api/client"
import { getProjects, getWorkspaces } from "@/lib/api/client"
import {
  mockSession,
  mockSessionViewer,
  WORKSPACE_ID,
} from "@/lib/mocks/fixtures"
import type { Session } from "@/lib/types"

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), search: "" }))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  usePathname: () => "/workspace",
  useSearchParams: () => new URLSearchParams(nav.search),
}))

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: toastSuccess, error: toastError }),
}))

const session = vi.hoisted(() => ({ current: null as Session | null }))
vi.mock("@/hooks/use-session", () => ({
  useSession: () => ({ data: session.current, loading: false }),
}))

beforeEach(() => {
  nav.push.mockClear()
  nav.replace.mockClear()
  nav.search = ""
  toastSuccess.mockClear()
  session.current = mockSession
})

const ready = async () =>
  expect(
    await screen.findByRole("heading", { name: "Acme Engineering" }),
  ).toBeInTheDocument()

test("shows the workspace, the caller's role, and its derived counts", async () => {
  render(<WorkspacePage />)
  await ready()

  // The role sits beside the title. The member list names roles too, so look
  // for it in the page heading's row only.
  const heading = screen.getByRole("heading", { name: "Acme Engineering" })
  expect(
    within(heading.closest("header") as HTMLElement).getByText("Org admin"),
  ).toBeVisible()
  // Derived on read by the API, never stored: three seeded repositories.
  expect(screen.getByTestId("workspace-project-count")).toHaveTextContent("3")
})

test("an org-admin edits the metadata, and only what changed is sent", async () => {
  const patch = vi.spyOn(client, "updateWorkspace")
  render(<WorkspacePage />)
  await ready()

  const name = screen.getByLabelText(/workspace name/i)
  await userEvent.clear(name)
  await userEvent.type(name, "Acme Platform")
  await userEvent.click(screen.getByRole("button", { name: "Save changes" }))

  await waitFor(() => expect(patch).toHaveBeenCalledTimes(1))
  const [workspaceId, body] = patch.mock.calls[0]
  expect(workspaceId).toBe(WORKSPACE_ID)
  // PATCH, not PUT: the description and website were only displayed, never
  // touched, so they are not in the body.
  expect(Object.keys(body)).toEqual(["name"])

  const workspaces = await getWorkspaces()
  expect(workspaces.find((w) => w.workspace_id === WORKSPACE_ID)?.name).toBe(
    "Acme Platform",
  )
  patch.mockRestore()
})

test("clearing the description sends null, which is different from omitting it", async () => {
  const patch = vi.spyOn(client, "updateWorkspace")
  render(<WorkspacePage />)
  await ready()

  await userEvent.clear(screen.getByLabelText(/description/i))
  await userEvent.click(screen.getByRole("button", { name: "Save changes" }))

  await waitFor(() => expect(patch).toHaveBeenCalled())
  expect(patch.mock.calls[0][1]).toEqual({ description: null })
  patch.mockRestore()
})

test("Discard puts the stored values back", async () => {
  render(<WorkspacePage />)
  await ready()

  const name = screen.getByLabelText(/workspace name/i)
  await userEvent.clear(name)
  await userEvent.type(name, "Something else")
  await userEvent.click(screen.getByRole("button", { name: "Discard" }))

  await waitFor(() => expect(name).toHaveValue("Acme Engineering"))
})

test("a role without workspace:update reads the settings and cannot change them", async () => {
  session.current = mockSessionViewer

  render(<WorkspacePage />)
  await ready()

  expect(screen.getByLabelText(/workspace name/i)).toBeDisabled()
  // Save is a main action: shown, locked, and the reason is on the wrapper
  // that hover and keyboard focus reach.
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled()
  expect(
    screen.getByLabelText("Only org-admins can change workspace settings"),
  ).toBeInTheDocument()
  // Creating another workspace is an org-admin action too.
  expect(
    screen.queryByRole("button", { name: /new workspace/i }),
  ).not.toBeInTheDocument()
})

test("creating another workspace switches to it, and it starts empty", async () => {
  render(<WorkspacePage />)
  await ready()

  await userEvent.click(screen.getByRole("button", { name: /new workspace/i }))
  const dialog = await screen.findByRole("dialog")
  await userEvent.type(
    within(dialog).getByLabelText(/workspace name/i),
    "Second Team",
  )
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Create workspace" }),
  )

  await waitFor(() =>
    expect(toastSuccess).toHaveBeenCalledWith(
      "Second Team is ready. Connect your first repository.",
    ),
  )
  // It stays put: the page it was created from fills in for the new workspace.
  expect(nav.push).not.toHaveBeenCalled()

  // Switched to it, and none of Acme Engineering's three projects came along.
  const workspaces = await getWorkspaces()
  expect(workspaces.find((w) => w.is_active)?.name).toBe("Second Team")
  expect(await getProjects()).toEqual([])
})

test("settings and team share one page, with no tabs", async () => {
  render(<WorkspacePage />)
  await ready()

  expect(screen.queryByRole("tab")).not.toBeInTheDocument()
  expect(
    screen.getByRole("heading", { name: "Workspace settings" }),
  ).toBeInTheDocument()
  expect(
    await screen.findByRole("heading", { name: "Members" }),
  ).toBeInTheDocument()
  // The header counts pending invitations once the member list lands.
  await waitFor(() =>
    expect(screen.getByTestId("workspace-invitation-count")).toHaveTextContent(
      "1",
    ),
  )
})

test("an old ?tab=team link still lands on the team", async () => {
  nav.search = "tab=team"
  render(<WorkspacePage />)
  await ready()

  expect(
    await screen.findByRole("heading", { name: "Members" }),
  ).toBeInTheDocument()
  expect(nav.replace).not.toHaveBeenCalled()
})
