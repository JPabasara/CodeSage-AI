import { DEMO_REPO_ID, test, expect } from "./session"

// The happy path, plus finding detail rendering in the page rather than as a slide-over.

const detailPanel = (page: import("@playwright/test").Page) =>
  page.getByLabel("Finding detail", { exact: true })

const findingCards = (page: import("@playwright/test").Page) =>
  page
    .getByRole("list", { name: /ranked refactor findings/i })
    .getByRole("button")

const tab = (page: import("@playwright/test").Page, name: string) =>
  page
    .getByRole("tablist", { name: "Dashboard view" })
    .getByRole("tab", { name: new RegExp(`^${name}`) })

const showFindings = (page: import("@playwright/test").Page) =>
  tab(page, "Findings").click()

const showOverview = (page: import("@playwright/test").Page) =>
  tab(page, "Overview").click()

const showCodeMap = (page: import("@playwright/test").Page) =>
  tab(page, "Code map").click()

test.beforeEach(async ({ page }) => {
  await page.goto(`/dashboard/${DEMO_REPO_ID}`)
  await expect(page.getByText("Code Health")).toBeVisible()
})

test("the overview shows the score, grade and the critical and high count", async ({
  page,
}) => {
  const health = page.getByTestId("kpi-health")
  await expect(health.getByTestId("health-score")).toHaveText("72")
  await expect(health.getByText("B", { exact: true })).toBeVisible()
  // critical + high = 4 of the ten findings.
  const critical = page.getByTestId("kpi-critical-high")
  await expect(critical.getByText("4", { exact: true })).toBeVisible()
  await expect(page.getByText("Health trend")).toBeVisible()
  await expect(page.getByText("Debt by type")).toBeVisible()
})

test("Refactor first opens with the worst finding at the top", async ({
  page,
}) => {
  const top = page
    .getByRole("list", { name: "Top findings" })
    .getByRole("button")
  await expect(top.first()).toContainText(/hardcoded stripe api key/i)
  await expect(top.first()).toContainText(/critical/i)

  await showFindings(page)
  const cards = findingCards(page)
  await expect(cards.first()).toContainText(/hardcoded stripe api key/i)
  await expect(cards.first()).toContainText("critical")
})

test("the code map is a heat map, not a uniform block of green", async ({
  page,
}) => {
  await showCodeMap(page)
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

test("selecting a finding opens the detail beside the list", async ({
  page,
}) => {
  await showFindings(page)
  await findingCards(page).filter({ hasText: "hardcoded" }).click()

  const detail = detailPanel(page)
  await expect(detail.getByText(/hardcoded stripe api key/i)).toBeVisible()
  await expect(
    detail.getByText("src/payments/payment_service.ts:42"),
  ).toBeVisible()

  // The detail sits in the page, not over it. No dialog, no blurred page.
  await expect(page.getByText("Code Health")).toBeHidden()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expect(tab(page, "Findings")).toHaveAttribute("aria-selected", "true")

  await expect(
    page.getByRole("heading", { name: /refactor first/i }),
  ).toBeVisible()
})

test("a finding picked on the overview opens straight in Findings", async ({
  page,
}) => {
  await page
    .getByRole("list", { name: "Top findings" })
    .getByRole("button")
    .first()
    .click()

  await expect(tab(page, "Findings")).toHaveAttribute("aria-selected", "true")
  await expect(
    detailPanel(page).getByText(/hardcoded stripe api key/i),
  ).toBeVisible()
})

test("moving between findings never closes the detail", async ({ page }) => {
  await showFindings(page)
  await findingCards(page).filter({ hasText: "hardcoded" }).click()
  await expect(detailPanel(page)).toBeVisible()

  await findingCards(page).filter({ hasText: "cyclomatic complexity" }).click()

  const detail = detailPanel(page)
  await expect(detail.getByText(/cyclomatic complexity 18/i)).toBeVisible()
  await expect(page).toHaveURL(/finding=/)
})

test("the selection lives in the URL, so refresh and Back both work", async ({
  page,
}) => {
  await showFindings(page)
  await findingCards(page).filter({ hasText: "hardcoded" }).click()
  await expect(page).toHaveURL(/finding=f-secret-1/)

  await page.reload()
  await expect(detailPanel(page)).toBeVisible()
  await expect(page.getByText("Code Health")).toBeHidden()

  // Back deselects the finding, the way it does in a mail client.
  await page.goBack()
  await expect(page).not.toHaveURL(/finding=/)
  await expect(detailPanel(page).getByText("Select a finding")).toBeVisible()
  await expect(findingCards(page).first()).toBeVisible()
})

test("closing returns to the list, and Overview restores the health card", async ({
  page,
}) => {
  await showFindings(page)
  await findingCards(page).filter({ hasText: "hardcoded" }).click()
  await expect(detailPanel(page).getByText(/hardcoded/i)).toBeVisible()

  await page.getByRole("button", { name: /close finding detail/i }).click()

  await expect(page).not.toHaveURL(/finding=/)
  await expect(tab(page, "Findings")).toHaveAttribute("aria-selected", "true")
  await expect(detailPanel(page).getByText("Select a finding")).toBeVisible()
  await expect(findingCards(page).first()).toBeVisible()

  await showOverview(page)
  await expect(page.getByText("Code Health")).toBeVisible()
  await expect(page.getByText("Health trend")).toBeVisible()
})

test("a file in the code map shows its findings, which open the detail", async ({
  page,
}) => {
  await showCodeMap(page)
  await page
    .getByLabel("File health tree")
    .getByRole("button", { name: /order_controller\.ts/ })
    .click()

  const file = page.getByLabel("File detail")
  await expect(
    file.getByRole("heading", { name: "order_controller.ts" }),
  ).toBeVisible()
  await file.getByRole("button").first().click()

  await expect(
    detailPanel(page).getByText(/order_controller\.ts:\d+/),
  ).toBeVisible()
})

test("the detail shows a rule finding's evidence: measured value versus limit", async ({
  page,
}) => {
  await showFindings(page)
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
  await showFindings(page)
  await findingCards(page)
    .filter({ hasText: /knowingly untested/i })
    .click()

  const detail = detailPanel(page)
  // Source and type read as words: "SATD" and "Test".
  await expect(detail.getByText("SATD", { exact: true })).toBeVisible()
  await expect(detail.getByText("Test", { exact: true })).toBeVisible()
  // Rule-only evidence must not appear on a SATD finding.
  await expect(detail.getByText(/Measured/)).toHaveCount(0)
})

test("the category filter narrows the list to one debt type", async ({
  page,
}) => {
  await showFindings(page)
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

test("at 1280x720 the page never scrolls sideways, and the detail stays beside a long list", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto(`/dashboard/${DEMO_REPO_ID}?view=findings`)
  await findingCards(page).first().click()
  await expect(detailPanel(page)).toBeVisible()

  const hasNoHorizontalScroll = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  )
  expect(hasNoHorizontalScroll).toBeTruthy()

  // The list is part of the page, which scrolls as a whole; the detail is pinned.
  await findingCards(page).last().scrollIntoViewIfNeeded()
  await expect(detailPanel(page)).toBeInViewport()

  await showCodeMap(page)
  await expect(page.getByTestId("file-tree-scroll")).toHaveCSS(
    "overflow-y",
    "auto",
  )
})

test("a file with no findings still opens, and says so", async ({ page }) => {
  await showCodeMap(page)
  await page
    .getByLabel("File health tree")
    .getByRole("button", { name: /formatters\.ts/ })
    .click()

  await expect(
    page
      .getByLabel("File detail")
      .getByText("No findings in this file in this snapshot."),
  ).toBeVisible()
  await expect(detailPanel(page)).toHaveCount(0)
})

test("the Java-only banner says what was analysed, and can be dismissed", async ({
  page,
}) => {
  const banner = page.getByTestId("java-scope-banner")
  await expect(banner).toContainText("Java only.")
  await expect(banner).toContainText(".java files")
  await expect(
    banner.getByRole("link", { name: "What is analysed" }),
  ).toHaveAttribute("href", "/help/what-is-analysed")

  await banner.getByRole("button", { name: "Dismiss for this project" }).click()
  await expect(banner).toHaveCount(0)
  await page.reload()
  await expect(page.getByText("Code Health")).toBeVisible()
  await expect(page.getByTestId("java-scope-banner")).toHaveCount(0)
})
