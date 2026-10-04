import { DEMO_REPO_ID, expect, test } from "./session"

const topBar = (page: import("@playwright/test").Page) =>
  page.getByTestId("app-top-bar")

const PAGES = [
  ["/overview", false],
  ["/workspace", false],
  ["/projects", false],
  [`/dashboard/${DEMO_REPO_ID}`, true],
  [`/dashboard/${DEMO_REPO_ID}/history`, true],
  ["/profiles", false],
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

test("on the dashboard, Branch sits in the app bar and Scan is the page's own action", async ({
  page,
}) => {
  await page.goto(`/dashboard/${DEMO_REPO_ID}`)
  await expect(
    topBar(page).getByRole("combobox", { name: "Branch" }),
  ).toBeVisible()
  await expect(
    page.getByRole("main").getByRole("button", { name: "Scan main" }),
  ).toBeVisible()
  await expect(
    topBar(page).getByRole("button", { name: /^scan/i }),
  ).toHaveCount(0)
})

test("the app bar keeps its place and height on every page, so nothing jumps", async ({
  page,
}) => {
  const boxes: { y: number; height: number }[] = []
  for (const [path] of PAGES) {
    await page.goto(path)
    await expect(
      topBar(page).getByRole("combobox", { name: /^Workspace:/ }),
    ).toBeVisible()
    const box = await topBar(page).boundingBox()
    expect(box).toBeTruthy()
    boxes.push({ y: box!.y, height: box!.height })
  }
  for (const box of boxes) expect(box).toEqual(boxes[0])
})

test("every page's title starts at the same place, so switching pages never jumps", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  const xs: number[] = []
  for (const path of [...PAGES.map(([path]) => path), "/support", "/help"]) {
    await page.goto(path)
    const title = page.locator("#main-content h1").first()
    await expect(title).toBeVisible()
    xs.push(Math.round((await title.boundingBox())!.x))
  }
  expect(new Set(xs).size, `title x per page: ${xs.join(", ")}`).toBe(1)
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
      page.getByRole("link", { name: "Scoring profiles", exact: true }),
    ).toBeVisible()
  })
})
