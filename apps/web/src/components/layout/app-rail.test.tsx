import { render, screen, within } from "@testing-library/react"
import type { ImgHTMLAttributes } from "react"
import { beforeEach, expect, test, vi } from "vitest"

import { AppRail } from "@/components/layout/app-rail"
import { SidebarProvider } from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"
import { mockRepos, SECOND_REPO_ID } from "@/lib/mocks/fixtures"
import type { Repo } from "@/lib/types"

const nav = vi.hoisted(() => ({
  pathname: "/projects",
}))

const data = vi.hoisted(() => ({
  repos: [] as Repo[],
}))

vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock("next/image", () => ({
  default: (
    props: ImgHTMLAttributes<HTMLImageElement> & { priority?: boolean },
  ) => {
    void props
    return <span data-testid="mock-next-image" />
  },
}))

vi.mock("@/hooks/use-session", () => ({
  useSession: () => ({ data: null }),
}))

vi.mock("@/hooks/use-projects", () => ({
  useProjects: () => ({ data: data.repos }),
}))

function renderRail() {
  return render(
    <TooltipProvider>
      <SidebarProvider>
        <AppRail />
      </SidebarProvider>
    </TooltipProvider>,
  )
}

beforeEach(() => {
  localStorage.clear()
  nav.pathname = "/projects"
  data.repos = [...mockRepos]
})

test("dashboard links follow the project in the current dashboard URL", () => {
  nav.pathname = `/dashboard/${SECOND_REPO_ID}`

  renderRail()

  expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute(
    "href",
    `/dashboard/${SECOND_REPO_ID}`,
  )
  expect(screen.getByRole("link", { name: "Scan history" })).toHaveAttribute(
    "href",
    `/dashboard/${SECOND_REPO_ID}/history`,
  )
})

test("with no project, the project group stays hidden until there is one", () => {
  data.repos = []

  renderRail()

  expect(screen.queryByRole("link", { name: "Dashboard" })).toBeNull()
  expect(screen.queryByRole("link", { name: "Scan history" })).toBeNull()
  expect(screen.getByRole("link", { name: "Projects" })).toHaveAttribute(
    "href",
    "/projects",
  )
})

test("the project group is labelled with the project it belongs to", () => {
  nav.pathname = `/dashboard/${SECOND_REPO_ID}`

  renderRail()

  const name = mockRepos.find((repo) => repo.id === SECOND_REPO_ID)?.name ?? ""
  expect(screen.getByText(`· ${name}`)).toBeInTheDocument()
})

test("workspace pages come first, then the project's, and Support opens the Help Centre", () => {
  renderRail()
  const nav = screen.getByRole("navigation", { name: "Main navigation" })
  expect(
    within(nav)
      .getAllByRole("link")
      .map((link) => link.textContent?.trim()),
  ).toEqual([
    "Overview",
    "Projects",
    "Scoring profiles",
    "Team & settings",
    "Dashboard",
    "Scan history",
  ])
  expect(screen.getByRole("link", { name: "Support" })).toHaveAttribute(
    "href",
    "/help",
  )
  expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute(
    "href",
    "/overview",
  )
})

test("the workspace switcher lives in the top bar; theme and sign out sit at the rail's foot", () => {
  renderRail()
  expect(screen.queryByRole("combobox", { name: /workspace/i })).toBeNull()
  expect(screen.getByRole("button", { name: "Theme" })).toBeInTheDocument()
  expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument()
})

test("with no workspace every link stays, marked as locked", async () => {
  const { noteActiveWorkspace } = await import("@/hooks/use-workspace-scope")
  noteActiveWorkspace(null)
  renderRail()

  const nav = screen.getByRole("navigation", { name: "Main navigation" })
  const projects = within(nav).getByRole("link", { name: /projects/i })
  expect(projects).toHaveAccessibleName(/create a workspace first/i)
  expect(projects).toHaveAttribute("title", "Create a workspace first")
  expect(screen.getByRole("link", { name: "Support" })).not.toHaveAttribute(
    "title",
  )
})
