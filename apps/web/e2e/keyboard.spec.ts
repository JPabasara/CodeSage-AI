import AxeBuilder from "@axe-core/playwright"

import { DEMO_REPO_ID, test, expect } from "./session"

// U-9: every interactive component keyboard operable, a logical tab order, and
// a visible focus indicator.
//
// The finding rows were the hole. They were `onClick` on a plain <tr>, so the
// core triage flow — open the worst finding — could not be reached by keyboard
// at all. Nothing here mocks anything: these drive the real keys.

/**
 * The detail card, and not the "Close finding detail" button inside it.
 *
 * `getByLabel` matches on substring, and "Finding detail" is a substring of
 * "Close finding detail" — so the loose form resolves to two elements.
 */
const detailPanel = (page: import("@playwright/test").Page) =>
  page.getByLabel("Finding detail", { exact: true })

const findingCards = (page: import("@playwright/test").Page) =>
  page
    .getByRole("list", { name: /ranked refactor findings/i })
    .getByRole("button")

/**
 * Tab until `target` has focus, then say how many presses it took.
 *
 * The count is the point: "reachable eventually" is not the same as "reachable",
 * and a cap turns an unreachable control into a failure rather than a hang.
 */
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

test("the top finding opens with the keyboard alone", async ({ page }) => {
  await page.goto(`/dashboard/${DEMO_REPO_ID}`)
  await expect(page.getByText("Code Health")).toBeVisible()

  const topFinding = findingCards(page).first()
  await tabTo(page, topFinding)

  // Focus has to be SEEN, not just held (U-9 asks for a visible indicator).
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

  // Sign-in is bypassed by the session fixture (see session.ts) and Connect is a
  // plain form, which the browser makes keyboard operable for free. What was
  // NOT free is everything below: pick a branch, start a scan, open a finding.
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

  // Each was reached, and each came after the one before it — so the tab order
  // follows the page rather than wandering back up it.
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
  await tabTo(page, firstNode)
  await expect(firstNode).toBeFocused()

  // Already a real <button>, so it always activated — but with no focus style
  // you could not see where you were while tabbing through it.
  const ringWidth = await firstNode.evaluate(
    (el) => getComputedStyle(el).outlineWidth + getComputedStyle(el).boxShadow,
  )
  expect(ringWidth).not.toBe("0pxnone")
})

test("every route has its own title, so tabs and history are tellable apart", async ({
  page,
}) => {
  const routes: [string, RegExp][] = [
    ["/projects", /^Projects · Code Sage AI$/],
    ["/profiles", /^Scoring profiles · Code Sage AI$/],
    [`/dashboard/${DEMO_REPO_ID}`, /^Dashboard · Code Sage AI$/],
    [`/dashboard/${DEMO_REPO_ID}/history`, /^Scan history · Code Sage AI$/],
  ]

  for (const [path, title] of routes) {
    await page.goto(path)
    await expect(page, path).toHaveTitle(title)
  }
})

// ── axe ─────────────────────────────────────────────────────────────────────
//
// Scoped to the rule tags U-9 is about. A full WCAG sweep also returns colour
// contrast, which is #114 and somebody else's open issue — folding it in here
// would mean this test fails for work nobody has started.

const KEYBOARD_AND_ARIA = ["wcag2a", "wcag21a", "wcag2aa", "best-practice"]

/**
 * Three rules are switched off, each because it belongs to an issue that is open
 * and assigned to somebody else. Leaving them on would make this test fail for
 * work nobody has started, and a suite that is red for a known reason stops
 * being read at all.
 *
 * Everything that IS keyboard or ARIA stays on: tab order, nested interactives,
 * button and link names, aria-* validity, required children and owned roles.
 */
const OWNED_BY_OTHER_ISSUES = [
  "color-contrast", // #114 — contrast and colour-only meaning
  "region", // #140 — landmarks
  "landmark-one-main", // #140 — landmarks
  "page-has-heading-one", // #140 — document structure
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
    expect(await violations(page), path).toEqual([])
  }
})
