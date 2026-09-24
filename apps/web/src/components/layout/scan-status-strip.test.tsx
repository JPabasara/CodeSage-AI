import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, expect, test, vi } from "vitest"

import { formatElapsed, ScanPill, ScanStatusStrip } from "./scan-status-strip"
import type { TrackedScan } from "@/hooks/use-scan-center"
import { startScan } from "@/hooks/use-scan-center"
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

test("says what, where, how far and how long", () => {
  render(<ScanStatusStrip scan={scan()} canStop onStop={() => {}} />)
  const strip = screen.getByTestId("scan-status-strip")
  expect(strip).toHaveTextContent("Scanning acme-payments on develop")
  expect(strip).toHaveTextContent("40% · 1m 12s")
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

test("on another page, the app bar pill leads back to the running scan", async () => {
  render(<ScanPill />)
  expect(screen.queryByTestId("scan-pill")).toBeNull()

  await startScan({
    workspaceId: WORKSPACE_ID,
    repoId: DEMO_REPO_ID,
    branch: "main",
    repoName: "acme-payments",
  })

  const pill = await screen.findByTestId("scan-pill")
  expect(pill).toHaveTextContent("Scanning acme-payments")
  expect(pill).toHaveAttribute("href", `/dashboard/${DEMO_REPO_ID}?branch=main`)
})

test("the pill hides on the dashboard that already shows the strip", async () => {
  nav.pathname = `/dashboard/${DEMO_REPO_ID}`
  render(<ScanPill />)
  await startScan({
    workspaceId: WORKSPACE_ID,
    repoId: DEMO_REPO_ID,
    branch: "main",
  })
  expect(screen.queryByTestId("scan-pill")).toBeNull()
})
