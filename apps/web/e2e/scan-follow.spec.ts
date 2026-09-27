import { test as base } from "@playwright/test"

import { DEMO_REPO_ID, SESSION_COOKIE, expect, test } from "./session"

// Phase 13E. A scan used to live inside the dashboard: leave the page mid-scan
// and coming back showed an idle Scan button, with no progress and no Stop.
// Scans are now followed by the app shell, so they survive navigation.

const railLink = (page: import("@playwright/test").Page, name: string) =>
  page.locator('[data-slot="sidebar"]').getByRole("link", { name, exact: true })
const strip = (page: import("@playwright/test").Page) =>
  page.getByTestId("scan-status-strip")
const activity = (page: import("@playwright/test").Page) =>
  page.getByTestId("activity-trigger")

/** Where the scan panel's bar is, as the screen reader hears it. */
const barValue = async (page: import("@playwright/test").Page) =>
  Number(
    (await page
      .getByTestId("scan-progress-panel")
      .getByRole("progressbar")
      .getAttribute("aria-valuenow")) ?? "0",
  )

/** A scan slow enough (~15 s) to leave the page and come back while it runs. */
async function slowScans(
  page: import("@playwright/test").Page,
  baseURL: string | undefined,
) {
  await page.context().addCookies([
    {
      name: "codesage_e2e_slow_scan",
      value: "1",
      url: baseURL ?? "http://localhost:3101",
    },
  ])
}

test("leave mid-scan, follow Activity back, and Stop it", async ({
  page,
  baseURL,
}) => {
  await slowScans(page, baseURL)
  await page.goto(`/dashboard/${DEMO_REPO_ID}`)
  await page.getByRole("button", { name: /^scan$/i }).click()

  // Acknowledged at once: the toast and the strip.
  await expect(
    page.getByText("Scan queued · acme-payments · main"),
  ).toBeVisible()
  await expect(strip(page)).toContainText("acme-payments on main")

  // Away to another page: the top bar's Activity still says it is running.
  await railLink(page, "Projects").click()
  await expect(page).toHaveURL(/\/projects$/)
  await expect(activity(page)).toHaveText(/Scanning acme-payments/)

  // …and leads straight back to it, still running, with Stop.
  await activity(page).click()
  await page.getByRole("link", { name: "Open acme-payments · main" }).click()
  await expect(page).toHaveURL(new RegExp(`/dashboard/${DEMO_REPO_ID}`))
  await expect(strip(page)).toBeVisible()
  await strip(page).getByRole("button", { name: "Stop", exact: true }).click()

  await expect(page.getByText(/^Scan stopped · acme-payments/)).toBeVisible({
    timeout: 15_000,
  })
  await expect(strip(page)).toHaveCount(0)
})

test("coming back to the dashboard continues the bar — it never restarts", async ({
  page,
  baseURL,
}) => {
  await slowScans(page, baseURL)
  await page.goto(`/dashboard/${DEMO_REPO_ID}`)
  await page.getByRole("button", { name: /^scan$/i }).click()
  await expect(strip(page)).toBeVisible()
  await expect.poll(() => barValue(page)).toBeGreaterThan(0)
  const leftAt = await barValue(page)

  await railLink(page, "Projects").click()
  await expect(page).toHaveURL(/\/projects$/)
  await activity(page).click()
  await page.getByRole("link", { name: "Open acme-payments · main" }).click()

  // The first frame back is already where it was, not at zero.
  await expect(page.getByTestId("scan-progress-panel")).toBeVisible()
  expect(await barValue(page)).toBeGreaterThanOrEqual(leftAt)
})

test("a scan that finishes while you are elsewhere tells you when it is ready", async ({
  page,
}) => {
  await page.goto(`/dashboard/${DEMO_REPO_ID}`)
  await expect(page.getByText("Code Health")).toBeVisible()
  await page.getByRole("button", { name: /^scan$/i }).click()
  await expect(strip(page)).toBeVisible()

  await railLink(page, "Profiles").click()
  await expect(page).toHaveURL(/\/profiles$/)
  // Only once the score is ready too — with the score in it.
  const toast = page.getByText("acme-payments · main is ready")
  await expect(toast).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText(/^Health \d+ \([A-F]\)/)).toBeVisible()
  await expect(activity(page)).toHaveText("Results ready")

  // "View dashboard" goes there and shows the new results straight away.
  await page.getByRole("button", { name: "View dashboard" }).click()
  await expect(page).toHaveURL(new RegExp(`/dashboard/${DEMO_REPO_ID}`))
  await expect(page.getByText("Code Health")).toBeVisible()
  await expect(page.getByText("New results are ready")).toHaveCount(0)
  await expect(activity(page)).toHaveCount(0)
})

const asViewer = base.extend({
  page: async ({ page, baseURL }, runTest) => {
    const url = baseURL ?? "http://localhost:3101"
    await page.context().addCookies([
      { name: SESSION_COOKIE, value: "e2e-seeded-session", url },
      { name: "codesage_e2e_role", value: "viewer", url },
    ])
    await runTest(page)
  },
})

asViewer("a viewer sees Scan disabled, and why", async ({ page }) => {
  await page.goto(`/dashboard/${DEMO_REPO_ID}`)
  const scan = page.getByRole("button", { name: /^scan$/i })
  await expect(scan).toBeDisabled()

  await page.getByLabel("Viewers can't start scans").focus()
  await expect(page.getByRole("tooltip")).toHaveText(
    "Viewers can't start scans",
  )
})
