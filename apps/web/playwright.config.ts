import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://localhost:3000" ,
       launchOptions: { slowMo: 2000 } },
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    // Guarantees the E2E always has mock data — even on CI / a fresh clone where
    // .env.local (gitignored) is absent. Not applied if a dev server is already up.
    env: { NEXT_PUBLIC_API_MOCKING: "enabled" },
  },
})
