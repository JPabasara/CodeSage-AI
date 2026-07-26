import { test, expect } from "@playwright/test"

// Journey 1 — the happy path. Keep this one green forever: it's the smoke alarm
// for the whole demo (sign in → open a project → dashboard → open a finding).
test("sign in, open a project, view its dashboard, open a finding", async ({
  page,
}) => {
  await page.goto("/login")
  await page.getByRole("button", { name: /sign in with github/i }).click()

  // Projects render as cards with a "Select" button (not links); scope to the repo.
  await page
    .getByRole("listitem")
    .filter({ hasText: "acme-payments" })
    .getByRole("button", { name: /select/i })
    .click()

  await expect(page).toHaveURL(/\/dashboard\/demo-repo/)
  await expect(page.getByText("Code Health")).toBeVisible()

  // Open the critical finding. Scope the assertion to the panel — the reason text
  // is ALSO in the list row, so an unscoped getByText matches 2 nodes (strict mode).
  await page.getByRole("row").filter({ hasText: "hardcoded" }).click()
  await expect(
    page.getByRole("dialog").getByText(/hardcoded stripe api key/i),
  ).toBeVisible()
})
