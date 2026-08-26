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

// D-CR7: detail mode must REVEAL the finding's file. Tinting a row inside a
// folder the user collapsed earlier would highlight something invisible.
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
