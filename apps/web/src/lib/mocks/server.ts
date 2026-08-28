// Node runner for the mock backend, used by component tests. `setupServer`
// intercepts fetch() at the Node level — no service worker, no browser. The test
// setup file listens, resets and closes around it.
import { setupServer } from "msw/node"
import { handlers } from "./handlers"

export const server = setupServer(...handlers)
