import { defineConfig, devices } from "@playwright/test"

// Playwright runs against its OWN dev server, never the one you have open:
//
//  • its own PORT, so it cannot collide with `pnpm dev` on 3000
//  • its own NEXT_DIST_DIR, because Next refuses two dev servers that share a
//    build directory (see next.config.ts)
//  • NEXT_PUBLIC_API_MOCKING=e2e, which mocks the data endpoints AND
//    /api/auth/session — a headless browser cannot complete an Asgardeo consent
//    screen, so the session cookie is seeded by the fixture in e2e/session.ts
//
// The upshot: `pnpm test:e2e` behaves the same whether or not your dev server is
// running, and whatever your .env.local says. That was not true before, and the
// suite silently ran against a NON-mocked server and timed out.
const PORT = Number(process.env.E2E_PORT ?? 3101)

export default defineConfig({
  testDir: "./e2e",
  // A failing journey should be a real failure, not a flaky one, so retry once
  // locally and twice on CI before believing it.
  retries: process.env.CI ? 2 : 1,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    // A trace for the first retry only — enough to debug a failure, not so much
    // that a green run writes hundreds of megabytes.
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    // Watch a run in slow motion with E2E_SLOWMO=500. It used to be hardcoded at
    // 2000ms, which put every journey over the 30s timeout.
    launchOptions: { slowMo: Number(process.env.E2E_SLOWMO ?? 0) },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm exec next dev -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      NEXT_PUBLIC_API_MOCKING: "e2e",
      NEXT_DIST_DIR: ".next-e2e",
    },
  },
})
