import { DEMO_REPO_ID, test, expect } from "./session"

// ────────────────────────────────────────────────────────────────────────────
// The shell: the left rail, and J3.5's promise that nothing on screen points at
// a feature we cannot demonstrate.
// ────────────────────────────────────────────────────────────────────────────

test.beforeEach(async ({ page }) => {
  await page.goto("/projects")
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible()
})

test("the rail carries exactly the four v1 destinations", async ({ page }) => {
  const rail = page
    .getByRole("navigation")
    .or(page.locator('[data-slot="sidebar"]'))
  for (const label of ["Projects", "Dashboard", "Scan History", "Profiles"]) {
    await expect(page.getByRole("link", { name: label })).toBeVisible()
  }
  await expect(rail).toBeTruthy()
})

test("J3.5 — no Team entry and no v2 badge anywhere", async ({ page }) => {
  // An evaluator reads a nav item as a promise, and this one pointed at a page
  // whose entire content was "Coming in v2".
  await expect(page.getByRole("link", { name: "Team" })).toHaveCount(0)
  await expect(page.getByText("v2", { exact: true })).toHaveCount(0)
})

test("/team no longer exists as a route", async ({ page }) => {
  const response = await page.goto("/team")
  // Deleted, not merely unlinked — a bookmarked URL must not still render it.
  expect(response?.status()).toBe(404)
})

test("each rail link reaches its screen", async ({ page }) => {
  await page.getByRole("link", { name: "Profiles" }).click()
  await expect(page).toHaveURL(/\/profiles$/)
  await expect(page.getByRole("heading", { name: "Profiles" })).toBeVisible()

  await page.getByRole("link", { name: "Dashboard" }).click()
  await expect(page).toHaveURL(new RegExp(`/dashboard/${DEMO_REPO_ID}$`))
  await expect(page.getByText("Code Health")).toBeVisible()

  await page.getByRole("link", { name: "Scan History" }).click()
  await expect(page).toHaveURL(/\/history$/)

  await page.getByRole("link", { name: "Projects" }).click()
  await expect(page).toHaveURL(/\/projects$/)
})

test("the rail marks the screen you are actually on", async ({ page }) => {
  await expect(page.getByRole("link", { name: "Projects" })).toHaveAttribute(
    "data-active",
    "true",
  )

  await page.getByRole("link", { name: "Profiles" }).click()
  await expect(page.getByRole("link", { name: "Profiles" })).toHaveAttribute(
    "data-active",
    "true",
  )
  await expect(
    page.getByRole("link", { name: "Projects" }),
  ).not.toHaveAttribute("data-active", "true")
})
