import { DEMO_REPO_ID, SECOND_REPO_ID, test, expect } from "./session"

// The shell: the left rail, and the promise that nothing on screen points at a
// feature we cannot demonstrate.

test.beforeEach(async ({ page }) => {
  await page.goto("/projects")
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible()
})

const repoRows = (page: import("@playwright/test").Page) =>
  page
    .getByRole("list", { name: /connected repositories/i })
    .getByRole("listitem")

const rail = (page: import("@playwright/test").Page) =>
  page.locator('[data-slot="sidebar"]').first()

const railLink = (page: import("@playwright/test").Page, name: string) =>
  rail(page).getByRole("link", { name, exact: true })

test("the rail carries exactly the four v1 destinations", async ({ page }) => {
  for (const label of ["Projects", "Dashboard", "Scan History", "Profiles"]) {
    await expect(railLink(page, label)).toBeVisible()
  }
  await expect(rail(page)).toBeVisible()
})

test("J3.5 — no Team entry and no v2 badge anywhere", async ({ page }) => {
  // An evaluator reads a nav item as a promise, and this one pointed at a page
  // whose entire content was "Coming in v2".
  await expect(page.getByRole("link", { name: "Team" })).toHaveCount(0)
  await expect(page.getByText("v2", { exact: true })).toHaveCount(0)
})

test("/team no longer exists as a route", async ({ page }) => {
  const response = await page.goto("/team")
  // Deleted, not merely unlinked — a bookmarked URL must not still render it.
  expect(response?.status()).toBe(404)
})

test("each rail link reaches its screen", async ({ page }) => {
  await railLink(page, "Profiles").click()
  await expect(page).toHaveURL(/\/profiles$/)
  await expect(page.getByRole("heading", { name: "Profiles" })).toBeVisible()

  await railLink(page, "Dashboard").click()
  await expect(page).toHaveURL(new RegExp(`/dashboard/${DEMO_REPO_ID}$`))
  await expect(page.getByText("Code Health")).toBeVisible()

  await railLink(page, "Scan History").click()
  await expect(page).toHaveURL(/\/history$/)

  await railLink(page, "Projects").click()
  await expect(page).toHaveURL(/\/projects$/)
})

test("the rail marks the screen you are actually on", async ({ page }) => {
  await expect(railLink(page, "Projects")).toHaveAttribute(
    "data-active",
    "true",
  )

  await railLink(page, "Profiles").click()
  await expect(railLink(page, "Profiles")).toHaveAttribute(
    "data-active",
    "true",
  )
  await expect(railLink(page, "Projects")).not.toHaveAttribute(
    "data-active",
    "true",
  )
})

test("the desktop rail can be collapsed and expanded visibly", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Collapse sidebar" }).click()
  await expect(
    page.getByRole("button", { name: "Expand sidebar" }),
  ).toBeVisible()

  await page.getByRole("button", { name: "Expand sidebar" }).click()
  await expect(
    page.getByRole("button", { name: "Collapse sidebar" }),
  ).toBeVisible()
})

// ── the two navigation bugs a later re-audit found ─────────────────────

test("the dashboard rows follow the project you are looking at", async ({
  page,
}) => {
  // The rail used to hardcode the demo repository, so opening any other project
  // and clicking "Dashboard" silently swapped you back to acme-payments.
  await page.goto(`/dashboard/${SECOND_REPO_ID}`)

  await railLink(page, "Scan History").click()
  await expect(page).toHaveURL(
    new RegExp(`/dashboard/${SECOND_REPO_ID}/history$`),
  )

  await railLink(page, "Dashboard").click()
  await expect(page).toHaveURL(new RegExp(`/dashboard/${SECOND_REPO_ID}$`))
})

test("away from a dashboard the rows still lead somewhere", async ({
  page,
}) => {
  // /projects has no repository in the URL to read, so the demo id is the
  // fallback — the rows must not go dead.
  await railLink(page, "Dashboard").click()
  await expect(page).toHaveURL(new RegExp(`/dashboard/${DEMO_REPO_ID}$`))
})

test("the selected project survives profiles, dashboard, refresh and history", async ({
  page,
}) => {
  await repoRows(page)
    .filter({ hasText: "web-store" })
    .getByRole("link", { name: /go to dashboard/i })
    .click()
  await expect(page).toHaveURL(new RegExp(`/dashboard/${SECOND_REPO_ID}$`))

  await railLink(page, "Profiles").click()
  await expect(page).toHaveURL(/\/profiles$/)

  await railLink(page, "Dashboard").click()
  await expect(page).toHaveURL(new RegExp(`/dashboard/${SECOND_REPO_ID}$`))

  await railLink(page, "Profiles").click()
  await expect(page).toHaveURL(/\/profiles$/)
  await page.reload()
  await expect(page.getByRole("heading", { name: "Profiles" })).toBeVisible()

  await railLink(page, "Scan History").click()
  await expect(page).toHaveURL(
    new RegExp(`/dashboard/${SECOND_REPO_ID}/history$`),
  )
})

test("below md the rail is reachable at all", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/projects")
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible()

  // At this width the rail is a closed Sheet and Radix has not mounted its
  // contents, so every destination is genuinely absent from the page.
  await expect(page.getByRole("link", { name: "Profiles" })).toBeHidden()

  await page.getByRole("button", { name: "Toggle Sidebar" }).click()
  await page.getByRole("link", { name: "Profiles" }).click()
  await expect(page).toHaveURL(/\/profiles$/)
  await expect(page.getByRole("heading", { name: "Profiles" })).toBeVisible()
})
