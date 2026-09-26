import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, expect, test, vi } from "vitest"

import { formatElapsed, ScanStatusStrip } from "./scan-status-strip"
import type { TrackedScan } from "@/hooks/use-scan-center"
import { DEMO_REPO_ID, WORKSPACE_ID } from "@/lib/mocks/fixtures"

const nav = vi.hoisted(() => ({ pathname: "/projects" }))
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))

beforeEach(() => {
  nav.pathname = "/projects"
})

const scan = (patch: Partial<TrackedScan> = {}): TrackedScan => ({
  key: "k",
  workspaceId: WORKSPACE_ID,
  repoId: DEMO_REPO_ID,
  branch: "develop",
  repoName: "acme-payments",
  status: { scan_id: "s1", phase: "running", progress: 40, branch: "develop" },
  job: "scanning",
  stopping: false,
  startedAt: Date.now() - 72_000,
  ...patch,
})

test.each([
  [0, "0s"],
  [4_000, "4s"],
  [72_000, "1m 12s"],
])("elapsed %i ms reads %s", (ms, text) => {
  expect(formatElapsed(ms)).toBe(text)
})

test("says what and where; the number and the clock live in the panel", () => {
  render(<ScanStatusStrip scan={scan()} canStop onStop={() => {}} />)
  const strip = screen.getByTestId("scan-status-strip")
  expect(strip).toHaveTextContent("Scanning acme-payments on develop")
  // 13H.4: the percentage and elapsed time are in the middle of the page,
  // so the strip does not repeat them — only its thin line shows progress.
  expect(strip).not.toHaveTextContent("%")
  expect(strip).not.toHaveTextContent("1m 12s")
})

test("queued says it is waiting, with no made-up percentage", () => {
  render(
    <ScanStatusStrip
      scan={scan({ status: { scan_id: "", phase: "queued", progress: 0 } })}
      canStop
      onStop={() => {}}
    />,
  )
  const strip = screen.getByTestId("scan-status-strip")
  expect(strip).toHaveTextContent(
    /Queued · acme-payments on develop · waiting for a worker/,
  )
  expect(strip).not.toHaveTextContent("%")
  // No id yet, so nothing to stop.
  expect(screen.getByRole("button", { name: "Stop" })).toBeDisabled()
})

test("Stop asks, then reads Stopping… until the scan ends", async () => {
  const onStop = vi.fn()
  const { rerender } = render(
    <ScanStatusStrip scan={scan()} canStop onStop={onStop} />,
  )
  await userEvent.click(screen.getByRole("button", { name: "Stop" }))
  expect(onStop).toHaveBeenCalledOnce()

  rerender(
    <ScanStatusStrip scan={scan({ stopping: true })} canStop onStop={onStop} />,
  )
  expect(screen.getByRole("button", { name: "Stopping…" })).toBeDisabled()
})

test("a role that cannot stop scans sees progress without Stop", () => {
  render(<ScanStatusStrip scan={scan()} canStop={false} onStop={() => {}} />)
  expect(screen.queryByRole("button", { name: /stop/i })).toBeNull()
})

test("nothing running, no strip", () => {
  render(<ScanStatusStrip scan={undefined} canStop onStop={() => {}} />)
  expect(screen.queryByTestId("scan-status-strip")).toBeNull()
})

test("once the scan is done and its score is being calculated, the strip steps aside", () => {
  // Nothing left to stop: the panel carries the score's wait.
  render(
    <ScanStatusStrip
      scan={scan({
        job: "scoring",
        status: { scan_id: "s1", phase: "done", progress: 100 },
      })}
      canStop
      onStop={() => {}}
    />,
  )
  expect(screen.queryByTestId("scan-status-strip")).not.toBeInTheDocument()
})
