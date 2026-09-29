import { DEMO_REPO_ID, expect, test } from "./session"

test("the replayable dashboard lesson follows the selected branch and owns its skip prompt", async ({
  page,
}) => {
  await page.goto("/support")
  await page.getByRole("button", { name: "Learn Dashboard" }).click()

  await expect(page).toHaveURL(new RegExp(`/dashboard/${DEMO_REPO_ID}$`))
  let lesson = page.getByRole("dialog", { name: "Dashboard trial step" })
  await expect(
    lesson.getByRole("heading", { name: "Choose a branch" }),
  ).toBeVisible()
  await expect(page.locator('[data-tour="branch-selector"]')).toHaveAttribute(
    "data-tour-active",
    "true",
  )

  await lesson.getByRole("button", { name: "Next" }).click()
  lesson = page.getByRole("dialog", { name: "Dashboard trial step" })
  await expect(lesson).toContainText("branch you selected")
  await expect(lesson).not.toContainText("main branch")
  await expect(page.locator('[data-tour="scan-action"]')).toHaveAttribute(
    "data-tour-active",
    "true",
  )

  await lesson.getByRole("button", { name: "Close trial" }).click()
  const confirmation = page.getByRole("alertdialog", {
    name: "Skip the entire trial?",
  })
  await expect(confirmation).toBeVisible()
  await expect(lesson).toHaveCount(0)

  await confirmation.getByRole("button", { name: "Keep learning" }).click()
  await expect(
    page.getByRole("dialog", { name: "Dashboard trial step" }),
  ).toBeVisible()
})
