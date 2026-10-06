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

  // A stopped scan must not render as a bare Scan button, which is what "idle" looks like.
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

test("queued says so instead of claiming a scan is 0% done", () => {
  render(<ScanControl phase="queued" progress={0} />)

  expect(screen.getByText("Queued…")).toBeInTheDocument()
  expect(screen.queryByText(/scanning…/i)).not.toBeInTheDocument()
  expect(screen.queryByText(/0%/)).not.toBeInTheDocument()
})

test("queued shows no progress bar, because there is no progress yet", () => {
  render(<ScanControl phase="queued" progress={0} />)

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

test("with Stop elsewhere, the running state is a busy button that shows the progress", () => {
  render(<ScanControl phase="running" progress={40} showStop={false} />)
  expect(screen.getByRole("button", { name: "Scanning 40%" })).toBeDisabled()
  expect(screen.queryByRole("button", { name: /stop/i })).toBeNull()
})

test("before any progress arrives, the busy button says Scanning…", () => {
  render(<ScanControl phase="running" progress={0} showStop={false} />)
  expect(screen.getByRole("button", { name: "Scanning…" })).toBeDisabled()
})

test("the header button names the branch it scans", () => {
  render(
    <ScanControl
      phase="idle"
      progress={0}
      branch="main"
      size="lg"
      onScan={() => {}}
    />,
  )
  expect(screen.getByRole("button", { name: "Scan main" })).toBeEnabled()
})

test("after the scan, the busy button says Scoring… while the score is calculated", () => {
  render(<ScanControl phase="running" progress={90} scoring showStop={false} />)
  expect(screen.getByRole("button", { name: /Scoring…/ })).toBeDisabled()
  expect(screen.getByRole("status")).toHaveTextContent(
    "Scan finished, calculating the health score",
  )
})

const LONG_BRANCH = "feature/a-very-long-branch-name-for-the-payments-refactor"

test("a long branch name stays the button's name and its tooltip, at a capped width", () => {
  render(
    <ScanControl phase="idle" progress={0} branch={LONG_BRANCH} size="lg" />,
  )
  const button = screen.getByRole("button", { name: `Scan ${LONG_BRANCH}` })
  expect(button).toHaveAttribute("title", `Scan ${LONG_BRANCH}`)
  expect(button).toHaveClass("max-w-64")
})

test("a branch name wider than the button is clipped and set up to slide", () => {
  // jsdom has no layout: give the name more width than its clip.
  const scrollWidth = vi
    .spyOn(HTMLElement.prototype, "scrollWidth", "get")
    .mockReturnValue(400)
  const clientWidth = vi
    .spyOn(HTMLElement.prototype, "clientWidth", "get")
    .mockReturnValue(150)
  try {
    render(
      <ScanControl phase="idle" progress={0} branch={LONG_BRANCH} size="lg" />,
    )
    const name = screen.getByText(LONG_BRANCH)
    expect(name.parentElement).toHaveAttribute("data-overflows", "true")
    expect(name.style.getPropertyValue("--branch-shift")).toBe("250px")
    // The slide runs only on hover or focus, and never under reduced motion.
    expect(name.className).toMatch(/motion-safe:group-hover\/button:animate-/)
  } finally {
    scrollWidth.mockRestore()
    clientWidth.mockRestore()
  }
})

test("a short branch name is neither clipped nor animated", () => {
  render(<ScanControl phase="idle" progress={0} branch="main" size="lg" />)
  const name = screen.getByText("main")
  expect(name.parentElement).not.toHaveAttribute("data-overflows")
  expect(name.className).not.toMatch(/animate-/)
})
