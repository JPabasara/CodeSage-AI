import "@testing-library/jest-dom/vitest"
import { afterAll, afterEach, beforeAll } from "vitest"
import { cleanup } from "@testing-library/react"
import { server } from "@/lib/mocks/server"
import { resetMockBackend } from "@/lib/mocks/handlers"

// ── the mock backend (same handlers as the dev app) ─────────────────────────
// Component tests fetch through MSW's Node interceptor, so a test exercises the
// exact API the browser does. `onUnhandledRequest: "error"` fails a test that
// hits an endpoint we forgot to mock, instead of letting it escape to the real
// network and hang.
beforeAll(() => server.listen({ onUnhandledRequest: "error" }))
afterEach(() => {
  server.resetHandlers() // drop any per-test http overrides
  resetMockBackend() // clear the in-memory scan state (resetHandlers can't see it)
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
