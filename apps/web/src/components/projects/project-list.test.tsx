import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, test, vi } from "vitest"

import { ProjectList } from "@/components/projects/project-list"
import { mockRepos } from "@/lib/mocks/fixtures"

test("lists repositories and fires onSelect from the dashboard action", async () => {
  const onSelect = vi.fn()
  render(<ProjectList repos={mockRepos} onSelect={onSelect} />)
  expect(screen.getByText("acme-payments")).toBeInTheDocument()

  const dashboardLink = screen.getByRole("link", {
    name: /open dashboard for acme\/acme-payments/i,
  })
  dashboardLink.addEventListener("click", (event) => event.preventDefault())
  await userEvent.click(dashboardLink)
  expect(onSelect).toHaveBeenCalledWith(mockRepos[0])
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
