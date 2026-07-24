import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// unmount React trees between tests so queries never see a previous render
afterEach(cleanup);

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
};

// Radix primitives (Select, Dialog/Sheet) call these; jsdom doesn't implement them.
Element.prototype.scrollIntoView = () => {};
Element.prototype.hasPointerCapture = () => false;
Element.prototype.setPointerCapture = () => {};
Element.prototype.releasePointerCapture = () => {};

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
    }) as MediaQueryList;
}
