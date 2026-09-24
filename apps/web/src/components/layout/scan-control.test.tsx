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
  //
  // Exact text, not /stopping/i: the screen-reader announcement says "Stopping
  // the scan" and would match the loose pattern too. Two different messages for
  // two different audiences, and a test should say which one it means.
  expect(screen.getByText("Stopping…")).toBeInTheDocument()
  expect(screen.queryByText(/scanning…/i)).not.toBeInTheDocument()

  const button = screen.getByRole("button", { name: /stop/i })
  expect(button).toBeDisabled()
  await userEvent.click(button)
  expect(onStop).not.toHaveBeenCalled()
})

test("running without stopping still shows progress and an enabled Stop", () => {
  render(<ScanControl phase="running" progress={85} onStop={() => {}} />)
  expect(screen.getByText(/85%/)).toBeInTheDocument()
  expect(screen.queryByText(/stopping/i)).not.toBeInTheDocument()
  expect(screen.getByRole("button", { name: /stop/i })).toBeEnabled()
})

// ── queued is not running, and progress is announced (U-9, #115) ─────────────

test("queued says so instead of claiming a scan is 0% done", () => {
  render(<ScanControl phase="queued" progress={0} />)

  // "Scanning… 0%" claimed work had started and then stalled, which is the
  // reading that makes someone press Stop on a scan that never began.
  expect(screen.getByText("Queued…")).toBeInTheDocument()
  expect(screen.queryByText(/scanning…/i)).not.toBeInTheDocument()
  expect(screen.queryByText(/0%/)).not.toBeInTheDocument()
})

test("queued shows no progress bar, because there is no progress yet", () => {
  render(<ScanControl phase="queued" progress={0} />)

  // An empty bar reads as "0% done", not as "not started".
  expect(screen.queryByRole("progressbar")).not.toBeInTheDocument()
  // …but Stop is still offered: a queued job can be abandoned.
  expect(screen.getByRole("button", { name: /stop/i })).toBeInTheDocument()
})

test("running still shows its progress bar", () => {
  render(<ScanControl phase="running" progress={47} />)
  expect(screen.getByRole("progressbar")).toBeInTheDocument()
})

test("progress is announced politely, and rounded so it can be read aloud", () => {
  render(<ScanControl phase="running" progress={47} />)

  const status = screen.getByRole("status")
  expect(status).toHaveAttribute("aria-live", "polite")
  // 47 → 25. Announcing every tick reads a number that has already changed by
  // the time the sentence ends.
  expect(status).toHaveTextContent("Scanning, 25 percent complete")
})

test("a queued scan announces that it is waiting, not that it is scanning", () => {
  render(<ScanControl phase="queued" progress={0} />)
  expect(screen.getByRole("status")).toHaveTextContent(
    "Scan queued, waiting for a worker",
  )
})

test("Stop waits until the scan has an id to stop", () => {
  // Pressed before the start request answered, there is nothing to cancel yet.
  render(<ScanControl phase="queued" progress={0} />)
  expect(screen.getByRole("button", { name: /stop/i })).toBeDisabled()
})

test("a role that cannot start scans sees Scan disabled, with the reason", async () => {
  const { default: userEvent } = await import("@testing-library/user-event")
  render(
    <ScanControl
      phase="idle"
      progress={0}
      lockedReason="Viewers can't start scans"
    />,
  )

  expect(screen.getByRole("button", { name: /scan/i })).toBeDisabled()
  await userEvent.tab()
  expect(await screen.findByRole("tooltip")).toHaveTextContent(
    "Viewers can't start scans",
  )
})

test("with Stop elsewhere, the running state is a compact busy button", () => {
  render(<ScanControl phase="running" progress={40} showStop={false} />)
  expect(screen.getByRole("button", { name: "Scanning…" })).toBeDisabled()
  expect(screen.queryByText(/40%/)).toBeNull() // the strip carries the number
  expect(screen.queryByRole("button", { name: /stop/i })).toBeNull()
})
