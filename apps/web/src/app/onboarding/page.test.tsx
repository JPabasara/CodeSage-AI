import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, expect, test, vi } from "vitest"

import OnboardingPage from "./page"
import * as client from "@/lib/api/client"
import { getProjects, getWorkspaces } from "@/lib/api/client"
import { mockSession, mockSessionOnboarding } from "@/lib/mocks/fixtures"
import type { Session } from "@/lib/types"

const nav = vi.hoisted(() => ({ replace: vi.fn() }))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: vi.fn() }),
  usePathname: () => "/onboarding",
}))

vi.mock("next/image", () => ({
  default: () => <span data-testid="mock-next-image" />,
}))

const session = vi.hoisted(() => ({ current: null as Session | null }))
vi.mock("@/hooks/use-session", () => ({
  useSession: () => ({ data: session.current, error: undefined }),
}))

beforeEach(() => {
  nav.replace.mockClear()
  session.current = mockSessionOnboarding
})

test("explains what a workspace is for before asking for one", async () => {
  render(<OnboardingPage />)

  expect(
    await screen.findByRole("heading", { name: /create your workspace/i }),
  ).toBeInTheDocument()
  expect(screen.getByText(/repositories you connect belong/i)).toBeVisible()
  expect(screen.getByText(/teammates you invite join it/i)).toBeVisible()
  // No repository is created with it, and the page says so rather than letting
  // an empty Projects page read as a failure.
  expect(screen.getByText(/no repository is created/i)).toBeVisible()
})

test("a name is required before anything is sent", async () => {
  const post = vi.spyOn(client, "createWorkspace")
  render(<OnboardingPage />)

  await userEvent.click(
    await screen.findByRole("button", { name: "Create workspace" }),
  )

  expect(await screen.findByText(/needs a name/i)).toBeVisible()
  expect(post).not.toHaveBeenCalled()
  post.mockRestore()
})

test("creating a workspace enters the app at Projects", async () => {
  render(<OnboardingPage />)

  await userEvent.type(
    await screen.findByLabelText(/workspace name/i),
    "Fresh Start",
  )
  await userEvent.type(screen.getByLabelText(/description/i), "  ")
  await userEvent.click(
    screen.getByRole("button", { name: "Create workspace" }),
  )

  await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/projects"))

  // It really exists, it is really active, and it is really empty — the API
  // creates no repository with it.
  const workspaces = await getWorkspaces()
  const created = workspaces.find(
    (workspace) => workspace.name === "Fresh Start",
  )
  expect(created?.is_active).toBe(true)
  expect(await getProjects()).toEqual([])
})

test("whitespace-only optional fields are stored as absent, not as content", async () => {
  const post = vi.spyOn(client, "createWorkspace")
  render(<OnboardingPage />)

  await userEvent.type(
    await screen.findByLabelText(/workspace name/i),
    "  Fresh Start  ",
  )
  await userEvent.type(screen.getByLabelText(/description/i), "   ")
  await userEvent.click(
    screen.getByRole("button", { name: "Create workspace" }),
  )

  await waitFor(() => expect(post).toHaveBeenCalled())
  expect(post.mock.calls[0][0]).toMatchObject({
    name: "Fresh Start",
    description: null,
    website_url: null,
  })
  post.mockRestore()
})

test("a website that is not a URL is explained, and the form stays", async () => {
  render(<OnboardingPage />)

  await userEvent.type(await screen.findByLabelText(/workspace name/i), "Nope")
  await userEvent.type(screen.getByLabelText(/website/i), "not-a-url")
  await userEvent.click(
    screen.getByRole("button", { name: "Create workspace" }),
  )

  expect(
    await screen.findByText(/must be a full http or https URL/i),
  ).toBeVisible()
  expect(nav.replace).not.toHaveBeenCalled()
})

test("someone who already has a workspace is sent on to the app", async () => {
  session.current = mockSession

  render(<OnboardingPage />)

  // Arriving here with a workspace is a stale link or a back button, not a
  // state to sit in.
  await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/projects"))
})
