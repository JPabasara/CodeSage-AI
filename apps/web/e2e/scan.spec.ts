import { DEMO_REPO_ID, test, expect } from "./session"

// The scan state machine: idle → running → done | cancelled.

// The page header's main action, named for the branch it scans.
const scanButton = (page: import("@playwright/test").Page) =>
  page.getByRole("button", { name: "Scan main", exact: true })

// The same button while busy: "Scanning 41%" (or "Scanning…" before a number).
const scanningLabel = (page: import("@playwright/test").Page) =>
  page.getByRole("button", { name: /^Scanning/ })

const stoppingLabel = (page: import("@playwright/test").Page) =>
  // The header button first; the progress strip says the same.
  page.getByRole("button", { name: "Stopping…", exact: true }).first()

const cancelledLabel = (page: import("@playwright/test").Page) =>
  page.getByText(/^Scan stopped · /)

test.beforeEach(async ({ page }) => {
  await page.goto(`/dashboard/${DEMO_REPO_ID}`)
  await expect(page.getByText("Code Health")).toBeVisible()
})

test("a scan runs to completion and reports progress on the way", async ({
  page,
}) => {
  await scanButton(page).click()

  await expect(scanningLabel(page)).toBeVisible()
  await expect(page.getByRole("button", { name: /stop/i })).toBeVisible()

  // …and ends back at an idle Scan button once the phase turns terminal.
  await expect(scanButton(page)).toBeVisible({ timeout: 15_000 })
  await expect(scanningLabel(page)).toHaveCount(0)
})

test("stopping a scan says Stopping…, then settles on Cancelled — never idle", async ({
  page,
}) => {
  await scanButton(page).click()
  await expect(scanningLabel(page)).toBeVisible()

  await page.getByRole("button", { name: "Stop", exact: true }).click()

  await expect(stoppingLabel(page)).toBeVisible()

  await expect(cancelledLabel(page)).toBeVisible({ timeout: 15_000 })
  await expect(scanButton(page)).toBeVisible()
})

test("a cancelled scan leaves the previous results intact", async ({
  page,
}) => {
  await scanButton(page).click()
  await page.getByRole("button", { name: "Stop", exact: true }).click()
  await expect(cancelledLabel(page)).toBeVisible({ timeout: 15_000 })

  // Cancelling must never leave a half-written snapshot, so the dashboard still shows the last good one.
  await expect(page.getByText("Code Health")).toBeVisible()
  await expect(page.getByTestId("health-score")).toHaveText("72")
})

test("a scan can be started again after being cancelled", async ({ page }) => {
  await scanButton(page).click()
  await page.getByRole("button", { name: "Stop", exact: true }).click()
  await expect(cancelledLabel(page)).toBeVisible({ timeout: 15_000 })

  await scanButton(page).click()
  await expect(scanningLabel(page)).toBeVisible()
})

test("the scan control never offers Scan and Stop at the same time", async ({
  page,
}) => {
  await scanButton(page).click()
  await expect(scanningLabel(page)).toBeVisible()

  // While running, the only write available is Stop.
  await expect(scanButton(page)).toHaveCount(0)
  await expect(page.getByRole("button", { name: /stop/i })).toBeVisible()
})

test("the card says the score is being calculated, then waits for 'Show them'", async ({
  page,
}) => {
  await scanButton(page).click()
  const card = page.getByTestId("scan-progress-panel")

  // A wait, not a failure — and the previous results stay on screen.
  await expect(card).toContainText(/saving and scoring/i, {
    timeout: 15_000,
  })
  await expect(page.getByText("Code Health")).toBeVisible()
  await expect(page.getByText(/couldn’t load this dashboard/i)).toHaveCount(0)

  await expect(card).toContainText("New results are ready", {
    timeout: 15_000,
  })
  await page.getByRole("button", { name: "Show them" }).click()
  await expect(card).toHaveCount(0)
  await expect(page.getByText("Code Health")).toBeVisible()
  await expect(scanButton(page)).toBeVisible()
})

test("a running scan shows a stage label and a bar that only moves forward", async ({
  page,
}) => {
  await scanButton(page).click()

  const panel = page.getByTestId("scan-progress-panel")
  await expect(panel).toBeVisible()
  // This project has results already: the job is a card above them.
  await expect(panel).toHaveAttribute("data-size", "card")
  await expect(panel.getByRole("status")).toHaveText(
    /Queued|Cloning the repository|Measuring code|Reading git history|Reading comments|Finding debt|Predicting risk|Saving and scoring/,
  )
  // The stepper names all seven steps.
  await expect(
    panel.getByRole("list", { name: "Scan steps" }).getByRole("listitem"),
  ).toHaveCount(7)

  const seen: number[] = []
  for (let i = 0; i < 100; i += 1) {
    const value = await page.evaluate(
      () =>
        document
          .querySelector(
            '[data-testid="scan-progress-panel"] [role="progressbar"]',
          )
          ?.getAttribute("aria-valuenow") ?? "gone",
    )
    if (value === "gone") break
    seen.push(Number(value))
    await page.waitForTimeout(100)
  }
  expect(seen.length).toBeGreaterThan(3)
  for (let i = 1; i < seen.length; i += 1) {
    expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]!)
  }

  // Then the score, in the same place, and the report is back.
  await expect(page.getByText("Code Health")).toBeVisible({ timeout: 15_000 })
})
