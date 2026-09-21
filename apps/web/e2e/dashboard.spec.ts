import { DEMO_REPO_ID, test, expect } from "./session"

// The happy path, plus finding detail rendering in the page rather than as a
// slide-over. Keep this one green forever: it is the smoke alarm for the whole
// demo.

/** The detail panel, matched exactly — "Close finding detail" contains it too. */
const detailPanel = (page: import("@playwright/test").Page) =>
  page.getByLabel("Finding detail", { exact: true })

const findingCards = (page: import("@playwright/test").Page) =>
  page
    .getByRole("list", { name: /ranked refactor findings/i })
    .getByRole("button")

test.beforeEach(async ({ page }) => {
  await page.goto(`/dashboard/${DEMO_REPO_ID}`)
  await expect(page.getByText("Code Health")).toBeVisible()
})

test("the health card shows a derived grade, score and red-issue count", async ({
  page,
}) => {
  // 71 / B under Balanced, computed by the mock's scoring engine rather than
  // typed into a fixture — so this number moving means the FORMULA moved.
  const healthCard = page.locator("div").filter({ hasText: "Code Health" }).first()
  await expect(page.getByText(/71\/100/)).toBeVisible()
  await expect(healthCard.getByText("B", { exact: true }).first()).toBeVisible()
  // critical + high = 4 of the findings.
  await expect(page.getByText(/4 red issues/i)).toBeVisible()
})

test("the Refactor-First list arrives sorted by priority, worst first", async ({
  page,
}) => {
  const cards = findingCards(page)
  await expect(cards.first()).toContainText(/hardcoded stripe api key/i)
  await expect(cards.first()).toContainText("critical")
})

test("the file tree is a heat map, not a uniform block of green", async ({
  page,
}) => {
  const tree = page.getByLabel("File health tree")
  await expect(tree).toBeVisible()
  // Every file in the fixture, including the one whose ML risk is null.
  await expect(
    tree.getByRole("button", { name: /payment_service\.ts/ }),
  ).toBeVisible()
  await expect(
    tree.getByRole("button", { name: /legacy_gateway\.ts/ }),
  ).toBeVisible()
})

test("selecting a finding swaps the health card for the detail, in place", async ({
  page,
}) => {
  await findingCards(page).filter({ hasText: "hardcoded" }).click()

  const detail = detailPanel(page)
  await expect(detail.getByText(/hardcoded stripe api key/i)).toBeVisible()
  await expect(
    detail.getByText("src/payments/payment_service.ts:42"),
  ).toBeVisible()

  // The region was replaced, not covered. No dialog, no blurred page.
  await expect(page.getByText("Code Health")).toBeHidden()
  await expect(page.getByRole("dialog")).toHaveCount(0)

  // The tree stays usable and reveals the finding's file.
  await expect(
    page.getByLabel("File health tree").locator('[aria-current="true"]'),
  ).toContainText("payment_service.ts")

  // The list stays visible, so the next finding is one click away — no
  // close-and-reopen, which is the whole reason the slide-over went.
  await expect(
    page.getByRole("heading", { name: /refactor first/i }),
  ).toBeVisible()
})

test("moving between findings never closes the detail", async ({ page }) => {
  await findingCards(page).filter({ hasText: "hardcoded" }).click()
  await expect(detailPanel(page)).toBeVisible()

  await findingCards(page).filter({ hasText: "cyclomatic complexity" }).click()

  const detail = detailPanel(page)
  await expect(detail.getByText(/cyclomatic complexity 18/i)).toBeVisible()
  // The tree highlight followed the selection.
  await expect(
    page.getByLabel("File health tree").locator('[aria-current="true"]'),
  ).toContainText("payment_service.ts")
})

test("the selection lives in the URL, so refresh and Back both work", async ({
  page,
}) => {
  await findingCards(page).filter({ hasText: "hardcoded" }).click()
  await expect(page).toHaveURL(/\?finding=f-secret-1/)

  await page.reload()
  await expect(detailPanel(page)).toBeVisible()
  await expect(page.getByText("Code Health")).toBeHidden()

  // Back leaves detail mode, the way it does in a mail client.
  await page.goBack()
  await expect(page.getByText("Code Health")).toBeVisible()
})

test("closing restores the health card and the trend chart", async ({
  page,
}) => {
  await findingCards(page).filter({ hasText: "hardcoded" }).click()
  await expect(detailPanel(page)).toBeVisible()

  await page.getByRole("button", { name: /close finding detail/i }).click()

  await expect(page.getByText("Code Health")).toBeVisible()
  await expect(detailPanel(page)).toHaveCount(0)
  await expect(page).not.toHaveURL(/finding=/)
})

test("clicking a file in the tree opens that file's finding", async ({
  page,
}) => {
  await page
    .getByLabel("File health tree")
    .getByRole("button", { name: /order_controller\.ts/ })
    .click()

  await expect(
    detailPanel(page).getByText(/order_controller\.ts:\d+/),
  ).toBeVisible()
})

test("the detail shows a rule finding's evidence: measured value versus limit", async ({
  page,
}) => {
  await findingCards(page).filter({ hasText: "cyclomatic complexity" }).click()

  const detail = detailPanel(page)
  await expect(detail.getByText(/Measured/)).toBeVisible()
  await expect(detail.getByText("18", { exact: true })).toBeVisible()
  await expect(detail.getByText("15", { exact: true })).toBeVisible()
  await expect(detail.getByText(/complex-function/)).toBeVisible()
})

test("a SATD finding shows its source and category, with no rule evidence", async ({
  page,
}) => {
  await findingCards(page).filter({ hasText: /knowingly untested/i }).click()

  const detail = detailPanel(page)
  await expect(detail.getByText("satd")).toBeVisible()
  await expect(detail.getByText("test", { exact: true })).toBeVisible()
  // Rule-only evidence must not appear on a SATD finding.
  await expect(detail.getByText(/Measured/)).toHaveCount(0)
})

test("the category filter narrows the list to one debt type", async ({
  page,
}) => {
  await page.getByRole("combobox", { name: /filter by debt type/i }).click()
  await page.getByRole("option", { name: "security" }).click()

  await expect(
    findingCards(page).filter({ hasText: "hardcoded" }),
  ).toBeVisible()
  // A code-design finding must be gone.
  await expect(
    findingCards(page).filter({ hasText: /940 lines long/ }),
  ).toHaveCount(0)
})

// ── Responsive viewports (U-13) ─────────────────────────────────────────────

test("dashboard is fully usable at 1280x720 laptop baseline with no horizontal scroll (U-13)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 })

  // U-13: No horizontal scrolling of the dashboard
  const hasHorizontalScroll = await page.evaluate(
    () => document.body.scrollWidth > window.innerWidth,
  )
  expect(hasHorizontalScroll).toBe(false)

  // Top nav elements visible
  await expect(page.getByText("acme/acme-payments")).toBeVisible()
  await expect(page.getByRole("button", { name: /scan/i })).toBeVisible()

  // Cards, table, and file tree visible side-by-side
  await expect(page.getByText("Code Health")).toBeVisible()
  await expect(page.getByText("Health Trend")).toBeVisible()
  await expect(
    page.getByRole("heading", { name: /refactor first/i }),
  ).toBeVisible()
  await expect(page.getByLabel("File health tree")).toBeVisible()
})

test("dashboard collapses to single column below lg breakpoint without overflow (U-13)", async ({
  page,
}) => {
  // Below lg (1024px)
  await page.setViewportSize({ width: 900, height: 800 })

  const hasHorizontalScroll = await page.evaluate(
    () => document.body.scrollWidth > window.innerWidth,
  )
  expect(hasHorizontalScroll).toBe(false)

  // Elements remain visible and accessible in collapsed single column
  await expect(page.getByText("Code Health")).toBeVisible()
  await expect(
    page.getByRole("heading", { name: /refactor first/i }),
  ).toBeVisible()
  await expect(page.getByLabel("File health tree")).toBeVisible()

  // File tree is below the list in vertical order
  const listRect = await page
    .getByRole("heading", { name: /refactor first/i })
    .boundingBox()
  const treeRect = await page.getByLabel("File health tree").boundingBox()
  expect(treeRect!.y).toBeGreaterThan(listRect!.y)
})

test("the dashboard is viewport-bounded at 1280x720", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto(`/dashboard/${DEMO_REPO_ID}`)
  await expect(page.getByText("Code Health")).toBeVisible()

  const hasNoHorizontalScroll = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  )
  expect(hasNoHorizontalScroll).toBeTruthy()

  const listScroll = page.getByTestId("refactor-first-scroll")
  const listScrolledInternally = await listScroll.evaluate((element) => {
    element.scrollTop = element.scrollHeight
    return (
      element.scrollTop > 0 && (document.scrollingElement?.scrollTop ?? 0) === 0
    )
  })
  expect(listScrolledInternally).toBeTruthy()
  await expect(page.getByText("Live dashboard")).toBeVisible()

  await expect(page.getByTestId("file-tree-scroll")).toHaveCSS(
    "overflow-y",
    "auto",
  )
})

test("clicking a clean file in the tree gives helpful feedback", async ({
  page,
}) => {
  await page
    .getByLabel("File health tree")
    .getByRole("button", { name: /formatters\.ts/ })
    .click()

  await expect(
    page
      .getByLabel("File health tree")
      .getByRole("status")
      .filter({ hasText: "formatters.ts has no findings in this snapshot." }),
  ).toBeVisible()
  await expect(detailPanel(page)).toHaveCount(0)
})
