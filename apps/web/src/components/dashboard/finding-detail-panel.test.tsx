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

// D-CR7: it is a region in the page now, not a Sheet over it. A dialog would
// still trap focus and blur the tree, which is the behaviour we removed.
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

test("renders nothing when there is no finding", () => {
  const { container } = render(
    <FindingDetailPanel finding={null} onClose={vi.fn()} />,
  )
  expect(container).toBeEmptyDOMElement()
})
