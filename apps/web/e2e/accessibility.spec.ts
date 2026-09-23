import AxeBuilder from "@axe-core/playwright"
import type { Page } from "@playwright/test"
import { test as signedOut } from "@playwright/test"

import { DEMO_REPO_ID, expect, test as signedIn } from "./session"

// Rules that belong to other open issues, each named with its owner. A suite
// that is red for a known reason stops being read at all. `keyboard.spec.ts`
// keeps the same list, for the same reason.
//
// `landmark-one-main` is deliberately absent: #140 fixed the duplicate <main>,
// so the rule now passes and stays on.
const OWNED_BY_OTHER_ISSUES = [
  "color-contrast", // #114 - contrast and colour-only meaning
  "region", // the rail header and footer still sit outside any landmark
  "page-has-heading-one", // document structure
]

const findingCards = (page: Page) =>
  page
    .getByRole("list", { name: /ranked refactor findings/i })
    .getByRole("button")

async function checkAxe(page: Page, contextName: string) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .disableRules(OWNED_BY_OTHER_ISSUES)
    .analyze()

  if (violations.length > 0) {
    const summary = violations.map(
      (violation) =>
        `${violation.id} (${violation.impact}): ${violation.help} [${violation.nodes.length} occurrences]`,
    )
    console.error(`Axe violations in ${contextName}:`, summary)
  }

  expect(violations, `Axe violations found in ${contextName}`).toEqual([])
}

async function setDarkMode(page: Page) {
  const toggle = page.getByRole("button", { name: /switch to dark mode/i })
  if (await toggle.isVisible()) {
    await toggle.click()
    await expect(page.locator("html")).toHaveClass(/dark/)
  }
}

signedOut("0 axe violations on /login in light mode", async ({ page }) => {
  await page.goto("/login")
  await expect(
    page.getByRole("heading", {
      name: /sign in to the codesage ai workspace/i,
    }),
  ).toBeVisible()
  await checkAxe(page, "/login (light)")
})

signedOut("0 axe violations on /login in dark mode", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" })
  await page.goto("/login")
  await expect(
    page.getByRole("heading", {
      name: /sign in to the codesage ai workspace/i,
    }),
  ).toBeVisible()
  await checkAxe(page, "/login (dark)")
})

signedIn(
  "0 axe violations on /projects in light and dark mode",
  async ({ page }) => {
    await page.goto("/projects")
    await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible()
    await checkAxe(page, "/projects (light)")

    await setDarkMode(page)
    await checkAxe(page, "/projects (dark)")
  },
)

signedIn(
  "0 axe violations on /dashboard in light and dark mode",
  async ({ page }) => {
    await page.goto(`/dashboard/${DEMO_REPO_ID}`)
    await expect(page.getByText("Code Health")).toBeVisible()
    await checkAxe(page, "/dashboard (light)")

    await setDarkMode(page)
    await checkAxe(page, "/dashboard (dark)")
  },
)

signedIn(
  "0 axe violations on finding detail in light and dark mode",
  async ({ page }) => {
    await page.goto(`/dashboard/${DEMO_REPO_ID}`)
    await expect(page.getByText("Code Health")).toBeVisible()

    await findingCards(page)
      .filter({ hasText: /hardcoded/i })
      .first()
      .click()
    const detail = page.getByLabel("Finding detail", { exact: true })
    await expect(detail).toBeVisible()

    await checkAxe(page, "finding detail (light)")

    await setDarkMode(page)
    await checkAxe(page, "finding detail (dark)")
  },
)

signedIn(
  "0 axe violations on /history in light and dark mode",
  async ({ page }) => {
    await page.goto(`/dashboard/${DEMO_REPO_ID}/history`)
    await expect(
      page.getByRole("heading", { name: "Scan History" }),
    ).toBeVisible()
    await checkAxe(page, "/history (light)")

    await setDarkMode(page)
    await checkAxe(page, "/history (dark)")
  },
)

signedIn(
  "0 axe violations on /profiles in light and dark mode",
  async ({ page }) => {
    await page.goto("/profiles")
    await expect(page.getByRole("heading", { name: "Profiles" })).toBeVisible()
    await checkAxe(page, "/profiles (light)")

    await setDarkMode(page)
    await checkAxe(page, "/profiles (dark)")
  },
)

// `SidebarInset` used to render a second <main>, which is why
// `landmark-one-main` sits in LANDMARK_RULES above. That rule is best-practice,
// so the wcag tags never ran it - this asserts the shape directly instead.
signedIn(
  "every app page has exactly one main landmark (#140)",
  async ({ page }) => {
    for (const path of [
      "/projects",
      `/dashboard/${DEMO_REPO_ID}`,
      "/profiles",
    ]) {
      await page.goto(path)
      await expect(page.getByRole("main")).toHaveCount(1)
      await expect(page.locator("#main-content")).toHaveCount(1)
    }
  },
)
