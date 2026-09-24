import { test as base } from "@playwright/test"

import { DEMO_REPO_ID, SESSION_COOKIE, expect, test } from "./session"

// Phase 13E. A scan used to live inside the dashboard: leave the page mid-scan
// and coming back showed an idle Scan button, with no progress and no Stop.
// Scans are now followed by the app shell, so they survive navigation.

const railLink = (page: import("@playwright/test").Page, name: string) =>
  page.locator('[data-slot="sidebar"]').getByRole("link", { name, exact: true })
const strip = (page: import("@playwright/test").Page) =>
  page.getByTestId("scan-status-strip")
const pill = (page: import("@playwright/test").Page) =>
  page.getByTestId("scan-pill")

test("leave mid-scan, follow the pill back, and Stop it", async ({ page }) => {
  await page.goto(`/dashboard/${DEMO_REPO_ID}`)
  await page.getByRole("button", { name: /^scan$/i }).click()

  // Acknowledged at once: the toast and the strip.
  await expect(
    page.getByText("Scan queued · acme-payments · main"),
  ).toBeVisible()
  await expect(strip(page)).toContainText("acme-payments on main")

  // Away to another page: the app bar still says a scan is running.
  await railLink(page, "Projects").click()
  await expect(page).toHaveURL(/\/projects$/)
  await expect(pill(page)).toHaveText(/Scanning acme-payments/)

  // …and leads straight back to it, still running, with Stop.
  await pill(page).click()
  await expect(page).toHaveURL(new RegExp(`/dashboard/${DEMO_REPO_ID}`))
  await expect(strip(page)).toBeVisible()
  await strip(page).getByRole("button", { name: "Stop", exact: true }).click()

  await expect(page.getByText(/^Scan stopped · acme-payments/)).toBeVisible({
    timeout: 15_000,
  })
  await expect(strip(page)).toHaveCount(0)
})

test("a scan that finishes while you are elsewhere still tells you", async ({
  page,
}) => {
  await page.goto(`/dashboard/${DEMO_REPO_ID}`)
  await page.getByRole("button", { name: /^scan$/i }).click()
  await expect(strip(page)).toBeVisible()

  await railLink(page, "Profiles").click()
  await expect(page).toHaveURL(/\/profiles$/)
  await expect(page.getByText(/^Scan finished · /)).toBeVisible({
    timeout: 15_000,
  })
  await expect(pill(page)).toHaveCount(0)
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
