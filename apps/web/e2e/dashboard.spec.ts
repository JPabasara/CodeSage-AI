import { DEMO_REPO_ID, test, expect } from "./session"

// The happy path, plus finding detail rendering in the page rather than as a
// slide-over. Keep this one green forever: it is the smoke alarm for the whole
// demo.

/** The detail panel, matched exactly — "Close finding detail" contains it too. */
const detailPanel = (page: import("@playwright/test").Page) =>
  page.getByLabel("Finding detail", { exact: true })

test.beforeEach(async ({ page }) => {
  await page.goto(`/dashboard/${DEMO_REPO_ID}`)
  await expect(page.getByText("Code Health")).toBeVisible()
})

test("the health card shows a derived grade, score and red-issue count", async ({
  page,
}) => {
  // 72 / B under Balanced, computed by the mock's scoring engine rather than
  // typed into a fixture — so this number moving means the FORMULA moved.
  await expect(page.getByText("72/100")).toBeVisible()
  await expect(page.getByText("B", { exact: true })).toBeVisible()
  // critical + high = 4 of the ten findings.
  await expect(page.getByText(/4 red issues/i)).toBeVisible()
})

test("the Refactor-First list arrives sorted by priority, worst first", async ({
  page,
}) => {
  const rows = page.getByRole("row")
  // Row 0 is the header. The contract returns the list already sorted, so the
  // client never re-sorts and the badge can never disagree with the ranking.
  await expect(rows.nth(1)).toContainText(/hardcoded stripe api key/i)
  await expect(rows.nth(1)).toContainText("critical")
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
  await page.getByRole("row").filter({ hasText: "hardcoded" }).click()

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
  await page.getByRole("row").filter({ hasText: "hardcoded" }).click()
  await expect(detailPanel(page)).toBeVisible()

  await page
    .getByRole("row")
    .filter({ hasText: "cyclomatic complexity" })
    .click()

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
  await page.getByRole("row").filter({ hasText: "hardcoded" }).click()
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
  await page.getByRole("row").filter({ hasText: "hardcoded" }).click()
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
  await page
    .getByRole("row")
    .filter({ hasText: "cyclomatic complexity" })
    .click()

  const detail = detailPanel(page)
  await expect(detail.getByText(/Measured/)).toBeVisible()
  await expect(detail.getByText("18", { exact: true })).toBeVisible()
  await expect(detail.getByText("15", { exact: true })).toBeVisible()
  await expect(detail.getByText(/complex-function/)).toBeVisible()
})

test("a SATD finding shows its source and category, with no rule evidence", async ({
  page,
}) => {
  await page
    .getByRole("row")
    .filter({ hasText: /knowingly untested/i })
    .click()

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
    page.getByRole("row").filter({ hasText: "hardcoded" }),
  ).toBeVisible()
  // A code-design finding must be gone.
  await expect(
    page.getByRole("row").filter({ hasText: /940 lines long/ }),
  ).toHaveCount(0)
})
