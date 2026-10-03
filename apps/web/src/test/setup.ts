import "@testing-library/jest-dom/vitest"
import { afterAll, afterEach, beforeAll, beforeEach } from "vitest"
import { cleanup } from "@testing-library/react"
import { server } from "@/lib/mocks/server"
import { resetMockBackend } from "@/lib/mocks/handlers"
import { WORKSPACE_ID } from "@/lib/mocks/fixtures"
import { SELECTED_BRANCH_KEY } from "@/hooks/use-selected-branch"
import { resetScanCenter } from "@/hooks/use-scan-center"
import { resetActivity } from "@/hooks/use-activity"
import {
  noteActiveWorkspace,
  resetWorkspaceScope,
} from "@/hooks/use-workspace-scope"

beforeAll(() => server.listen({ onUnhandledRequest: "error" }))

// Which workspace a component test is standing in.
beforeEach(() => noteActiveWorkspace(WORKSPACE_ID))

afterEach(() => {
  server.resetHandlers() // drop any per-test http overrides
  resetMockBackend() // clear the in-memory scan state (resetHandlers can't see it)
  resetWorkspaceScope()
  localStorage.removeItem(SELECTED_BRANCH_KEY)
  // Scans are followed app-wide (module state); one test's scan is not the next's.
  resetScanCenter()
  resetActivity()
})
afterAll(() => server.close())

afterEach(cleanup)

// Recharts' <ResponsiveContainer> (used by shadcn Chart) needs ResizeObserver.
globalThis.ResizeObserver = class {
  observe() {
    /* no-op: jsdom has no layout, nothing to observe */
  }
  unobserve() {
    /* no-op */
  }
  disconnect() {
    /* no-op */
  }
}

// Radix primitives (Select, Dialog/Sheet) call these; jsdom doesn't implement them.
Element.prototype.scrollIntoView = () => {}
Element.prototype.hasPointerCapture = () => false
Element.prototype.setPointerCapture = () => {}
Element.prototype.releasePointerCapture = () => {}

if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList
}
