import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { http, HttpResponse } from "msw"
import { beforeEach, expect, test, vi } from "vitest"

import { ActivityMenu } from "./activity-menu"
import { healthKey } from "@/hooks/use-health-report"
import { startScan, useScanFor } from "@/hooks/use-scan-center"
import { readWorkspaceEpoch } from "@/hooks/use-workspace-scope"
import { writeCached } from "@/lib/query-cache"
import {
  DEMO_REPO_ID,
  mockHealthReport,
  SECOND_REPO_ID,
  WORKSPACE_ID,
} from "@/lib/mocks/fixtures"
import { server } from "@/lib/mocks/server"
import type { Activity } from "@/lib/types"

const nav = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: vi.fn() }),
  usePathname: () => "/projects",
}))

beforeEach(() => nav.push.mockClear())

const target = {
  workspaceId: WORKSPACE_ID,
  repoId: DEMO_REPO_ID,
  branch: "main",
  repoName: "acme-payments",
}

function serveActivity(activity: Activity) {
  server.use(http.get("*/api/activity", () => HttpResponse.json(activity)))
}

test("nothing running anywhere: no menu at all", async () => {
  serveActivity({ scans: [], rescoring: [] })
  const { container } = render(<ActivityMenu />)
  await act(async () => {})
  expect(container).toBeEmptyDOMElement()
})

test("a teammate's scan and a re-score show up for everyone", async () => {
  serveActivity({
    scans: [
      {
        repo_id: SECOND_REPO_ID,
        repo_name: "acme/billing",
        status: {
          scan_id: "theirs",
          phase: "running",
          progress: 60,
          stage: "finding_debt",
          branch: "develop",
        },
      },
    ],
    rescoring: [
      { repo_id: DEMO_REPO_ID, repo_name: "acme/payments", snapshots_left: 3 },
    ],
  })
  render(<ActivityMenu />)

  const trigger = await screen.findByTestId("activity-trigger")
  expect(trigger).toHaveTextContent("2 running")
  expect(trigger).toHaveAccessibleName("Activity: 2 running")

  await userEvent.click(trigger)
  const list = screen.getByRole("list", { name: "Running in this workspace" })
  const rows = within(list).getAllByRole("listitem")
  expect(rows).toHaveLength(2)
  expect(rows[0]).toHaveTextContent("acme/billing · develop")
  expect(rows[0]).toHaveTextContent("Finding debt · 54%")
  expect(
    within(rows[0]!).getByRole("link", {
      name: "Open acme/billing · develop",
    }),
  ).toHaveAttribute("href", `/dashboard/${SECOND_REPO_ID}?branch=develop`)
  expect(rows[1]).toHaveTextContent(
    "Re-scoring under the current profile · 3 scans left",
  )
})

test("one item: the collapsed menu names it", async () => {
  serveActivity({
    scans: [],
    rescoring: [
      { repo_id: DEMO_REPO_ID, repo_name: "acme/payments", snapshots_left: 1 },
    ],
  })
  render(<ActivityMenu />)
  expect(await screen.findByTestId("activity-trigger")).toHaveTextContent(
    "Re-scoring payments",
  )
})

test("this tab's scan shows once, with its live stage — not twice", async () => {
  render(<ActivityMenu />)
  await act(() => startScan(target))
  // The server lists the same scan; the menu still shows it once.
  const trigger = await screen.findByTestId("activity-trigger")
  await waitFor(() =>
    expect(trigger).toHaveTextContent("Scanning acme-payments"),
  )

  await userEvent.click(trigger)
  const rows = within(
    screen.getByRole("list", { name: "Running in this workspace" }),
  ).getAllByRole("listitem")
  expect(rows).toHaveLength(1)
  expect(rows[0]).toHaveTextContent("acme-payments · main")
})

test("a ready job offers View, which shows the new results and goes there", async () => {
  // Results were on screen before, so the job waits for a look at the end.
  writeCached(healthKey(readWorkspaceEpoch(), DEMO_REPO_ID, "main"), {
    ...mockHealthReport,
    snapshot_id: "before",
  })
  const { result } = renderHook(() => useScanFor(DEMO_REPO_ID, "main"))
  render(<ActivityMenu />)
  await act(() => startScan(target))

  const trigger = await screen.findByTestId("activity-trigger")
  await waitFor(() => expect(trigger).toHaveTextContent("Results ready"), {
    timeout: 15_000,
  })
  await userEvent.click(trigger)
  await userEvent.click(screen.getByRole("button", { name: "View" }))

  expect(nav.push).toHaveBeenCalledWith(
    `/dashboard/${DEMO_REPO_ID}?branch=main`,
  )
  expect(result.current.scan).toBeUndefined()
}, 20_000)
