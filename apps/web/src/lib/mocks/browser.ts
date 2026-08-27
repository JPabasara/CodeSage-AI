// Browser runner for the mock backend (used by the dev app and by Playwright).
// `setupWorker` wires the handlers into the service worker
// (public/mockServiceWorker.js) so real fetch() calls in the browser are
// intercepted. Started from MswProvider only when NEXT_PUBLIC_API_MOCKING is on.
import { setupWorker } from "msw/browser"
import { authHandlers, handlers } from "./handlers"

// Two mocking modes, because dev and E2E want opposite things from auth:
//
//   "enabled"  every data endpoint is mocked, but /api/auth/session is passed
//              THROUGH to the real API — the only way to test a real Asgardeo
//              sign-in locally without a deployed frontend.
//   "e2e"      auth is mocked too, because no headless browser is going to
//              complete an interactive OIDC consent screen. The session cookie
//              is seeded by the Playwright fixture and the mock honours it.
const mockAuth = process.env.NEXT_PUBLIC_API_MOCKING === "e2e"

export const worker = setupWorker(
  ...(mockAuth ? [...authHandlers, ...handlers] : handlers),
)
