import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, expect, test, vi } from "vitest"

import { CONNECT_LOCKED_REASON, NoProjectState } from "./no-project-state"
import { TooltipProvider } from "@/components/ui/tooltip"
import { mockSession, mockSessionViewer } from "@/lib/mocks/fixtures"
import type { Session } from "@/lib/types"

const session = vi.hoisted(() => ({ current: null as Session | null }))
vi.mock("@/hooks/use-session", () => ({
  useSession: () => ({ data: session.current, loading: false }),
}))

beforeEach(() => {
  session.current = mockSession
})

const renderState = (page: "dashboard" | "history" | "override") =>
  render(
    <TooltipProvider>
      <NoProjectState page={page} />
    </TooltipProvider>,
  )

test.each([
  ["dashboard", /see its dashboard/i],
  ["history", /see its scan history/i],
  ["override", /its own profile/i],
] as const)("%s says what will be here", (page, heading) => {
  renderState(page)
  expect(screen.getByRole("heading", { name: heading })).toBeVisible()
})

test("a role that can connect gets the way there", () => {
  renderState("dashboard")
  expect(
    screen.getByRole("link", { name: /connect repository/i }),
  ).toHaveAttribute("href", "/projects")
})

test("a role that cannot sees it disabled, with the reason on focus", async () => {
  session.current = mockSessionViewer
  renderState("dashboard")

  expect(
    screen.getByRole("button", { name: /connect repository/i }),
  ).toBeDisabled()
  await userEvent.tab()
  expect(await screen.findByRole("tooltip")).toHaveTextContent(
    CONNECT_LOCKED_REASON,
  )
})
