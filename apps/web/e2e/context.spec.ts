import { DEMO_REPO_ID, SECOND_REPO_ID, expect, test } from "./session"

// Page context and memory (Phase 13D): choose a project and a branch once, and
// every page keeps to them — across pages, a refresh and a workspace switch.

const topBar = (page: import("@playwright/test").Page) =>
  page.getByTestId("app-top-bar")
const railLink = (page: import("@playwright/test").Page, name: string) =>
  page.locator('[data-slot="sidebar"]').getByRole("link", { name, exact: true })

async function pick(
  page: import("@playwright/test").Page,
  control: RegExp | string,
  option: RegExp | string,
) {
  await topBar(page).getByRole("combobox", { name: control }).click()
  await page.getByRole("option", { name: option }).click()
}

test("a project and branch chosen once are kept everywhere", async ({
  page,
}) => {
  await page.goto(`/dashboard/${DEMO_REPO_ID}`)
  await pick(page, /^Project:/, /web-store/)
  await expect(page).toHaveURL(new RegExp(`/dashboard/${SECOND_REPO_ID}$`))
  await pick(page, "Branch", "develop")
  await expect(page).toHaveURL(/branch=develop/)

  const project = topBar(page).getByRole("combobox", { name: /^Project:/ })
  const branch = topBar(page).getByRole("combobox", { name: "Branch" })

  // History, Profiles and Projects, then back to the Dashboard from the rail.
  await railLink(page, "Scan History").click()
  await expect(page).toHaveURL(
    new RegExp(`/dashboard/${SECOND_REPO_ID}/history$`),
  )
  await expect(project).toHaveAccessibleName("Project: web-store")
  await railLink(page, "Profiles").click()
  await expect(project).toHaveAccessibleName("Project: web-store")
  await railLink(page, "Projects").click()
  await railLink(page, "Dashboard").click()
  await expect(page).toHaveURL(new RegExp(`/dashboard/${SECOND_REPO_ID}$`))
  await expect(branch).toHaveText(/develop/)

  // A refresh keeps both.
  await page.reload()
  await expect(branch).toHaveText(/develop/)

  // Away to another workspace and back: restored, not reset.
  await pick(page, /^Workspace:/, /Nimbus Labs/)
  await expect(
    topBar(page).getByRole("combobox", { name: "Workspace: Nimbus Labs" }),
  ).toBeVisible()
  await pick(page, /^Workspace:/, /Acme Engineering/)
  await expect(page).toHaveURL(new RegExp(`/dashboard/${SECOND_REPO_ID}$`))
  await expect(branch).toHaveText(/develop/)
})

test("Scan History filters by branch, and each row names its branch", async ({
  page,
}) => {
  await page.goto(`/dashboard/${DEMO_REPO_ID}/history`)
  const filter = page.getByRole("combobox", { name: "Filter by branch" })
  await expect(filter).toHaveText(/All branches/)
  await filter.click()
  await page.getByRole("option", { name: "develop" }).click()
  await expect(page.getByRole("row").nth(1)).toContainText("develop")
})
