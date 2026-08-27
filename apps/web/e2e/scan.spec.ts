import { DEMO_REPO_ID, test, expect } from "./session"

// ────────────────────────────────────────────────────────────────────────────
// Journey 2 — the scan state machine: idle → running → done | cancelled.
//
// The interesting part is that CANCELLATION IS COOPERATIVE. Stop sets a flag and
// returns 202 with the phase still "running"; the client learns the scan really
// stopped from the NEXT poll. A test that asserted "click Stop → idle" would
// pass against a mock that lies and fail against the real backend.
// ────────────────────────────────────────────────────────────────────────────

const scanButton = (page: import("@playwright/test").Page) =>
  page.getByRole("button", { name: /^scan$/i })

/**
 * The scan control's own "Cancelled" label — matched exactly, because the toast
 * says "Scan cancelled" and an unscoped /cancelled/i matches both. The label is
 * the one that matters: it is what stays on screen after the toast fades.
 */
const cancelledLabel = (page: import("@playwright/test").Page) =>
  page.getByText("Cancelled", { exact: true })

test.beforeEach(async ({ page }) => {
  await page.goto(`/dashboard/${DEMO_REPO_ID}`)
  await expect(page.getByText("Code Health")).toBeVisible()
})

test("a scan runs to completion and reports progress on the way", async ({
  page,
}) => {
  await scanButton(page).click()

  // idle → running: the button becomes a live "Scanning… NN%" label.
  await expect(page.getByText(/scanning/i)).toBeVisible()
  await expect(page.getByRole("button", { name: /stop/i })).toBeVisible()

  // …and ends back at an idle Scan button once the phase turns terminal.
  await expect(scanButton(page)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/scanning/i)).toHaveCount(0)
})

test("stopping a scan says Stopping…, then settles on Cancelled — never idle", async ({
  page,
}) => {
  await scanButton(page).click()
  await expect(page.getByText(/scanning/i)).toBeVisible()

  await page.getByRole("button", { name: /stop/i }).click()

  // Cooperative cancellation: the worker only reads the flag between pipeline
  // stages, so there is a real interval where "Stopping…" is the honest answer.
  // Saying so is the difference between "working on it" and "that button is
  // broken".
  await expect(page.getByText(/stopping/i)).toBeVisible()

  // `cancelled` is a DISTINCT terminal phase, not a return to idle — a scan
  // somebody stopped must stay distinguishable from one that never ran.
  await expect(cancelledLabel(page)).toBeVisible({ timeout: 15_000 })
  await expect(scanButton(page)).toBeVisible()
})

test("a cancelled scan leaves the previous results intact", async ({
  page,
}) => {
  await scanButton(page).click()
  await page.getByRole("button", { name: /stop/i }).click()
  await expect(cancelledLabel(page)).toBeVisible({ timeout: 15_000 })

  // FR-6: cancelling must never leave a half-written snapshot, so the dashboard
  // still shows the last good one.
  await expect(page.getByText("Code Health")).toBeVisible()
  await expect(page.getByText("72/100")).toBeVisible()
})

test("a scan can be started again after being cancelled", async ({ page }) => {
  await scanButton(page).click()
  await page.getByRole("button", { name: /stop/i }).click()
  await expect(cancelledLabel(page)).toBeVisible({ timeout: 15_000 })

  await scanButton(page).click()
  await expect(page.getByText(/scanning/i)).toBeVisible()
})

test("the scan control never offers Scan and Stop at the same time", async ({
  page,
}) => {
  await scanButton(page).click()
  await expect(page.getByText(/scanning/i)).toBeVisible()

  // While running, the only write available is Stop. Two live actions on one
  // state machine is how you get a 409 in front of an evaluator.
  await expect(scanButton(page)).toHaveCount(0)
  await expect(page.getByRole("button", { name: /stop/i })).toBeVisible()
})
