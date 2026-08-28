import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, test, vi } from "vitest"

import { ScanControl } from "@/components/layout/scan-control"

test("idle shows a Scan button that fires onScan", async () => {
  const onScan = vi.fn()
  render(<ScanControl phase="idle" progress={0} onScan={onScan} />)
  await userEvent.click(screen.getByRole("button", { name: /scan/i }))
  expect(onScan).toHaveBeenCalledTimes(1)
})

test("cancelled reads Cancelled and still offers a rescan", async () => {
  const onScan = vi.fn()
  render(<ScanControl phase="cancelled" progress={38} onScan={onScan} />)

  // A stopped scan must not render as a bare Scan button, which is what "idle"
  // looks like.
  expect(screen.getByText(/cancelled/i)).toBeInTheDocument()
  expect(screen.queryByText(/38%/)).not.toBeInTheDocument()

  await userEvent.click(screen.getByRole("button", { name: /scan/i }))
  expect(onScan).toHaveBeenCalledTimes(1)
})

test("cancelled looks different from idle", () => {
  const { unmount } = render(<ScanControl phase="idle" progress={0} />)
  const idleText = document.body.textContent
  unmount()

  render(<ScanControl phase="cancelled" progress={0} />)
  expect(document.body.textContent).not.toBe(idleText)
})

test("running shows progress and a Stop button that fires onStop", async () => {
  const onStop = vi.fn()
  render(<ScanControl phase="running" progress={47} onStop={onStop} />)
  expect(screen.getByText(/47%/)).toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: /stop/i }))
  expect(onStop).toHaveBeenCalledTimes(1)
})

test("stopping says so and refuses a second click", async () => {
  const onStop = vi.fn()
  render(<ScanControl phase="running" progress={85} stopping onStop={onStop} />)

  // The phase is still "running" here - that is exactly the window where the
  // old UI looked frozen at "Scanning… 85%".
  expect(screen.getByText(/stopping/i)).toBeInTheDocument()
  expect(screen.queryByText(/scanning/i)).not.toBeInTheDocument()

  const button = screen.getByRole("button", { name: /stop/i })
  expect(button).toBeDisabled()
  await userEvent.click(button)
  expect(onStop).not.toHaveBeenCalled()
})

test("running without stopping still shows progress and an enabled Stop", () => {
  render(<ScanControl phase="running" progress={85} />)
  expect(screen.getByText(/85%/)).toBeInTheDocument()
  expect(screen.queryByText(/stopping/i)).not.toBeInTheDocument()
  expect(screen.getByRole("button", { name: /stop/i })).toBeEnabled()
})
