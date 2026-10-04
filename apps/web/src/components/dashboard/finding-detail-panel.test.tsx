import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, test, vi } from "vitest"

import { FindingDetailPanel } from "@/components/dashboard/finding-detail-panel"
import { mockFindings } from "@/lib/mocks/fixtures"

test("shows the finding's reason and location", () => {
  const finding = mockFindings[0]
  render(<FindingDetailPanel finding={finding} onClose={vi.fn()} />)

  expect(screen.getByText(finding.reason)).toBeInTheDocument()
  expect(
    screen.getByText(`${finding.file}:${finding.line}`),
  ).toBeInTheDocument()
})

// It is a region in the page, not a sheet over it.
test("renders no dialog — the detail is part of the page", () => {
  render(<FindingDetailPanel finding={mockFindings[0]} onClose={vi.fn()} />)
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
})

test("the close button asks the container to leave detail mode", async () => {
  const onClose = vi.fn()
  render(<FindingDetailPanel finding={mockFindings[0]} onClose={onClose} />)

  await userEvent.click(
    screen.getByRole("button", { name: /close finding detail/i }),
  )
  expect(onClose).toHaveBeenCalledOnce()
})

test("an empty snapshot keeps detail view open with a useful message", () => {
  render(<FindingDetailPanel finding={null} onClose={vi.fn()} />)

  const detail = screen.getByLabelText("Finding detail")
  expect(detail).toHaveTextContent("No findings to show")
  expect(detail).toHaveTextContent(/no findings in this snapshot/i)
  expect(
    screen.getByRole("button", { name: /close finding detail/i }),
  ).toBeInTheDocument()
})

test("an unselected detail asks the user to choose an available finding", () => {
  render(<FindingDetailPanel finding={null} hasFindings onClose={vi.fn()} />)

  expect(screen.getByText("Select a finding")).toBeInTheDocument()
  expect(
    screen.getByText(/choose a finding from the list/i),
  ).toBeInTheDocument()
})

test("an allowed user can mark an open finding done", async () => {
  const onStatusChange = vi.fn()
  render(
    <FindingDetailPanel
      finding={mockFindings[0]}
      onClose={vi.fn()}
      canTriage
      onStatusChange={onStatusChange}
    />,
  )

  await userEvent.click(screen.getByRole("button", { name: "Mark as done" }))
  expect(onStatusChange).toHaveBeenCalledWith(mockFindings[0], "done")
})

test("a done finding can be reopened, while read-only users get no action", () => {
  const done = { ...mockFindings[0], status: "done" as const }
  const editable = render(
    <FindingDetailPanel finding={done} onClose={vi.fn()} canTriage />,
  )
  expect(screen.getByText("Done")).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Reopen" })).toBeInTheDocument()

  editable.unmount()
  render(<FindingDetailPanel finding={done} onClose={vi.fn()} />)
  expect(screen.getByText("Done")).toBeInTheDocument()
  expect(
    screen.queryByRole("button", { name: "Reopen" }),
  ).not.toBeInTheDocument()
})

test("adds actionable guidance to a selected PMD finding", () => {
  const finding = {
    ...mockFindings[0],
    source: "rule" as const,
    rule_id: "pmd:UseEqualsToCompareStrings",
    reason: "Use equals() to compare strings instead of ==.",
  }

  render(<FindingDetailPanel finding={finding} onClose={vi.fn()} />)

  expect(screen.getByText("What PMD found")).toBeInTheDocument()
  expect(screen.getByText(finding.reason)).toBeInTheDocument()
  expect(screen.getByText("How to fix it")).toBeInTheDocument()
  expect(
    screen.getByText(/reference comparison checks object identity/i),
  ).toBeInTheDocument()
  expect(screen.getByText(/use equals or Objects.equals/i)).toBeInTheDocument()
  expect(
    screen.getByRole("link", { name: "Read the PMD rule documentation" }),
  ).toHaveAttribute(
    "href",
    "https://docs.pmd-code.org/pmd-doc-7.27.0/pmd_rules_java_errorprone.html#useequalstocomparestrings",
  )
})

const analyzedCommit = "a".repeat(40)

test.each([
  [undefined, "#L7"],
  [null, "#L7"],
  [7, "#L7"],
  [12, "#L7-L12"],
  [3, "#L7"],
  [0, "#L7"],
  [8.5, "#L7"],
])("links to the analyzed commit with end line %s", (end_line, anchor) => {
  render(
    <FindingDetailPanel
      finding={{ ...mockFindings[0], file: "src/A #é.java", line: 7, end_line }}
      repositoryUrl="https://github.com/acme/private-repo.git"
      commitSha={analyzedCommit}
      onClose={vi.fn()}
    />,
  )
  const link = screen.getByRole("link", { name: "Open at line 7 on GitHub" })
  expect(link).toHaveAttribute(
    "href",
    `https://github.com/acme/private-repo/blob/${analyzedCommit}/src/A%20%23%C3%A9.java${anchor}`,
  )
  expect(link).toHaveAttribute("target", "_blank")
  expect(link).toHaveAttribute("rel", "noopener noreferrer")
})

test.each([
  [undefined, analyzedCommit, "src/A.java", 7],
  ["https://example.com/acme/repo", analyzedCommit, "src/A.java", 7],
  ["https://github.com/acme/repo", undefined, "src/A.java", 7],
  ["https://github.com/acme/repo", "main", "src/A.java", 7],
  ["https://github.com/acme/repo", analyzedCommit, "../A.java", 7],
  ["https://github.com/acme/repo", analyzedCommit, "/src/A.java", 7],
  ["https://github.com/acme/repo", analyzedCommit, "", 7],
  ["https://github.com/acme/repo", analyzedCommit, "src/A.java", 0],
])(
  "hides the action for invalid metadata (%s, %s, %s, %s)",
  (repositoryUrl, commitSha, file, line) => {
    render(
      <FindingDetailPanel
        finding={{ ...mockFindings[0], file, line }}
        repositoryUrl={repositoryUrl}
        commitSha={commitSha}
        onClose={vi.fn()}
      />,
    )
    expect(
      screen.queryByRole("link", { name: /on GitHub/ }),
    ).not.toBeInTheDocument()
  },
)

test("shows the lines the finding points at, read from the analysed commit", async () => {
  render(
    <FindingDetailPanel
      finding={{ ...mockFindings[0], file: "src/Excerpt.java", line: 9 }}
      repositoryUrl="https://github.com/acme/repo"
      commitSha={analyzedCommit}
      onClose={vi.fn()}
    />,
  )

  const excerpt = await screen.findByRole("figure", {
    name: "Code at lines 7 to 11",
  })
  const marked = excerpt.querySelectorAll("[data-marked]")
  expect(marked).toHaveLength(1)
  expect(marked[0]).toHaveTextContent("9")
})

test("without trustworthy GitHub metadata there is no excerpt to fetch", () => {
  render(<FindingDetailPanel finding={mockFindings[0]} onClose={vi.fn()} />)
  expect(screen.queryByRole("figure")).not.toBeInTheDocument()
})

test("Copy link puts the page address, with this finding, on the clipboard", async () => {
  const user = userEvent.setup()
  const writeText = vi.spyOn(navigator.clipboard, "writeText")
  render(<FindingDetailPanel finding={mockFindings[0]} onClose={vi.fn()} />)

  await user.click(screen.getByRole("button", { name: "Copy link" }))
  expect(writeText).toHaveBeenCalledWith(window.location.href)
})
