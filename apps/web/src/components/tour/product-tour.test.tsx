import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, expect, test, vi } from "vitest"

import {
  ProductTourProvider,
  useProductTour,
} from "@/components/tour/product-tour"
const navigation = vi.hoisted(() => ({
  pathname: "/workspace",
  query: "",
  push: vi.fn(),
}))
const session = vi.hoisted(() => ({
  required: true,
  userId: "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  repoId: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
}))
const finish = vi.hoisted(() => vi.fn(() => Promise.resolve()))

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.query),
  useRouter: () => ({ push: navigation.push }),
}))

vi.mock("@/hooks/use-session", () => ({
  useSession: () => ({
    data: {
      user_id: session.userId,
      workspace_id: "1e2f3a4b-5c6d-4e7f-8091-a2b3c4d5e6f7",
      product_tour_required: session.required,
    },
  }),
}))

vi.mock("@/hooks/use-projects", () => ({
  useProjects: () => ({ data: [{ id: session.repoId }] }),
}))

vi.mock("@/lib/api/client", () => ({
  finishProductTour: finish,
}))

function ManualStart() {
  const { startTour } = useProductTour()
  return (
    <>
      <button onClick={() => startTour("dashboard")}>Learn dashboard</button>
      <button onClick={() => startTour("profiles")}>Learn profiles</button>
    </>
  )
}

function renderTour(manual = false) {
  return render(
    <ProductTourProvider>
      {manual ? <ManualStart /> : null}
      <div data-tour="workspace-switcher">Workspace picker</div>
      <div data-tour="workspace-settings">Settings</div>
      <div data-tour="branch-selector">Branch picker</div>
      <div data-tour="scan-action">Scan</div>
      <div data-tour="dashboard-health">Health</div>
      <div data-tour="dashboard-views">Views</div>
      <div data-tour="profile-scope">Profile scope</div>
      <div data-tour="profile-pool">Profile pool</div>
      <div data-tour="profile-action">Profile action</div>
    </ProductTourProvider>,
  )
}

beforeEach(() => {
  localStorage.clear()
  navigation.pathname = "/workspace"
  navigation.query = ""
  navigation.push.mockClear()
  finish.mockClear()
  session.required = true
})

test("a new user gets the short tour and can skip the current section", async () => {
  const user = userEvent.setup()
  renderTour()

  expect(
    await screen.findByRole("heading", { name: "Your workspace is ready" }),
  ).toBeInTheDocument()
  await user.click(screen.getByRole("button", { name: "Next" }))
  expect(
    screen.getByRole("heading", { name: "Your team home" }),
  ).toBeInTheDocument()

  await user.click(screen.getByRole("button", { name: "Skip Workspace" }))
  expect(
    screen.getByRole("heading", { name: "Add a Java project" }),
  ).toBeInTheDocument()
  expect(navigation.push).toHaveBeenCalledWith("/projects")
})

test("closing asks before skipping the whole trial and remembers the answer", async () => {
  const user = userEvent.setup()
  renderTour()

  await user.click(await screen.findByRole("button", { name: "Close trial" }))
  expect(screen.getByText("Skip the entire trial?")).toBeInTheDocument()
  expect(
    screen.queryByRole("dialog", { name: /workspace trial step/i }),
  ).not.toBeInTheDocument()
  await user.click(screen.getByRole("button", { name: "Yes, skip trial" }))

  expect(finish).toHaveBeenCalledWith("skipped")
  expect(
    localStorage.getItem(`codesage.product-tour.v1:${session.userId}`),
  ).toBe("skipped")
})

test("Support can launch only the dashboard lesson", async () => {
  session.required = false
  navigation.pathname = "/support"
  const user = userEvent.setup()
  renderTour(true)

  await user.click(screen.getByRole("button", { name: "Learn dashboard" }))

  expect(
    screen.getByRole("heading", { name: "Choose a branch" }),
  ).toBeInTheDocument()
  expect(navigation.push).toHaveBeenCalledWith(`/dashboard/${session.repoId}`)
  expect(screen.getByText("1 of 4")).toBeInTheDocument()

  await user.click(screen.getByRole("button", { name: "Next" }))
  expect(screen.getByText(/branch you selected/i)).toBeInTheDocument()
  expect(screen.queryByText(/main branch/i)).not.toBeInTheDocument()
})

test("the Profiles lesson covers defaults, five custom profiles and a project override", async () => {
  session.required = false
  navigation.pathname = "/support"
  const user = userEvent.setup()
  renderTour(true)

  await user.click(screen.getByRole("button", { name: "Learn profiles" }))
  expect(screen.getByText("1 of 4")).toBeInTheDocument()

  await user.click(screen.getByRole("button", { name: "Next" }))
  expect(screen.getByText(/up to five custom profiles/i)).toBeInTheDocument()
  await user.click(screen.getByRole("button", { name: "Next" }))
  expect(
    screen.getByRole("heading", { name: "Set the workspace default" }),
  ).toBeInTheDocument()
  await user.click(screen.getByRole("button", { name: "Next" }))

  expect(screen.getByText(/Use for this project/i)).toBeInTheDocument()
  expect(navigation.push).toHaveBeenCalledWith(
    `/profiles?project=${session.repoId}`,
  )
})
