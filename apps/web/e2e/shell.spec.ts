import { DEMO_REPO_ID, expect, test } from "./session"

// The app shell (Phase 13C): one deep-mint app bar on every signed-in page, the
// rail below it, and the page's own controls in the bar where they belong.

const topBar = (page: import("@playwright/test").Page) =>
  page.getByTestId("app-top-bar")

const PAGES = [
  ["/workspace", false],
  ["/projects", false],
  [`/dashboard/${DEMO_REPO_ID}`, true],
  [`/dashboard/${DEMO_REPO_ID}/history`, true],
  ["/profiles", true],
] as const

for (const [path, aboutOneProject] of PAGES) {
  test(`${path}: the app bar is there, and the project picker only where it means something`, async ({
    page,
  }) => {
    await page.goto(path)
    await expect(
      topBar(page).getByRole("combobox", { name: /^Workspace:/ }),
    ).toBeVisible()
    await expect(
      topBar(page).getByRole("button", { name: "Account menu" }),
    ).toBeVisible()
    await expect(
      topBar(page).getByRole("combobox", { name: /^Project:/ }),
    ).toHaveCount(aboutOneProject ? 1 : 0)
  })
}

test("on the dashboard, Branch and Scan sit in the app bar", async ({
  page,
}) => {
  await page.goto(`/dashboard/${DEMO_REPO_ID}`)
  await expect(
    topBar(page).getByRole("combobox", { name: "Branch" }),
  ).toBeVisible()
  await expect(
    topBar(page).getByRole("button", { name: /^scan$/i }),
  ).toBeVisible()
})

test("the rail starts below the app bar, not under it", async ({ page }) => {
  await page.goto("/projects")
  const bar = await topBar(page).boundingBox()
  const rail = await page
    .locator('[data-slot="sidebar-container"]')
    .boundingBox()
  expect(bar && rail).toBeTruthy()
  expect(rail!.y).toBeGreaterThanOrEqual(bar!.y + bar!.height - 1)
})

test("keyboard only: switch workspace from the app bar", async ({ page }) => {
  await page.goto("/projects")
  const trigger = topBar(page).getByRole("combobox", { name: /^Workspace:/ })
  await trigger.focus()
  await page.keyboard.press("Enter")
  await expect(page.getByRole("option", { name: /Nimbus Labs/ })).toBeVisible()
  await page.keyboard.press("ArrowDown")
  await page.keyboard.press("Enter")

  await expect(trigger).toHaveAccessibleName("Workspace: Nimbus Labs")
})

test.describe("mobile", () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test("the dashboard's app bar wraps instead of scrolling sideways", async ({
    page,
  }) => {
    await page.goto(`/dashboard/${DEMO_REPO_ID}`)
    await expect(
      topBar(page).getByRole("combobox", { name: /^Project:/ }),
    ).toBeVisible()
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
  })

  test("the menu button in the app bar opens the rail", async ({ page }) => {
    await page.goto("/projects")
    await topBar(page)
      .getByRole("button", { name: /toggle sidebar/i })
      .click()
    await expect(
      page.getByRole("link", { name: "Profiles", exact: true }),
    ).toBeVisible()
  })
})
