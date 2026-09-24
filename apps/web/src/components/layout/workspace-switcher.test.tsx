import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, expect, test, vi } from "vitest"

import { WorkspaceSwitcher } from "./workspace-switcher"
import { getProfiles, getProjects, getWorkspaces } from "@/lib/api/client"
import {
  DEMO_REPO_ID,
  NIMBUS_REPO_ID,
  SECOND_WORKSPACE_ID,
  WORKSPACE_ID,
} from "@/lib/mocks/fixtures"
import { writeSelectedProjectId } from "@/hooks/use-selected-project"

const nav = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: vi.fn() }),
  usePathname: () => "/projects",
}))

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}))

async function renderSwitcher() {
  const workspaces = await getWorkspaces()
  render(<WorkspaceSwitcher workspaces={workspaces} />)
  return workspaces
}

/** Open the Radix listbox and pick a workspace by name. */
async function choose(name: string) {
  await userEvent.click(screen.getByRole("combobox", { name: "Workspace" }))
  await userEvent.click(
    await screen.findByRole("option", { name: new RegExp(name) }),
  )
}

beforeEach(() => {
  localStorage.clear()
  nav.push.mockClear()
})

test("shows the active workspace and the caller's role in it", async () => {
  await renderSwitcher()

  expect(screen.getByText("Acme Engineering")).toBeVisible()
  expect(screen.getByText("Org admin")).toBeVisible()
})

test("switching changes the session, the projects and the caller's role", async () => {
  await renderSwitcher()

  // Before: the three Acme repositories.
  expect((await getProjects()).map((repo) => repo.id)).toContain(DEMO_REPO_ID)

  await choose("Nimbus Labs")

  await waitFor(() => expect(nav.push).toHaveBeenCalled())

  const workspaces = await getWorkspaces()
  expect(workspaces.find((w) => w.is_active)?.workspace_id).toBe(
    SECOND_WORKSPACE_ID,
  )
  // Nothing from the workspace we left: different repositories, and not one of
  // the previous workspace's ids among them.
  const projects = await getProjects()
  expect(projects.map((repo) => repo.id)).toEqual([NIMBUS_REPO_ID])
  expect(projects.map((repo) => repo.id)).not.toContain(DEMO_REPO_ID)
})

test("each workspace keeps its own pool of profiles", async () => {
  await renderSwitcher()

  const acmePool = await getProfiles()
  await choose("Nimbus Labs")
  await waitFor(() => expect(nav.push).toHaveBeenCalled())

  const nimbusPool = await getProfiles()
  // Same three built-ins by name — they are seeded per workspace — but they are
  // this workspace's rows, with this workspace's default and usage counts.
  expect(nimbusPool.map((p) => p.name)).toEqual(acmePool.map((p) => p.name))
  expect(nimbusPool.filter((p) => p.is_active)).toHaveLength(1)
})

test("lands on the project that workspace was last on, when it still exists", async () => {
  // Nimbus Labs was last looking at its own repository.
  writeSelectedProjectId(NIMBUS_REPO_ID, SECOND_WORKSPACE_ID)
  await renderSwitcher()

  await choose("Nimbus Labs")

  await waitFor(() =>
    expect(nav.push).toHaveBeenCalledWith(`/dashboard/${NIMBUS_REPO_ID}`),
  )
})

test("a remembered project the workspace does not have sends you to Projects", async () => {
  // A repository from the OTHER workspace, stored against this one. Opening it
  // would be a 404 at best, and a cross-workspace read at worst.
  writeSelectedProjectId(DEMO_REPO_ID, SECOND_WORKSPACE_ID)
  await renderSwitcher()

  await choose("Nimbus Labs")

  await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/projects"))
})

test("a workspace with no remembered project opens Projects", async () => {
  await renderSwitcher()

  await choose("Nimbus Labs")

  await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/projects"))
  expect(writeSelectedProjectId(DEMO_REPO_ID, WORKSPACE_ID)).toBe(DEMO_REPO_ID)
})

test("with no workspace it says so and offers to create one", async () => {
  render(<WorkspaceSwitcher workspaces={[]} />)

  await userEvent.click(
    screen.getByRole("button", { name: /no workspace\s*create workspace/i }),
  )
  expect(
    await screen.findByRole("dialog", { name: "Create a workspace" }),
  ).toBeVisible()
})
