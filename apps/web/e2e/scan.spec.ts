import { test, expect } from "@playwright/test"

// Journey 2 — the headline interaction from Phase 9. No route guard in v1, so we
// can go straight to the dashboard, independent of the login flow.
test("run and stop a scan", async ({ page }) => {
  await page.goto("/dashboard/demo-repo")
  await expect(page.getByText("Code Health")).toBeVisible()

  // idle → running: the button becomes a live "Scanning… NN%" label.
  await page.getByRole("button", { name: /^scan$/i }).click()
  await expect(page.getByText(/scanning/i)).toBeVisible()

  // Stop returns to idle before the ~4s auto-finish (Playwright acts in ms).
  await page.getByRole("button", { name: /stop/i }).click()
  await expect(page.getByRole("button", { name: /^scan$/i })).toBeVisible()
})
