import { test, expect, DEMO_REPO_ID } from "./session"

// FR-22. The dark palette has been sitting in globals.css since the first
// commit; nothing ever put the class on <html>, so none of it was reachable and
// the switch the requirement names did not exist.
//
// The unit test proves the button asks for the right theme. Only this proves the
// provider is actually mounted, that the class lands, and that the choice
// outlives a reload — none of which a jsdom test can see.

// Pinned, so the default "system" theme resolves to light and the first
// assertion is not at the mercy of whatever the CI machine prefers.
test.use({ colorScheme: "light" })

const html = (page: import("@playwright/test").Page) => page.locator("html")

/** Theme lives in the avatar menu: Light, Dark or System. */
async function chooseTheme(
  page: import("@playwright/test").Page,
  name: "Light" | "Dark" | "System",
) {
  await page.getByRole("button", { name: "Account menu" }).click()
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
  await page.getByRole("button", { name: "Account menu" }).click()
  await expect(page.getByRole("menuitemradio", { name: "Dark" })).toBeChecked()
})

test("dark mode reaches the dashboard's own colours, not just the chrome", async ({
  page,
}) => {
  await page.goto(`/dashboard/${DEMO_REPO_ID}`)
  await expect(page.getByText("Code Health")).toBeVisible()

  // The grade letter is painted from --health-*, which lived under :root only.
  // Read it in both themes: if the dark block were still missing these tokens
  // the two would be identical, and the letter would be a dark green on a
  // near-black card.
  const grade = page.locator('[style*="color"]').filter({ hasText: /^[A-E]$/ })
  const light = await grade.first().evaluate((el) => getComputedStyle(el).color)

  await chooseTheme(page, "Dark")
  await expect(html(page)).toHaveClass(/dark/)

  const dark = await grade.first().evaluate((el) => getComputedStyle(el).color)
  expect(dark).not.toBe(light)
})

test("switching back to light really goes back", async ({ page }) => {
  await page.goto("/projects")

  await chooseTheme(page, "Dark")
  await expect(html(page)).toHaveClass(/dark/)

  await chooseTheme(page, "Light")
  await expect(html(page)).not.toHaveClass(/dark/)
})
