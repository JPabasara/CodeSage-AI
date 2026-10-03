import { DEMO_REPO_ID, test, expect } from "./session"

async function pickBranch(page: import("@playwright/test").Page, name: string) {
  await page.getByRole("combobox", { name: /branch/i }).click()
  await page.getByRole("option", { name, exact: true }).click()
}

test.beforeEach(async ({ page }) => {
  await page.goto(`/dashboard/${DEMO_REPO_ID}`)
  await expect(page.getByText("Code Health")).toBeVisible()
})

test("switching branch re-scopes the health score", async ({ page }) => {
  await expect(page.getByText("72/100")).toBeVisible() // main, under Balanced

  await pickBranch(page, "develop")

  // Derived from the same findings under a heavier branch, not a second fixture.
  await expect(page.getByText("66/100")).toBeVisible()
  await expect(page.getByText("72/100")).toHaveCount(0)
})

test("the branch defaults to the repository's default branch", async ({
  page,
}) => {
  // `main` is the only branch with `is_default: true`; nothing was picked yet.
  await expect(page.getByRole("combobox", { name: /branch/i })).toContainText(
    "main",
  )
})

test("a branch with no head commit renders without printing null", async ({
  page,
}) => {
  await pickBranch(page, "release/2026.08")

  await expect(page.getByText("Code Health")).toBeVisible()
  await expect(page.getByText(/null/i)).toHaveCount(0)
  await expect(page.getByText(/NaN/)).toHaveCount(0)
})

test("switching back to main restores the original numbers", async ({
  page,
}) => {
  await pickBranch(page, "develop")
  await expect(page.getByText("66/100")).toBeVisible()

  await pickBranch(page, "main")
  await expect(page.getByText("72/100")).toBeVisible()
})
