// Node runner for the mock backend, used by component tests.
import { setupServer } from "msw/node"
import { handlers } from "./handlers"

export const server = setupServer(...handlers)
