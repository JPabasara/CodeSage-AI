import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, expect, test, vi } from "vitest"

import { DashboardView } from "@/components/dashboard/dashboard-view"
import { mockFindings } from "@/lib/mocks/fixtures"

// D-CR7 moved the selection into the URL, so a container test needs a router
// that actually re-renders on navigate. This is a miniature one: a query string
// in a module-level store, and useSearchParams subscribed to it.
const nav = vi.hoisted(() => {
  let params = new URLSearchParams()
  const listeners = new Set<() => void>()
  return {
    read: () => params,
    subscribe: (fn: () => void) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    navigate: (url: string) => {
      params = new URLSearchParams(url.split("?")[1] ?? "")
      listeners.forEach((fn) => fn())
    },
    reset: () => {
      params = new URLSearchParams()
    },
  }
})

vi.mock("next/navigation", async () => {
  const { useSyncExternalStore } = await import("react")
  return {
    usePathname: () => "/dashboard/demo-repo",
    useSearchParams: () => useSyncExternalStore(nav.subscribe, nav.read, nav.read),
    useRouter: () => ({ push: nav.navigate, replace: nav.navigate }),
  }
})

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))

const CRITICAL = mockFindings[0] // the hardcoded Stripe key in payment_service.ts

beforeEach(() => nav.reset())

/** Wait for the (mock) health report to land. */
async function ready() {
  expect(await screen.findByText("Code Health")).toBeInTheDocument()
}

test("selecting a finding swaps the health card for the detail, in place", async () => {
  render(<DashboardView repoId="demo-repo" />)
  await ready()

  // by reason, not symbol: two fixtures share the symbol "charge()"
  await userEvent.click(screen.getByRole("row", { name: /hardcoded stripe api key/i }))

  const detail = await screen.findByLabelText("Finding detail")
  expect(within(detail).getByText(CRITICAL.reason)).toBeInTheDocument()
  // the region was replaced, not covered
  expect(screen.queryByText("Code Health")).not.toBeInTheDocument()
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  // …and the list is still there, so the next finding is one click away
  expect(screen.getByRole("heading", { name: /refactor first/i })).toBeInTheDocument()
})

test("detail mode is driven by ?finding=, so a refresh restores it", async () => {
  nav.navigate(`/dashboard/demo-repo?finding=${CRITICAL.fingerprint}`)
  render(<DashboardView repoId="demo-repo" />)

  expect(await screen.findByLabelText("Finding detail")).toBeInTheDocument()
  expect(screen.queryByText("Code Health")).not.toBeInTheDocument()
})

test("the tree highlights the selected finding's file", async () => {
  nav.navigate(`/dashboard/demo-repo?finding=${CRITICAL.fingerprint}`)
  render(<DashboardView repoId="demo-repo" />)
  await screen.findByLabelText("Finding detail")

  const tree = screen.getByLabelText("File health tree")
  const highlighted = within(tree).getByRole("button", { current: true })
  expect(highlighted).toHaveTextContent("payment_service.ts")
})

test("closing restores the health card and the trend chart", async () => {
  nav.navigate(`/dashboard/demo-repo?finding=${CRITICAL.fingerprint}`)
  render(<DashboardView repoId="demo-repo" />)
  await screen.findByLabelText("Finding detail")

  await userEvent.click(screen.getByRole("button", { name: /close finding detail/i }))

  await waitFor(() => expect(screen.getByText("Code Health")).toBeInTheDocument())
  expect(screen.queryByLabelText("Finding detail")).not.toBeInTheDocument()
})

test("clicking a file in the tree opens that file's finding", async () => {
  render(<DashboardView repoId="demo-repo" />)
  await ready()

  const tree = screen.getByLabelText("File health tree")
  await userEvent.click(within(tree).getByRole("button", { name: /order_controller\.ts/i }))

  const detail = await screen.findByLabelText("Finding detail")
  expect(within(detail).getByText(/order_controller\.ts:\d+/)).toBeInTheDocument()
})
