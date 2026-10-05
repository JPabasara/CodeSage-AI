import AxeBuilder from "@axe-core/playwright"
import type { Page } from "@playwright/test"
import { test as signedOut } from "@playwright/test"

import {
  DEMO_REPO_ID,
  UNSCANNED_REPO_ID,
  expect,
  test as signedIn,
} from "./session"

// Rules that belong to other open issues, each named with its owner.
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
  // Next streams the route's <title> in after the body.
  await expect(page).toHaveTitle(/\S/)
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

/** Dark through the rail's Theme menu, and proven: a no-op would test light twice. */
async function setDarkMode(page: Page) {
  await page.getByRole("button", { name: "Theme", exact: true }).click()
  await page.getByRole("menuitemradio", { name: "Dark" }).click()
  await expect(page.locator("html")).toHaveClass(/dark/)
  // The open menu hides the page from screen readers; check only once it is back.
  await expect(page.getByRole("menu")).toHaveCount(0)
  await expect(page.locator("[data-aria-hidden]")).toHaveCount(0)
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
  // Newcomers start in light, so dark has to be a saved choice (next-themes' key).
  await page.addInitScript(() => localStorage.setItem("theme", "dark"))
  await page.goto("/login")
  await expect(page.locator("html")).toHaveClass(/dark/)
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

    await page
      .getByRole("tablist", { name: "Dashboard view" })
      .getByRole("tab", { name: /^Findings/ })
      .click()
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
  "0 axe violations on /overview in light and dark mode",
  async ({ page }) => {
    await page.goto("/overview")
    await expect(page.getByRole("table")).toBeVisible()
    await checkAxe(page, "/overview (light)")

    await setDarkMode(page)
    await checkAxe(page, "/overview (dark)")
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

for (const theme of ["light", "dark"] as const) {
  signedIn(
    `0 axe violations on the scan panel in ${theme} mode`,
    async ({ page }) => {
      await page.goto(`/dashboard/${DEMO_REPO_ID}`)
      await expect(page.getByText("Code Health")).toBeVisible()
      if (theme === "dark") await setDarkMode(page)
      await page.getByRole("button", { name: "Scan main", exact: true }).click()
      await expect(page.getByTestId("scan-progress-panel")).toBeVisible()
      await checkAxe(page, `the scan panel (${theme})`)
    },
  )
}

// The screens Phases 3–6 added, each in both themes.
const NEW_SCREENS: {
  name: string
  open: (page: Page) => Promise<void>
}[] = [
  {
    name: "the code map",
    open: async (page) => {
      await page.goto(`/dashboard/${DEMO_REPO_ID}?view=code`)
      await expect(page.getByLabel("File health tree")).toBeVisible()
    },
  },
  {
    name: "the first-scan card",
    open: async (page) => {
      await page.goto(`/dashboard/${UNSCANNED_REPO_ID}`)
      await expect(page.getByTestId("first-scan-card")).toBeVisible()
    },
  },
  {
    name: "the Java-only connect dialog",
    open: async (page) => {
      await page.goto("/projects")
      await page
        .getByLabel("Repository URL")
        .fill("https://github.com/octocat/hello-world")
      await page.getByRole("button", { name: "Connect repository" }).click()
      await expect(page.getByRole("alertdialog")).toBeVisible()
    },
  },
  {
    name: "Team & settings",
    open: async (page) => {
      await page.goto("/workspace")
      await expect(page.locator("#main-content h1")).toBeVisible()
    },
  },
  {
    name: "a help article",
    open: async (page) => {
      await page.goto("/help/what-is-analysed")
      await expect(page.locator("#main-content h1")).toBeVisible()
    },
  },
]

for (const screen of NEW_SCREENS) {
  signedIn(
    `0 axe violations on ${screen.name} in light and dark mode`,
    async ({ page }) => {
      await screen.open(page)
      await checkAxe(page, `${screen.name} (light)`)

      // The dialog would cover the Theme menu: switch first, then open it again.
      await page.keyboard.press("Escape")
      await setDarkMode(page)
      await screen.open(page)
      await checkAxe(page, `${screen.name} (dark)`)
    },
  )
}
