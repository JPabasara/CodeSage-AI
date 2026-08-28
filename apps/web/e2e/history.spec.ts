import { UNSCANNED_REPO_ID, test, expect } from "./session"

// Scan history. This route used to render the word "(Placeholder.)", and it is
// reachable from the rail, so it is a click anyone makes on the way through the
// nav.

test("clicking Scan History in the rail shows real snapshots", async ({
  page,
}) => {
  await page.goto("/projects")
  await page.getByRole("link", { name: "Scan History" }).click()

  await expect(
    page.getByRole("heading", { name: "Scan History" }),
  ).toBeVisible()
  // The placeholder this page replaced.
  await expect(page.getByText("Placeholder")).toHaveCount(0)

  // The fixture carries five stored snapshots; one header row on top of them.
  const rows = page.getByRole("row")
  await expect(rows).toHaveCount(6)

  // Newest first, so the first body row is the latest commit.
  await expect(rows.nth(1).getByText("a1b2c3d")).toBeVisible()
})

test("an unscanned repository says so instead of showing an empty table", async ({
  page,
}) => {
  await page.goto(`/dashboard/${UNSCANNED_REPO_ID}/history`)

  await expect(page.getByText(/no scans yet/i)).toBeVisible()
  await expect(page.getByRole("table")).toHaveCount(0)
  await page.getByRole("link", { name: "Go to dashboard" }).click()
  await expect(page).toHaveURL(new RegExp(`/dashboard/${UNSCANNED_REPO_ID}$`))
})
