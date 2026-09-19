import AxeBuilder from "@axe-core/playwright"
import { test as signedOut } from "@playwright/test"

import { DEMO_REPO_ID, expect, test as signedIn } from "./session"

// ── U-7: WCAG 2.1 AA accessibility audit (#114) ──────────────────────────────
//
// Verifies 0 axe violations on login, projects, dashboard, finding detail,
// scan history, and profiles — in both light and dark themes.
//
// Rules owned by Issue #140 (landmarks / document structure) remain scoped to
// that issue so work not yet started does not fail this test.
const LANDMARK_RULES = [
  "region", // #140 — landmarks
  "landmark-one-main", // #140 — landmarks
  "page-has-heading-one", // #140 — document structure
]

async function checkAxe(page: import("@playwright/test").Page, contextName: string) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .disableRules(LANDMARK_RULES)
    .analyze()

  if (violations.length > 0) {
    const summary = violations.map(
      (v) => `${v.id} (${v.impact}): ${v.help} [${v.nodes.length} occurrences]`,
    )
    console.error(`Axe violations in ${contextName}:`, summary)
  }

  expect(violations, `Axe violations found in ${contextName}`).toEqual([])
}

async function setDarkMode(page: import("@playwright/test").Page) {
  const toggle = page.getByRole("button", { name: /switch to dark mode/i })
  if (await toggle.isVisible()) {
    await toggle.click()
    await expect(page.locator("html")).toHaveClass(/dark/)
  }
}

// ── 1. Login page (signed out) ───────────────────────────────────────────────

signedOut("0 axe violations on /login in light mode", async ({ page }) => {
  await page.goto("/login")
  await expect(page.getByRole("heading", { name: "Code Sage AI" })).toBeVisible()
  await checkAxe(page, "/login (light)")
})

signedOut("0 axe violations on /login in dark mode", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" })
  await page.goto("/login")
  await expect(page.getByRole("heading", { name: "Code Sage AI" })).toBeVisible()
  await checkAxe(page, "/login (dark)")
})

// ── 2. Projects route ────────────────────────────────────────────────────────

signedIn("0 axe violations on /projects in light and dark mode", async ({ page }) => {
  await page.goto("/projects")
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible()
  await checkAxe(page, "/projects (light)")

  await setDarkMode(page)
  await checkAxe(page, "/projects (dark)")
})

// ── 3. Dashboard route ───────────────────────────────────────────────────────

signedIn("0 axe violations on /dashboard in light and dark mode", async ({ page }) => {
  await page.goto(`/dashboard/${DEMO_REPO_ID}`)
  await expect(page.getByText("Code Health")).toBeVisible()
  await checkAxe(page, "/dashboard (light)")

  await setDarkMode(page)
  await checkAxe(page, "/dashboard (dark)")
})

// ── 4. Finding detail panel ──────────────────────────────────────────────────

signedIn("0 axe violations on finding detail panel in light and dark mode", async ({ page }) => {
  await page.goto(`/dashboard/${DEMO_REPO_ID}`)
  await expect(page.getByText("Code Health")).toBeVisible()

  // Open finding detail panel
  await page.getByRole("row").filter({ hasText: "hardcoded" }).click()
  const detail = page.getByLabel("Finding detail", { exact: true })
  await expect(detail).toBeVisible()

  await checkAxe(page, "finding detail (light)")

  await setDarkMode(page)
  await checkAxe(page, "finding detail (dark)")
})

// ── 5. Scan history route ───────────────────────────────────────────────────

signedIn("0 axe violations on /history in light and dark mode", async ({ page }) => {
  await page.goto(`/dashboard/${DEMO_REPO_ID}/history`)
  await expect(page.getByRole("heading", { name: "Scan History" })).toBeVisible()
  await checkAxe(page, "/history (light)")

  await setDarkMode(page)
  await checkAxe(page, "/history (dark)")
})

// ── 6. Profiles route ────────────────────────────────────────────────────────

signedIn("0 axe violations on /profiles in light and dark mode", async ({ page }) => {
  await page.goto("/profiles")
  await expect(page.getByRole("heading", { name: "Profiles" })).toBeVisible()
  await checkAxe(page, "/profiles (light)")

  await setDarkMode(page)
  await checkAxe(page, "/profiles (dark)")
})
