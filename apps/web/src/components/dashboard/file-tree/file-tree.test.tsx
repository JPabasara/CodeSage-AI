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

test("renders the heat-map legend and per-node grade/score", () => {
  render(<FileTree nodes={mockTree} colorFor={() => "red"} />)

  expect(screen.getByLabelText("Heat map legend")).toBeInTheDocument()
  const payment = screen.getByRole("button", {
    name: /payment_service\.ts, grade [A-E], score \d+/i,
  })
  expect(payment).toBeInTheDocument()
  expect(payment).toHaveTextContent(/[A-E]\d+/)
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

test("selecting a file without a finding calls the feedback path", async () => {
  const onSelectNode = vi.fn()
  const onSelectNodeWithoutFinding = vi.fn()

  render(
    <FileTree
      nodes={mockTree}
      colorFor={() => "red"}
      hasFinding={(node) => node.path !== "src/lib/formatters.ts"}
      onSelectNode={onSelectNode}
      onSelectNodeWithoutFinding={onSelectNodeWithoutFinding}
    />,
  )

  await userEvent.click(screen.getByRole("button", { name: /formatters\.ts/i }))

  expect(onSelectNodeWithoutFinding).toHaveBeenCalledWith(
    expect.objectContaining({ path: "src/lib/formatters.ts" }),
  )
  expect(onSelectNode).not.toHaveBeenCalledWith(
    expect.objectContaining({ path: "src/lib/formatters.ts" }),
  )
})

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

  expect(screen.getByText("No files in this tree")).toBeInTheDocument()
  expect(
    screen.getByText(/no files were detected in this snapshot/i),
  ).toBeInTheDocument()
  expect(
    screen.getByText(
      /run a scan to analyze and display the repository file hierarchy/i,
    ),
  ).toBeInTheDocument()

  expect(screen.queryByRole("list")).not.toBeInTheDocument()
})
