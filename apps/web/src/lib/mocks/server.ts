// Node runner for the mock backend (used by component tests, Phase 8.6).
// `setupServer` intercepts fetch() at the Node level — no service worker, no
// browser. The test setup file will listen()/resetHandlers()/close() around it.
import { setupServer } from "msw/node"
import { handlers } from "./handlers"

export const server = setupServer(...handlers)
