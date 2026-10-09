import { DEMO_REPO_ID, SECOND_REPO_ID, test, expect } from "./session"

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

test("the rail carries every destination this release has", async ({
  page,
}) => {
  for (const label of [
    "Overview",
    "Projects",
    "Scoring profiles",
    "Team & settings",
    "Dashboard",
    "Scan history",
    "Support",
  ]) {
    await expect(railLink(page, label)).toBeVisible()
  }

  await expect(railLink(page, "Support")).toHaveAttribute("href", "/help")
  await expect(rail(page)).toBeVisible()
})

test("J3.5 — no Team entry and no v2 badge anywhere", async ({ page }) => {
  await expect(
    page.getByRole("link", { name: "Team", exact: true }),
  ).toHaveCount(0)
  await expect(page.getByText("v2", { exact: true })).toHaveCount(0)
})

test("/team no longer exists as a route", async ({ page }) => {
  const response = await page.goto("/team")
  // Deleted, not merely unlinked — a bookmarked URL must not still render it.
  expect(response?.status()).toBe(404)
})

test("each rail link reaches its screen", async ({ page }) => {
  await railLink(page, "Scoring profiles").click()
  await expect(page).toHaveURL(/\/profiles$/)
  await expect(page.getByRole("heading", { name: "Profiles" })).toBeVisible()

  await railLink(page, "Dashboard").click()
  await expect(page).toHaveURL(new RegExp(`/dashboard/${DEMO_REPO_ID}$`))
  await expect(page.getByText("Code Health")).toBeVisible()

  await railLink(page, "Scan history").click()
  await expect(page).toHaveURL(/\/history$/)

  await railLink(page, "Projects").click()
  await expect(page).toHaveURL(/\/projects$/)
})

test("the rail marks the screen you are actually on", async ({ page }) => {
  await expect(railLink(page, "Projects")).toHaveAttribute(
    "data-active",
    "true",
  )

  await railLink(page, "Scoring profiles").click()
  await expect(railLink(page, "Scoring profiles")).toHaveAttribute(
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

test("every collapsed rail icon names itself on hover and stays clickable", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Collapse sidebar" }).click()
  await expect(
    page.getByRole("button", { name: "Expand sidebar" }),
  ).toBeVisible()

  // A hidden group label once sat over the last icon of the group above it.
  for (const label of [
    "Overview",
    "Projects",
    "Scoring profiles",
    "Team & settings",
    "Dashboard",
    "Scan history",
  ]) {
    const link = railLink(page, label)
    // Fails if anything sits on top of the icon.
    await link.hover()
    // Radix ignores the first moves after leaving another tooltip; a real
    // mouse sends many, so send a few.
    const box = (await link.boundingBox())!
    await page.mouse.move(box.x + 8, box.y + 8, { steps: 4 })
    await expect(page.getByRole("tooltip", { name: label })).toBeVisible()
  }

  await railLink(page, "Team & settings").click()
  await expect(page).toHaveURL(/\/workspace$/)
})

test("the dashboard rows follow the project you are looking at", async ({
  page,
}) => {
  await page.goto(`/dashboard/${SECOND_REPO_ID}`)

  await railLink(page, "Scan history").click()
  await expect(page).toHaveURL(
    new RegExp(`/dashboard/${SECOND_REPO_ID}/history$`),
  )

  await railLink(page, "Dashboard").click()
  await expect(page).toHaveURL(new RegExp(`/dashboard/${SECOND_REPO_ID}$`))
})

test("away from a dashboard the rows still lead somewhere", async ({
  page,
}) => {
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

  await railLink(page, "Scoring profiles").click()
  await expect(page).toHaveURL(/\/profiles$/)

  await railLink(page, "Dashboard").click()
  await expect(page).toHaveURL(new RegExp(`/dashboard/${SECOND_REPO_ID}$`))

  await railLink(page, "Scoring profiles").click()
  await expect(page).toHaveURL(/\/profiles$/)
  await page.reload()
  await expect(page.getByRole("heading", { name: "Profiles" })).toBeVisible()

  await railLink(page, "Scan history").click()
  await expect(page).toHaveURL(
    new RegExp(`/dashboard/${SECOND_REPO_ID}/history$`),
  )
})

test("below md the rail is reachable at all", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/projects")
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible()

  await expect(
    page.getByRole("link", { name: "Scoring profiles" }),
  ).toBeHidden()

  await page.getByRole("button", { name: "Toggle Sidebar" }).click()
  await page.getByRole("link", { name: "Scoring profiles" }).click()
  await expect(page).toHaveURL(/\/profiles$/)
  await expect(page.getByRole("heading", { name: "Profiles" })).toBeVisible()
})
