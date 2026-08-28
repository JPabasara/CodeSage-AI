// Browser runner for the mock backend, used by the dev app and by Playwright.
// `setupWorker` wires the handlers into the service worker so real fetch() calls
// are intercepted. Started from MswProvider only when mocking is on.
import { setupWorker } from "msw/browser"
import { authHandlers, handlers } from "./handlers"

// Two mocking modes, because dev and E2E want opposite things from auth:
//
//   "enabled"  data endpoints are mocked, but /api/auth/session passes through
//              to the real API — the only way to test a real sign-in locally.
//   "e2e"      auth is mocked too, because no headless browser completes an OIDC
//              consent screen. Playwright seeds the cookie and the mock honours it.
const mockAuth = process.env.NEXT_PUBLIC_API_MOCKING === "e2e"

export const worker = setupWorker(
  ...(mockAuth ? [...authHandlers, ...handlers] : handlers),
)
