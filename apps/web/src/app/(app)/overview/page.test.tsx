import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { http, HttpResponse } from "msw"
import { beforeEach, expect, test, vi } from "vitest"

import { server } from "@/lib/mocks/server"
import {
  DEMO_REPO_ID,
  mockRepos,
  mockSession,
  mockSessionViewer,
  UNSCANNED_REPO_ID,
} from "@/lib/mocks/fixtures"
import type { Repo, Session } from "@/lib/types"
import { workspaceHealth } from "@/lib/workspace-health"
import OverviewPage from "./page"

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }))

vi.mock("next/navigation", () => ({
  usePathname: () => "/overview",
  useRouter: () => ({ push: pushMock, prefetch: vi.fn() }),
}))

const session = vi.hoisted(() => ({ current: null as Session | null }))
vi.mock("@/hooks/use-session", () => ({
  useSession: () => ({ data: session.current, loading: false }),
}))

beforeEach(() => {
  session.current = mockSession
  localStorage.clear()
  pushMock.mockClear()
})

async function ready() {
  return screen.findByRole("table")
}

test("the summary averages the scanned projects and counts across them", async () => {
  render(<OverviewPage />)
  await ready()

  const projects = (await (await fetch("/api/projects")).json()) as Repo[]
  const expected = workspaceHealth(projects)
  const health = screen.getByTestId("kpi-workspace-health")
  expect(
    within(health).getByText(String(Math.round(expected?.score ?? 0))),
  ).toBeInTheDocument()
  expect(within(health).getByText(/weighted by size/i)).toBeInTheDocument()
  expect(within(health).getByText(/1 not scanned/)).toBeInTheDocument()

  const red = projects.reduce(
    (sum, repo) => sum + (repo.latest_health?.red_issue_count ?? 0),
    0,
  )
  expect(
    within(screen.getByTestId("kpi-workspace-red")).getByText(String(red)),
  ).toBeInTheDocument()
})

test("projects are listed worst first, and the order can change", async () => {
  const user = userEvent.setup()
  render(<OverviewPage />)
  const table = await ready()

  const names = () =>
    within(table)
      .getAllByRole("row")
      .slice(1)
      .map((row) => within(row).getAllByRole("cell")[0].textContent ?? "")
  const projects = (await (await fetch("/api/projects")).json()) as Repo[]
  const scanned = projects
    .filter((repo) => repo.latest_health)
    .sort((a, b) => a.latest_health!.score - b.latest_health!.score)
  expect(names()[0]).toContain(scanned[0].name)
  // The project never scanned comes last.
  expect(names().at(-1)).toContain(
    projects.find((repo) => !repo.latest_health)?.name ?? "",
  )

  await user.click(screen.getByRole("combobox", { name: "Sort projects" }))
  await user.click(await screen.findByRole("option", { name: "Name" }))
  const sortedByName = [...projects].sort((a, b) =>
    a.name.localeCompare(b.name),
  )
  expect(names()[0]).toContain(sortedByName[0].name)
})

test("a row opens that project's dashboard", async () => {
  const user = userEvent.setup()
  render(<OverviewPage />)
  const table = await ready()

  const demo = mockRepos.find((repo) => repo.id === DEMO_REPO_ID)!
  const row = within(table)
    .getByRole("link", { name: demo.name })
    .closest("tr") as HTMLTableRowElement
  // Anywhere on the row, not only the name.
  await user.click(within(row).getAllByRole("cell")[1])
  expect(pushMock).toHaveBeenCalledWith(`/dashboard/${DEMO_REPO_ID}`)
})

test("a project never scanned offers its first scan, which starts it", async () => {
  const user = userEvent.setup()
  let started: string | undefined
  server.use(
    http.post("*/api/repos/:repoId/scan", async ({ params }) => {
      started = String(params.repoId)
      return HttpResponse.json(
        {
          scan_id: "11111111-1111-4111-8111-111111111111",
          phase: "queued",
          progress: 0,
          branch: "main",
        },
        { status: 202 },
      )
    }),
  )
  render(<OverviewPage />)
  await ready()

  const unscanned = mockRepos.find((repo) => repo.id === UNSCANNED_REPO_ID)!
  const attention = screen.getByRole("region", { name: "Needs attention" })
  expect(
    within(attention).getByText(`${unscanned.name} has never been scanned`),
  ).toBeInTheDocument()

  await user.click(
    screen.getByRole("button", { name: `Run first scan of ${unscanned.name}` }),
  )
  await waitFor(() => expect(started).toBe(UNSCANNED_REPO_ID))
})

test("a viewer sees every project but cannot start a scan", async () => {
  session.current = mockSessionViewer
  render(<OverviewPage />)
  await ready()

  const unscanned = mockRepos.find((repo) => repo.id === UNSCANNED_REPO_ID)!
  expect(
    screen.getByRole("button", { name: `Run first scan of ${unscanned.name}` }),
  ).toBeDisabled()
  expect(screen.queryByRole("link", { name: /connect repository/i })).toBeNull()
})

test("an empty workspace explains what will appear and how to start", async () => {
  server.use(http.get("*/api/projects", () => HttpResponse.json([])))
  render(<OverviewPage />)

  expect(await screen.findByText("No repositories yet")).toBeInTheDocument()
  expect(
    screen.getByRole("link", { name: "Connect a repository" }),
  ).toHaveAttribute("href", "/projects")
})
