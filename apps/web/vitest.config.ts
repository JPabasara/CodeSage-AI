import { defineConfig, configDefaults } from "vitest/config"
import react from "@vitejs/plugin-react"
import { fileURLToPath } from "node:url"

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    // Playwright specs (e2e/*.spec.ts) run via `pnpm test:e2e`, never Vitest —
    // they import from @playwright/test, which throws under the Vitest runner.
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
})
