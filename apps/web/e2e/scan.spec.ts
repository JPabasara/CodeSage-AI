import { DEMO_REPO_ID, test, expect } from "./session"

// The scan state machine: idle → running → done | cancelled.
//
// Cancellation is cooperative: Stop sets a flag and returns 202 with the phase
// still "running", and the client learns the scan really stopped from the next
// poll. A test asserting "click Stop → idle" would pass against a mock that lies
// and fail against the real backend.

const scanButton = (page: import("@playwright/test").Page) =>
  page.getByRole("button", { name: /^scan$/i })

/**
 * The VISIBLE "Scanning… NN%" label.
 *
 * Not `/scanning/i`: the control also renders a screen-reader announcement
 * reading "Scanning, NN percent complete" (U-9), so the loose pattern resolves
 * to two elements. The two are deliberately worded differently — one is read,
 * one is spoken — and the ellipsis is what tells them apart.
 */
const scanningLabel = (page: import("@playwright/test").Page) =>
  page.getByText(/scanning…/i)

/** The visible "Stopping…" label, for the same reason. */
const stoppingLabel = (page: import("@playwright/test").Page) =>
  page.getByTestId("app-top-bar").getByText("Stopping…", { exact: true })

/**
 * How a stopped scan ends (Phase 13E): the toast says it stopped and that the
 * previous results are unchanged, with Try again — a stopped scan is still told
 * apart from one that never ran.
 */
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

  // idle → running: the button becomes a live "Scanning… NN%" label.
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

  // Cooperative cancellation: the worker only reads the flag between pipeline
  // stages, so there is a real interval where "Stopping…" is the honest answer.
  // Saying so is the difference between "working on it" and "that button is
  // broken".
  await expect(stoppingLabel(page)).toBeVisible()

  // `cancelled` is a DISTINCT terminal phase, not a return to idle — a scan
  // somebody stopped must stay distinguishable from one that never ran.
  await expect(cancelledLabel(page)).toBeVisible({ timeout: 15_000 })
  await expect(scanButton(page)).toBeVisible()
})

test("a cancelled scan leaves the previous results intact", async ({
  page,
}) => {
  await scanButton(page).click()
  await page.getByRole("button", { name: "Stop", exact: true }).click()
  await expect(cancelledLabel(page)).toBeVisible({ timeout: 15_000 })

  // Cancelling must never leave a half-written snapshot, so the dashboard still
  // shows the last good one.
  await expect(page.getByText("Code Health")).toBeVisible()
  await expect(page.getByText("72/100")).toBeVisible()
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

  // While running, the only write available is Stop. Two live actions on one
  // state machine is how you get a 409 in the middle of a demo.
  await expect(scanButton(page)).toHaveCount(0)
  await expect(page.getByRole("button", { name: /stop/i })).toBeVisible()
})

// ── the score is computed after the scan (#109) ──────────────────────────────
//
// The API stores the snapshot when the scan finishes and scores it in a
// background task, so the read taken at that moment answers 503 SCORE_PENDING.
// The mock backend reproduces that window deliberately: without it this path is
// dead code everywhere except production.

test("the card says the score is being calculated, then waits for 'Show them'", async ({
  page,
}) => {
  await scanButton(page).click()
  const card = page.getByTestId("scan-progress-panel")

  // A wait, not a failure — and the previous results stay on screen.
  await expect(card).toContainText(/calculating your health score/i, {
    timeout: 15_000,
  })
  await expect(page.getByText("Code Health")).toBeVisible()
  await expect(page.getByText(/couldn’t load this dashboard/i)).toHaveCount(0)

  // Ready: nothing swaps by itself; one click shows the new results.
  await expect(card).toContainText("New results are ready", {
    timeout: 15_000,
  })
  await page.getByRole("button", { name: "Show them" }).click()
  await expect(card).toHaveCount(0)
  await expect(page.getByText("Code Health")).toBeVisible()
  await expect(scanButton(page)).toBeVisible()
})

// 13H.4: the middle of the dashboard shows the scan's stage, a friendly line
// and a bar that only ever moves forward.
test("a running scan shows a stage label and a bar that only moves forward", async ({
  page,
}) => {
  await scanButton(page).click()

  const panel = page.getByTestId("scan-progress-panel")
  await expect(panel).toBeVisible()
  // This project has results already: the job is a compact card above them.
  await expect(panel).toHaveAttribute("data-size", "compact")
  await expect(panel.getByRole("status")).toHaveText(
    /Waiting for a free scan slot|Cloning repository|Reading 1,240 Java files|Finding debt|Scoring risk|Saving the results|Almost there|Calculating your health score/,
  )
  await expect(page.getByTestId("scan-panel-line")).not.toBeEmpty()

  // Sample the bar while the scan runs: never a step backwards. Read from
  // the DOM directly, so a panel that has just gone ends the loop at once.
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
