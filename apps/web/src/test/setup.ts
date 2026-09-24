import "@testing-library/jest-dom/vitest"
import { afterAll, afterEach, beforeAll, beforeEach } from "vitest"
import { cleanup } from "@testing-library/react"
import { server } from "@/lib/mocks/server"
import { resetMockBackend } from "@/lib/mocks/handlers"
import { WORKSPACE_ID } from "@/lib/mocks/fixtures"
import { SELECTED_BRANCH_KEY } from "@/hooks/use-selected-branch"
import {
  noteActiveWorkspace,
  resetWorkspaceScope,
} from "@/hooks/use-workspace-scope"

// ── the mock backend (same handlers as the dev app) ─────────────────────────
// Component tests fetch through MSW's Node interceptor, so a test exercises the
// exact API the browser does. `onUnhandledRequest: "error"` fails a test that
// hits an endpoint we forgot to mock, instead of letting it escape to the real
// network and hang.
beforeAll(() => server.listen({ onUnhandledRequest: "error" }))

// Which workspace a component test is standing in.
//
// The app learns this from the session, and most component tests mock the
// session hook away — so without this the workspace is simply unknown, and
// anything keyed by it (the selected project, every query key) has nothing to
// key by. Seeding it to the same workspace the mock backend serves is what the
// real app sees a moment after sign-in.
beforeEach(() => noteActiveWorkspace(WORKSPACE_ID))

afterEach(() => {
  server.resetHandlers() // drop any per-test http overrides
  resetMockBackend() // clear the in-memory scan state (resetHandlers can't see it)
  resetWorkspaceScope()
  // A branch remembered by one test must not choose the next test's branch.
  localStorage.removeItem(SELECTED_BRANCH_KEY)
})
afterAll(() => server.close())

// unmount React trees between tests so queries never see a previous render
afterEach(cleanup)

// ── jsdom polyfills ─────────────────────────────────────────────────────────
// jsdom is missing a few browser APIs that our UI libraries rely on. Without
// these, component tests crash before they can assert anything.

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

// matchMedia (used by the mobile hook and some components).
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
