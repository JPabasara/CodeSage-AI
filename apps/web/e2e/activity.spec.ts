import { DEMO_REPO_ID, expect, test } from "./session"

// The Activity menu and the profile labels: what is running is visible from
// every page, and every score says which profile weighed it.

const activity = (page: import("@playwright/test").Page) =>
  page.getByTestId("activity-trigger")

test("a profile change shows as re-scoring in Activity, then clears by itself", async ({
  page,
}) => {
  await page.goto("/profiles")
  await expect(page.getByRole("heading", { name: "Profiles" })).toBeVisible()
  // Nothing running yet: no Activity menu at all.
  await expect(activity(page)).toHaveCount(0)

  const pool = page.getByRole("list", { name: /workspace profile pool/i })
  await pool
    .getByRole("listitem")
    .filter({ hasText: "Security-first" })
    .first()
    .getByRole("button", { name: "Security-first" })
    .first()
    .click()
  await page.getByRole("button", { name: /set as workspace default/i }).click()

  // Everyone sees it: the projects inheriting the default are re-scored.
  await expect(activity(page)).toHaveText(/running|Re-scoring/)
  await activity(page).click()
  await expect(
    page.getByText(/Re-scoring under the current profile/).first(),
  ).toBeVisible()
  await page.keyboard.press("Escape")

  // The re-score ends on its own, and the menu goes away with it.
  await expect(activity(page)).toHaveCount(0, { timeout: 30_000 })
})

test("the dashboard and Scan History say which profile scored them", async ({
  page,
}) => {
  await page.goto(`/dashboard/${DEMO_REPO_ID}`)
  await expect(page.getByText("Code Health")).toBeVisible()
  const chip = page.getByTestId("scored-with")
  await expect(chip).toHaveText("Scored with Balanced")
  await expect(chip).toHaveAttribute("href", "/profiles")

  await page.goto(`/dashboard/${DEMO_REPO_ID}/history`)
  await expect(page.getByTestId("history-profile")).toContainText(
    "All scans are shown under the Balanced profile",
  )
})
