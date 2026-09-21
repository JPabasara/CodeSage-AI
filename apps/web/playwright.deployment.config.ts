import { defineConfig, devices } from "@playwright/test"

// This configuration deliberately has no `webServer`: it exercises an
// already-deployed environment, unlike the mocked local E2E suite.
// Both URLs are required so a workflow cannot accidentally test localhost.
const webUrl = process.env.DEPLOY_WEB_URL
const apiUrl = process.env.DEPLOY_API_URL

if (!webUrl || !apiUrl) {
  throw new Error(
    "DEPLOY_WEB_URL and DEPLOY_API_URL are required for deployment smoke tests.",
  )
}

export default defineConfig({
  testDir: "./e2e",
  testMatch: "deployment-smoke.spec.ts",
  timeout: 45_000,
  retries: process.env.CI ? 2 : 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  use: {
    baseURL: webUrl,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
})
