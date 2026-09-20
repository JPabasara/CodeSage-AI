import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, test, vi } from "vitest"

import { ProjectList } from "@/components/projects/project-list"
import { mockRepos } from "@/lib/mocks/fixtures"

test("lists repositories and fires onSelect with the chosen repo", async () => {
  const onSelect = vi.fn()
  render(<ProjectList repos={mockRepos} onSelect={onSelect} />)
  expect(screen.getByText("acme/acme-payments")).toBeInTheDocument()

  const selectButtons = screen.getAllByRole("button", { name: /select/i })
  await userEvent.click(selectButtons[0])
  expect(onSelect).toHaveBeenCalledWith(mockRepos[0])
})

test("marks the active repository", () => {
  render(<ProjectList repos={mockRepos} activeRepoId={mockRepos[1].id} />)

  const activeRow = screen.getByText("Active").closest("li")
  expect(activeRow).toHaveAttribute("aria-current", "true")
  expect(activeRow).toHaveTextContent("acme/web-store")
})

test("shows a named empty state naming what is empty and the next action when there are no repositories (U-14)", () => {
  render(<ProjectList repos={[]} />)
  expect(
    screen.getByText(/no repositories yet — connect one to see its health/i),
  ).toBeInTheDocument()
})
