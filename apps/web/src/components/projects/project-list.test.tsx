import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, test, vi } from "vitest"

import { ProjectList } from "@/components/projects/project-list"
import { mockRepos } from "@/lib/mocks/fixtures"

test("lists repositories and fires onSelect from the dashboard action", async () => {
  const onSelect = vi.fn()
  render(<ProjectList repos={mockRepos} onSelect={onSelect} />)
  expect(screen.getByText("acme-payments")).toBeInTheDocument()

  const dashboardLink = screen.getByRole("link", {
    name: /go to dashboard for acme\/acme-payments/i,
  })
  dashboardLink.addEventListener("click", (event) => event.preventDefault())
  await userEvent.click(dashboardLink)
  expect(onSelect).toHaveBeenCalledWith(mockRepos[0])
})

test("fires onSelect from the select action without navigation", async () => {
  const onSelect = vi.fn()
  render(<ProjectList repos={mockRepos} onSelect={onSelect} />)

  await userEvent.click(
    screen.getByRole("button", { name: /select acme\/web-store/i }),
  )

  expect(onSelect).toHaveBeenCalledWith(mockRepos[1])
})

test("fires onHistory from the history action", async () => {
  const onHistory = vi.fn()
  render(<ProjectList repos={mockRepos} onHistory={onHistory} />)

  const historyLink = screen.getByRole("link", {
    name: /open scan history for acme\/acme-payments/i,
  })
  historyLink.addEventListener("click", (event) => event.preventDefault())
  await userEvent.click(historyLink)
  expect(onHistory).toHaveBeenCalledWith(mockRepos[0])
})

test("marks the active repository", () => {
  render(<ProjectList repos={mockRepos} activeRepoId={mockRepos[1].id} />)

  const activeRow = screen.getByText("Active").closest("li")
  expect(activeRow).toHaveAttribute("aria-current", "true")
  expect(activeRow).toHaveTextContent("web-store")
  expect(activeRow).toHaveTextContent("acme")
})

test("shows a named empty state naming what is empty and the next action when there are no repositories (U-14)", () => {
  render(<ProjectList repos={[]} />)
  expect(screen.getByText(/no repositories connected/i)).toBeInTheDocument()
  expect(
    screen.getByText(/connect a public repository to start building/i),
  ).toBeInTheDocument()
})

// ── latest health, delete (13F) ────────────────────────────────────────────

const withHealth = (score: number, delta: number) => [
  {
    ...mockRepos[0],
    latest_health: { score, grade: "A" as const, delta },
  },
]

test("latest health is a rounded score, like every other screen", () => {
  // The API sends the unrounded score; it used to be printed as it came.
  render(<ProjectList repos={withHealth(91.66128502980848, 2.4)} />)

  const row = screen.getByText("acme-payments").closest("li")!
  expect(row).toHaveTextContent("92/100")
  expect(row).toHaveTextContent("+2")
  expect(row).not.toHaveTextContent("91.66")
})

test("a falling score shows a real minus sign, and no change shows ±0", () => {
  const { unmount } = render(<ProjectList repos={withHealth(70.2, -3.4)} />)
  expect(screen.getByText("acme-payments").closest("li")).toHaveTextContent(
    "−3",
  )
  unmount()

  render(<ProjectList repos={withHealth(70.2, 0.2)} />)
  expect(screen.getByText("acme-payments").closest("li")).toHaveTextContent(
    "±0",
  )
})

test("Delete is a labelled button, and only offered when onRemove is given", async () => {
  const onRemove = vi.fn()
  const { unmount } = render(
    <ProjectList repos={mockRepos} onRemove={onRemove} />,
  )

  const button = screen.getByRole("button", {
    name: "Delete acme/acme-payments repository",
  })
  // Visible text, not an icon: the name a screen reader hears starts with it.
  expect(button).toHaveTextContent("Delete")
  await userEvent.click(button)
  expect(onRemove).toHaveBeenCalledWith(mockRepos[0])
  unmount()

  render(<ProjectList repos={mockRepos} />)
  expect(
    screen.queryByRole("button", { name: /^delete /i }),
  ).not.toBeInTheDocument()
})

test("latest health says which branch it was scanned on", () => {
  render(<ProjectList repos={mockRepos} />)
  const row = screen.getByText("acme-payments").closest("li")!
  // The hint is the default branch's latest scan.
  expect(within(row).getByTestId("project-health-branch")).toHaveTextContent(
    `on branch ${mockRepos[0].default_branch}`,
  )
})
