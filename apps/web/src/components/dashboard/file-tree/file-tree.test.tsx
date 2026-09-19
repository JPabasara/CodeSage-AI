import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, test, vi } from "vitest"

import { FileTree } from "@/components/dashboard/file-tree/file-tree"
import { mockTree } from "@/lib/mocks/fixtures"

test("renders nodes and tints each row via colorFor", () => {
  const colorFor = vi.fn(() => "rgb(255, 0, 0)")
  render(<FileTree nodes={mockTree} colorFor={colorFor} />)
  expect(screen.getByText("payment_service.ts")).toBeInTheDocument()
  expect(colorFor).toHaveBeenCalled()
})

test("collapsing a folder hides its children", async () => {
  render(<FileTree nodes={mockTree} colorFor={() => "red"} />)
  expect(screen.getByText("payment_service.ts")).toBeInTheDocument() // folders start expanded
  await userEvent.click(screen.getByRole("button", { name: /payments/i }))
  expect(screen.queryByText("payment_service.ts")).not.toBeInTheDocument()
})

test("hovering and selecting a node fire their callbacks", () => {
  const onHoverNode = vi.fn()
  const onSelectNode = vi.fn()
  render(
    <FileTree
      nodes={mockTree}
      colorFor={() => "red"}
      onHoverNode={onHoverNode}
      onSelectNode={onSelectNode}
    />,
  )
  const fileButton = screen.getByRole("button", {
    name: /payment_service\.ts/i,
  })
  fireEvent.mouseEnter(fileButton)
  expect(onHoverNode).toHaveBeenCalled()
  fireEvent.click(fileButton)
  expect(onSelectNode).toHaveBeenCalled()
})

// Detail mode must reveal the finding's file: tinting a row inside a folder the
// user collapsed earlier would highlight something invisible.
test("a selected file re-opens the folders that hide it", async () => {
  const { rerender } = render(
    <FileTree nodes={mockTree} colorFor={() => "red"} />,
  )

  await userEvent.click(screen.getByRole("button", { name: /payments/i }))
  expect(screen.queryByText("payment_service.ts")).not.toBeInTheDocument()

  rerender(
    <FileTree
      nodes={mockTree}
      colorFor={() => "red"}
      selectedPath="src/payments/payment_service.ts"
    />,
  )

  const row = screen.getByRole("button", { name: /payment_service\.ts/i })
  expect(row).toBeVisible()
  expect(row).toHaveAttribute("aria-current", "true")
})

test("renders a named empty state with next action when nodes is empty (U-14)", () => {
  render(<FileTree nodes={[]} colorFor={() => "red"} />)

  // Names what is empty and provides the next action
  expect(screen.getByText("No files in this tree")).toBeInTheDocument()
  expect(
    screen.getByText(/no files were detected in this snapshot/i),
  ).toBeInTheDocument()
  expect(
    screen.getByText(
      /run a scan to analyze and display the repository file hierarchy/i,
    ),
  ).toBeInTheDocument()

  // Must not render a list of files
  expect(screen.queryByRole("list")).not.toBeInTheDocument()
})

test("renders numeric health score, grade letter, and scale legend (U-8)", () => {
  render(<FileTree nodes={mockTree} colorFor={() => "rgb(0, 255, 0)"} />)

  // Scale legend above the tree
  expect(screen.getByLabelText("Health scale legend")).toBeInTheDocument()
  expect(screen.getByText(/<40 critical/)).toBeInTheDocument()
  expect(screen.getByText(/40–69 needs work/)).toBeInTheDocument()
  expect(screen.getByText(/70\+ healthy/)).toBeInTheDocument()

  // Rows render numeric score and grade letter beside node name
  const paymentRow = screen.getByRole("button", {
    name: /payment_service\.ts/i,
  })
  expect(paymentRow).toBeInTheDocument()
  expect(paymentRow.textContent).toContain("payment_service.ts")
  expect(paymentRow.textContent).toMatch(/[0-9]+/) // numeric score
  expect(paymentRow.textContent).toMatch(/[A-E]/) // grade letter
})

