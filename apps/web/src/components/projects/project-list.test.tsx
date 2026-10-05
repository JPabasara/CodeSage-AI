import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, test, vi } from "vitest"

import { ProjectList } from "@/components/projects/project-list"
import { mockRepos } from "@/lib/mocks/fixtures"
import type { ActiveScan } from "@/lib/types"

// mockRepos: acme-payments and web-store are scanned, octo-cli never was.
const rowOf = (name: string) => screen.getByText(name).closest("li")!

/** A link the test follows without jsdom trying to navigate. */
function stayOnPage(link: HTMLElement) {
  link.addEventListener("click", (event) => event.preventDefault())
  return link
}

test("there is no Select button: opening a project is what selects it", () => {
  render(<ProjectList repos={mockRepos} onSelect={vi.fn()} onOpen={vi.fn()} />)

  expect(
    screen.queryByRole("button", { name: /^select/i }),
  ).not.toBeInTheDocument()
  expect(screen.queryByText(/^selected$/i)).not.toBeInTheDocument()
})

test("clicking a row opens that project", async () => {
  const onOpen = vi.fn()
  const onSelect = vi.fn()
  render(<ProjectList repos={mockRepos} onOpen={onOpen} onSelect={onSelect} />)

  // Anywhere on the row that is not a control of its own.
  await userEvent.click(within(rowOf("web-store")).getByText("public"))

  expect(onOpen).toHaveBeenCalledTimes(1)
  expect(onOpen).toHaveBeenCalledWith(mockRepos[1])
})

test("the name links to the dashboard and selects, without also opening twice", async () => {
  const onOpen = vi.fn()
  const onSelect = vi.fn()
  render(<ProjectList repos={mockRepos} onOpen={onOpen} onSelect={onSelect} />)

  const link = stayOnPage(
    screen.getByRole("link", { name: "Go to dashboard for acme/web-store" }),
  )
  expect(link).toHaveAttribute("href", `/dashboard/${mockRepos[1].id}`)
  expect(link).toHaveTextContent("web-store")
  await userEvent.click(link)

  expect(onSelect).toHaveBeenCalledWith(mockRepos[1])
  expect(onOpen).not.toHaveBeenCalled()
})

test("Open dashboard links to a scanned project's dashboard and selects it", async () => {
  const onOpen = vi.fn()
  const onSelect = vi.fn()
  render(<ProjectList repos={mockRepos} onOpen={onOpen} onSelect={onSelect} />)

  const link = stayOnPage(
    screen.getByRole("link", { name: "Open dashboard for acme/acme-payments" }),
  )
  expect(link).toHaveAttribute("href", `/dashboard/${mockRepos[0].id}`)
  expect(link).toHaveTextContent("Open dashboard")
  await userEvent.click(link)

  expect(onSelect).toHaveBeenCalledWith(mockRepos[0])
  expect(onOpen).not.toHaveBeenCalled()
})

test("the active project shows a Current chip and is marked current", () => {
  render(<ProjectList repos={mockRepos} activeRepoId={mockRepos[1].id} />)

  const chip = screen.getByText("Current")
  const activeRow = chip.closest("li")
  expect(activeRow).toHaveAttribute("aria-current", "true")
  expect(activeRow).toHaveTextContent("web-store")
  expect(screen.getAllByText("Current")).toHaveLength(1)
  expect(rowOf("acme-payments")).not.toHaveAttribute("aria-current")
})

test("an unscanned repository offers Run first scan instead of Open dashboard", async () => {
  const onFirstScan = vi.fn()
  const onOpen = vi.fn()
  render(
    <ProjectList repos={mockRepos} onFirstScan={onFirstScan} onOpen={onOpen} />,
  )

  const octo = rowOf("octo-cli")
  expect(
    within(octo).queryByRole("link", { name: /open dashboard/i }),
  ).not.toBeInTheDocument()
  await userEvent.click(
    within(octo).getByRole("button", {
      name: "Run first scan of acme/octo-cli",
    }),
  )
  expect(onFirstScan).toHaveBeenCalledWith(mockRepos[2])
  // The button's click is its own, not the row's.
  expect(onOpen).not.toHaveBeenCalled()

  // Scanned repositories keep Open dashboard.
  expect(
    within(rowOf("acme-payments")).queryByRole("button", {
      name: /run first scan/i,
    }),
  ).not.toBeInTheDocument()
})

test("Run first scan is locked, with the reason, for a role that cannot scan", () => {
  render(
    <ProjectList
      repos={mockRepos}
      onFirstScan={vi.fn()}
      scanLockedReason="Viewers can't start scans"
    />,
  )

  expect(
    screen.getByRole("button", { name: "Run first scan of acme/octo-cli" }),
  ).toBeDisabled()
  expect(screen.getByLabelText("Viewers can't start scans")).toBeInTheDocument()
})

test("fires onHistory from the history action", async () => {
  const onHistory = vi.fn()
  render(<ProjectList repos={mockRepos} onHistory={onHistory} />)

  const historyLink = stayOnPage(
    screen.getByRole("link", {
      name: /open scan history for acme\/acme-payments/i,
    }),
  )
  expect(historyLink).toHaveAttribute(
    "href",
    `/dashboard/${mockRepos[0].id}/history`,
  )
  await userEvent.click(historyLink)
  expect(onHistory).toHaveBeenCalledWith(mockRepos[0])
})

test("each row links to the repository on GitHub", () => {
  render(<ProjectList repos={mockRepos} />)

  const github = screen.getByRole("link", {
    name: "Open acme/acme-payments on GitHub",
  })
  expect(github).toHaveAttribute("href", mockRepos[0].url)
  expect(github).toHaveAttribute("target", "_blank")
})

test("Remove repository… lives in the ⋯ menu and does not open the row", async () => {
  const onRemove = vi.fn()
  const onOpen = vi.fn()
  render(<ProjectList repos={mockRepos} onRemove={onRemove} onOpen={onOpen} />)

  await userEvent.click(
    screen.getByRole("button", { name: "More actions for acme/acme-payments" }),
  )
  await userEvent.click(
    await screen.findByRole("menuitem", { name: "Remove repository…" }),
  )

  expect(onRemove).toHaveBeenCalledWith(mockRepos[0])
  expect(onOpen).not.toHaveBeenCalled()
})

test("the ⋯ menu is locked with a reason for a role that cannot remove, and absent without either", () => {
  const { unmount } = render(
    <ProjectList
      repos={mockRepos}
      removeLockedReason="Only org-admins and managers can remove repositories"
    />,
  )
  expect(
    screen.getByRole("button", { name: "More actions for acme/acme-payments" }),
  ).toBeDisabled()
  expect(
    screen.getAllByLabelText(
      "Only org-admins and managers can remove repositories",
    ).length,
  ).toBe(mockRepos.length)
  unmount()

  render(<ProjectList repos={mockRepos} />)
  expect(
    screen.queryByRole("button", { name: /more actions/i }),
  ).not.toBeInTheDocument()
})

test("shows a named empty state naming what is empty and the next action when there are no repositories", () => {
  render(<ProjectList repos={[]} />)
  expect(screen.getByText(/no repositories connected/i)).toBeInTheDocument()
  expect(
    screen.getByText(/connect a public repository to start building/i),
  ).toBeInTheDocument()
})

const withHealth = (score: number, delta: number) => [
  {
    ...mockRepos[0],
    latest_health: { score, grade: "A" as const, delta },
  },
]

test("latest health is a rounded score, like every other screen", () => {
  // The API sends the unrounded score; it used to be printed as it came.
  render(<ProjectList repos={withHealth(91.66128502980848, 2.4)} />)

  const row = rowOf("acme-payments")
  expect(row).toHaveTextContent("92/100")
  expect(row).toHaveTextContent("+2")
  expect(row).not.toHaveTextContent("91.66")
})

test("a falling score shows a real minus sign, and no change shows ±0", () => {
  const { unmount } = render(<ProjectList repos={withHealth(70.2, -3.4)} />)
  expect(rowOf("acme-payments")).toHaveTextContent("−3")
  unmount()

  render(<ProjectList repos={withHealth(70.2, 0.2)} />)
  expect(rowOf("acme-payments")).toHaveTextContent("±0")
})

test("an unscanned repository says so instead of showing a score", () => {
  render(<ProjectList repos={mockRepos} />)
  const octo = rowOf("octo-cli")
  expect(octo).toHaveTextContent(/not scanned yet/i)
  expect(octo).not.toHaveTextContent("/100")
})

test("each row names its default branch", () => {
  render(<ProjectList repos={mockRepos} />)
  expect(
    within(rowOf("acme-payments")).getByTestId("project-health-branch"),
  ).toHaveTextContent(mockRepos[0].default_branch)
  expect(
    within(rowOf("octo-cli")).getByTestId("project-health-branch"),
  ).toHaveTextContent("trunk")
})

// ── a scan already running: the row says so instead of offering another ─────

const activityFor = (
  repoId: string,
  status: Partial<ActiveScan["status"]>,
): ActiveScan[] => [
  {
    repo_id: repoId,
    repo_name: "acme/octo-cli",
    status: { scan_id: "s1", phase: "running", progress: 40, ...status },
  },
]

test("a running first scan shows its progress, not Run first scan", () => {
  const octo = mockRepos[2]
  render(
    <ProjectList
      repos={mockRepos}
      onFirstScan={vi.fn()}
      activity={activityFor(octo.id, { stage: "reading_code", progress: 40 })}
    />,
  )

  const row = rowOf("octo-cli")
  expect(
    within(row).queryByRole("button", { name: /run first scan/i }),
  ).not.toBeInTheDocument()
  const watch = within(row).getByRole("link", {
    name: "Scanning acme/octo-cli: view progress",
  })
  expect(watch).toHaveAttribute("href", `/dashboard/${octo.id}`)
  expect(watch).toHaveTextContent("Scanning 40%")
})

test("a queued scan says Queued, and a stopping one says Stopping", () => {
  const octo = mockRepos[2]
  const { rerender } = render(
    <ProjectList
      repos={mockRepos}
      onFirstScan={vi.fn()}
      activity={activityFor(octo.id, { phase: "queued", progress: 0 })}
    />,
  )
  expect(
    within(rowOf("octo-cli")).getByRole("link", {
      name: "Queued acme/octo-cli: view progress",
    }),
  ).toHaveTextContent("Queued…")

  rerender(
    <ProjectList
      repos={mockRepos}
      onFirstScan={vi.fn()}
      activity={activityFor(octo.id, { cancel_requested: true })}
    />,
  )
  expect(
    within(rowOf("octo-cli")).getByRole("link", {
      name: "Stopping acme/octo-cli: view progress",
    }),
  ).toBeInTheDocument()
})

test("a scanned project with a scan running offers to watch it, not Open dashboard", () => {
  const payments = mockRepos[0]
  render(
    <ProjectList
      repos={mockRepos}
      activity={activityFor(payments.id, {
        progress: 60,
        stage: "finding_debt",
      })}
    />,
  )

  const row = rowOf("acme-payments")
  expect(
    within(row).queryByRole("link", { name: /open dashboard/i }),
  ).not.toBeInTheDocument()
  expect(
    within(row).getByRole("link", { name: /^Scanning .*: view progress$/ }),
  ).toBeInTheDocument()
  // Other rows are unaffected.
  expect(
    within(rowOf("web-store")).getByRole("link", { name: /open dashboard/i }),
  ).toBeInTheDocument()
})
