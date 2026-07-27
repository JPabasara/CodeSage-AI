import { test, expect } from "@playwright/test"

// Journey 3 — proves the branch re-scoping wire (Phase 9.5) in a real browser.
test("switching branch re-scopes the health score", async ({ page }) => {
  await page.goto("/dashboard/demo-repo")
  await expect(page.getByText("72/100")).toBeVisible() // main

  await page.getByRole("combobox", { name: /branch/i }).click()
  await page.getByRole("option", { name: "develop" }).click()

  await expect(page.getByText("66/100")).toBeVisible() // develop = main − 6
})
