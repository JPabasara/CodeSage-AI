import { test, expect } from "./session"

// Journey 1 — the happy path. Keep this one green forever: it's the smoke alarm
// for the whole demo (sign in → open a project → dashboard → open a finding).
test("sign in, open a project, view its dashboard, open a finding", async ({
  page,
}) => {
  // Sign-in itself leaves our app for Asgardeo (J2.6), so the most this journey
  // can assert is that the door points at the right place; the session cookie is
  // seeded by the fixture. See e2e/session.ts.
  await page.goto("/login")
  await expect(page.getByRole("link", { name: /^sign in$/i })).toHaveAttribute(
    "href",
    /\/api\/auth\/login$/,
  )
  await page.goto("/projects")

  // Projects render as cards with a "Select" button (not links); scope to the repo.
  await page
    .getByRole("listitem")
    .filter({ hasText: "acme-payments" })
    .getByRole("button", { name: /select/i })
    .click()

  await expect(page).toHaveURL(/\/dashboard\/demo-repo/)
  await expect(page.getByText("Code Health")).toBeVisible()

  // Open the critical finding. D-CR7: this used to slide a Sheet over the page;
  // it now swaps the health card for the detail, in place. Scope the assertion
  // to the panel — the reason text is ALSO in the list row (strict mode).
  await page.getByRole("row").filter({ hasText: "hardcoded" }).click()
  const detail = page.getByLabel("Finding detail", { exact: true })
  await expect(detail.getByText(/hardcoded stripe api key/i)).toBeVisible()

  // …the region was replaced, not covered, and the tree stayed usable
  await expect(page.getByText("Code Health")).toBeHidden()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expect(
    page.getByLabel("File health tree").locator('[aria-current="true"]'),
  ).toContainText("payment_service.ts")

  // the selection is in the URL, so a reload comes back to the same finding
  await expect(page).toHaveURL(/\?finding=f-secret-1/)
  await page.reload()
  await expect(page.getByLabel("Finding detail", { exact: true })).toBeVisible()

  // and closing restores the dashboard
  await page.getByRole("button", { name: /close finding detail/i }).click()
  await expect(page.getByText("Code Health")).toBeVisible()
})
