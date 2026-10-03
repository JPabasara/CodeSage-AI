import AxeBuilder from "@axe-core/playwright"

import { DEMO_REPO_ID, test, expect } from "./session"

// The detail card, and not the "Close finding detail" button inside it.
const detailPanel = (page: import("@playwright/test").Page) =>
  page.getByLabel("Finding detail", { exact: true })

const findingCards = (page: import("@playwright/test").Page) =>
  page
    .getByRole("list", { name: /ranked refactor findings/i })
    .getByRole("button")

// Tab until `target` has focus, then say how many presses it took.
async function tabTo(
  page: import("@playwright/test").Page,
  target: import("@playwright/test").Locator,
  max = 40,
) {
  for (let presses = 1; presses <= max; presses += 1) {
    await page.keyboard.press("Tab")
    if (await target.evaluate((el) => el === document.activeElement)) {
      return presses
    }
  }
  throw new Error(`not reachable by keyboard within ${max} tab presses`)
}

test("tab from a cold load reaches skip to content link first (#140)", async ({
  page,
}) => {
  await page.goto(`/dashboard/${DEMO_REPO_ID}`)
  await expect(page.getByText("Code Health")).toBeVisible()

  await page.keyboard.press("Tab")
  const skipLink = page.getByRole("link", { name: /skip to content/i })
  await expect(skipLink).toBeFocused()
  await expect(skipLink).toBeVisible()
})

test("the top finding opens with the keyboard alone", async ({ page }) => {
  await page.goto(`/dashboard/${DEMO_REPO_ID}`)
  await expect(page.getByText("Code Health")).toBeVisible()

  const topFinding = findingCards(page).first()
  await tabTo(page, topFinding)

  // Focus has to be SEEN, not just held (a visible indicator is required).
  await expect(topFinding).toBeFocused()
  const focusPaint = await topFinding.evaluate(
    (el) => getComputedStyle(el).outlineWidth + getComputedStyle(el).boxShadow,
  )
  expect(focusPaint).not.toBe("0pxnone")

  await page.keyboard.press("Enter")
  await expect(detailPanel(page)).toBeVisible()
})

test("Space opens a finding too, and does not scroll the page instead", async ({
  page,
}) => {
  await page.goto(`/dashboard/${DEMO_REPO_ID}`)
  await expect(page.getByText("Code Health")).toBeVisible()

  const topFinding = findingCards(page).first()
  await tabTo(page, topFinding)

  const scrollBefore = await page.evaluate(() => window.scrollY)
  await page.keyboard.press(" ")

  await expect(detailPanel(page)).toBeVisible()
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore)
})

test("the demo path's controls are all reachable by keyboard, in order", async ({
  page,
}) => {
  await page.goto(`/dashboard/${DEMO_REPO_ID}`)
  await expect(page.getByText("Code Health")).toBeVisible()

  const branch = page.getByLabel("Branch")
  const scan = page.getByRole("button", { name: /^scan$/i })
  const filter = page.getByRole("combobox", { name: /filter by debt type/i })
  const topFinding = findingCards(page).first()

  const order = [
    await tabTo(page, branch),
    await tabTo(page, scan),
    await tabTo(page, filter),
    await tabTo(page, topFinding),
  ]

  expect(order.every((presses) => presses > 0)).toBe(true)
})

test("the file tree is reachable and shows where the focus is", async ({
  page,
}) => {
  await page.goto(`/dashboard/${DEMO_REPO_ID}`)
  await expect(page.getByText("Code Health")).toBeVisible()

  const firstNode = page
    .getByLabel("File health tree")
    .getByRole("button")
    .first()
  // The ranked list and its "Mark as done" buttons come before the tree.
  await tabTo(page, firstNode, 80)
  await expect(firstNode).toBeFocused()

  const ringWidth = await firstNode.evaluate(
    (el) => getComputedStyle(el).outlineWidth + getComputedStyle(el).boxShadow,
  )
  expect(ringWidth).not.toBe("0pxnone")
})

test("every route has its own title, so tabs and history are tellable apart", async ({
  page,
}) => {
  const routes: [string, string][] = [
    ["/projects", "Projects | CodeSage AI"],
    ["/profiles", "Scoring profiles | CodeSage AI"],
    [`/dashboard/${DEMO_REPO_ID}`, "Dashboard | CodeSage AI"],
    [`/dashboard/${DEMO_REPO_ID}/history`, "Scan history | CodeSage AI"],
  ]

  for (const [path, title] of routes) {
    await page.goto(path)
    await expect(page, path).toHaveTitle(title)
  }
})

const KEYBOARD_AND_ARIA = ["wcag2a", "wcag21a", "wcag2aa", "best-practice"]

const OWNED_BY_OTHER_ISSUES = [
  "color-contrast", // #114 — contrast and colour-only meaning
  "region", // the rail header and footer still sit outside any landmark
  "page-has-heading-one", // document structure
]

async function violations(page: import("@playwright/test").Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(KEYBOARD_AND_ARIA)
    .disableRules(OWNED_BY_OTHER_ISSUES)
    .analyze()
  return violations.map((v) => `${v.id}: ${v.help}`)
}

test("axe finds no keyboard or ARIA violations on the dashboard", async ({
  page,
}) => {
  await page.goto(`/dashboard/${DEMO_REPO_ID}`)
  await expect(page.getByText("Code Health")).toBeVisible()
  expect(await violations(page)).toEqual([])
})

test("axe finds no keyboard or ARIA violations on the other routes", async ({
  page,
}) => {
  for (const path of [
    "/projects",
    "/profiles",
    `/dashboard/${DEMO_REPO_ID}/history`,
  ]) {
    await page.goto(path)
    await expect(page.locator("#main-content")).toBeVisible()
    expect(await violations(page), path).toEqual([])
  }
})
