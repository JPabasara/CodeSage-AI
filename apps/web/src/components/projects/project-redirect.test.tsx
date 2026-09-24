import { render, screen, waitFor } from "@testing-library/react"
import { http, HttpResponse } from "msw"
import { beforeEach, expect, test, vi } from "vitest"

import { ProjectRedirect } from "./project-redirect"
import { TooltipProvider } from "@/components/ui/tooltip"
import { writeSelectedProjectId } from "@/hooks/use-selected-project"
import { SECOND_REPO_ID, WORKSPACE_ID, mockSession } from "@/lib/mocks/fixtures"
import { server } from "@/lib/mocks/server"

const nav = vi.hoisted(() => ({ replace: vi.fn() }))
vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ replace: nav.replace, push: vi.fn() }),
}))
vi.mock("@/hooks/use-session", () => ({
  useSession: () => ({ data: mockSession, loading: false }),
}))

beforeEach(() => {
  localStorage.clear()
  nav.replace.mockClear()
})

test("/dashboard opens the project this workspace was last on", async () => {
  writeSelectedProjectId(SECOND_REPO_ID, WORKSPACE_ID)
  render(<ProjectRedirect page="dashboard" />)
  await waitFor(() =>
    expect(nav.replace).toHaveBeenCalledWith(`/dashboard/${SECOND_REPO_ID}`),
  )
})

test("/dashboard/history keeps to Scan History", async () => {
  writeSelectedProjectId(SECOND_REPO_ID, WORKSPACE_ID)
  render(<ProjectRedirect page="history" />)
  await waitFor(() =>
    expect(nav.replace).toHaveBeenCalledWith(
      `/dashboard/${SECOND_REPO_ID}/history`,
    ),
  )
})

test("with no projects it explains instead of redirecting", async () => {
  server.use(http.get("*/api/projects", () => HttpResponse.json([])))
  render(
    <TooltipProvider>
      <ProjectRedirect page="dashboard" />
    </TooltipProvider>,
  )
  expect(
    await screen.findByRole("heading", { name: /see its dashboard/i }),
  ).toBeVisible()
  expect(nav.replace).not.toHaveBeenCalled()
})
