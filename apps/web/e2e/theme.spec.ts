import { test, expect, DEMO_REPO_ID } from "./session"

test.use({ colorScheme: "light" })

const html = (page: import("@playwright/test").Page) => page.locator("html")

/** Theme lives at the foot of the rail: Light, Dark or System default. */
async function chooseTheme(
  page: import("@playwright/test").Page,
  name: "Light" | "Dark" | "System default",
) {
  await page.getByRole("button", { name: "Theme", exact: true }).click()
  await page.getByRole("menuitemradio", { name }).click()
}

test("the theme switch changes the whole app and the choice survives a reload", async ({
  page,
}) => {
  await page.goto("/projects")
  await expect(html(page)).not.toHaveClass(/dark/)

  await chooseTheme(page, "Dark")
  await expect(html(page)).toHaveClass(/dark/)

  // Remembered, not merely applied.
  await page.reload()
  await expect(html(page)).toHaveClass(/dark/)
  await page.getByRole("button", { name: "Theme", exact: true }).click()
  await expect(page.getByRole("menuitemradio", { name: "Dark" })).toBeChecked()
})

test("dark mode reaches the dashboard's own colours, not just the chrome", async ({
  page,
}) => {
  await page.goto(`/dashboard/${DEMO_REPO_ID}`)
  await expect(page.getByText("Code Health")).toBeVisible()

  // The grade badge is filled from --health-*, which must change with the theme.
  const grade = page
    .getByTestId("kpi-health")
    .locator('[style*="background-color"]')
    .filter({ hasText: /^[A-E]$/ })
  const fill = () =>
    grade.first().evaluate((el) => getComputedStyle(el).backgroundColor)
  const light = await fill()

  await chooseTheme(page, "Dark")
  await expect(html(page)).toHaveClass(/dark/)

  expect(await fill()).not.toBe(light)
})

test("switching back to light really goes back", async ({ page }) => {
  await page.goto("/projects")

  await chooseTheme(page, "Dark")
  await expect(html(page)).toHaveClass(/dark/)

  await chooseTheme(page, "Light")
  await expect(html(page)).not.toHaveClass(/dark/)
})
