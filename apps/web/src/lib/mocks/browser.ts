// Browser runner for the mock backend (used by the dev app, Phase 8.3).
// `setupWorker` wires the handlers into the service worker
// (public/mockServiceWorker.js) so real fetch() calls in the browser are
// intercepted. Started from MswProvider only when NEXT_PUBLIC_API_MOCKING is on.
import { setupWorker } from "msw/browser"
import { handlers } from "./handlers"

export const worker = setupWorker(...handlers)
