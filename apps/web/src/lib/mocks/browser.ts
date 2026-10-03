// Browser runner for the mock backend, used by the dev app and by Playwright.
import { setupWorker } from "msw/browser"
import { authHandlers, handlers } from "./handlers"

const mockAuth = process.env.NEXT_PUBLIC_API_MOCKING === "e2e"

export const worker = setupWorker(
  ...(mockAuth ? [...authHandlers, ...handlers] : handlers),
)
