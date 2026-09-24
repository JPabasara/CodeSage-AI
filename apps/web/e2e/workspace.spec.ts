import { test as base } from "@playwright/test"

import { DEMO_REPO_ID, SECOND_REPO_ID, test, expect } from "./session"

// Workspaces: the container everything else in the app belongs to.
//
// Two journeys matter most here and neither is about a single screen. One is
// arriving with no workspace at all — a real signed-in state that used to be
// indistinguishable from signed out. The other is switching: every project,
// profile and permission on screen has to change together, with nothing from
// the workspace you left surviving the move.

const SESSION_COOKIE =
  process.env.NEXT_PUBLIC_SESSION_COOKIE_NAME ?? "codesage_session"

/** Signed in, and deliberately without a workspace. */
const onboarding = base.extend({
  page: async ({ page, baseURL }, runTest) => {
    const url = baseURL ?? "http://localhost:3101"
    await page.context().addCookies([
      { name: SESSION_COOKIE, value: "e2e-seeded-session", url },
      { name: "codesage_e2e_workspace", value: "none", url },
    ])
    await runTest(page)
  },
})

const rail = (page: import("@playwright/test").Page) =>
  page.locator('[data-slot="sidebar"]').first()

/** The page itself. The rail names the workspace too, so "is it on screen?"
 *  has to say where — otherwise every assertion matches twice. */
const main = (page: import("@playwright/test").Page) =>
  page.locator("#main-content")

/** The deep-mint app bar: brand, workspace, project, account. */
const topBar = (page: import("@playwright/test").Page) =>
  page.getByTestId("app-top-bar")

const switcher = (page: import("@playwright/test").Page) =>
  topBar(page).getByRole("combobox", { name: /^Workspace:/ })

const repoRows = (page: import("@playwright/test").Page) =>
  page
    .getByRole("list", { name: /connected repositories/i })
    .getByRole("listitem")

async function switchTo(page: import("@playwright/test").Page, name: string) {
  await switcher(page).click()
  await page.getByRole("option", { name: new RegExp(name) }).click()
}

// ── arriving with nothing ───────────────────────────────────────────────────

onboarding(
  "a signed-in user with no workspace lands in the app, on a friendly card",
  async ({ page }) => {
    // Every workspace-bound request would answer 409; none may be sent.
    const refused: string[] = []
    page.on("response", (response) => {
      if (response.status() === 409) refused.push(response.url())
    })

    await page.goto("/projects")

    // Not /login (they would sign in again and land here again), and no longer
    // a separate onboarding screen before the product.
    await expect(page).toHaveURL(/\/projects$/)
    await expect(
      main(page).getByRole("heading", {
        name: /create a workspace to connect repositories/i,
      }),
    ).toBeVisible()
    await expect(main(page).getByText(/invited to a team\?/i)).toBeVisible()
    await expect(
      rail(page).getByRole("link", {
        name: /profiles.*create a workspace first/i,
      }),
    ).toBeVisible()

    // Every page is locked the same calm way, never with an error state.
    await rail(page)
      .getByRole("link", { name: /profiles/i })
      .click()
    await expect(
      main(page).getByRole("heading", { name: /belong to a workspace/i }),
    ).toBeVisible()
    await expect(main(page).getByText(/couldn.t load/i)).toHaveCount(0)
    expect(refused).toEqual([])
  },
)

onboarding(
  "creating the first workspace fills the page in place, as its org-admin",
  async ({ page }) => {
    await page.goto("/profiles")
    await main(page).getByRole("button", { name: "Create workspace" }).click()
    const dialog = page.getByRole("dialog")
    await dialog.getByLabel(/workspace name/i).fill("Fresh Start")
    await dialog.getByLabel(/description/i).fill("Our first workspace.")
    await dialog.getByRole("button", { name: "Create workspace" }).click()

    // Same page, now with its real content: the three built-in profiles.
    await expect(page).toHaveURL(/\/profiles$/)
    await expect(main(page).getByText("Balanced").first()).toBeVisible()
    await expect(topBar(page).getByText("Fresh Start")).toBeVisible()
    await expect(topBar(page).getByText("Org admin")).toBeVisible()
    await expect(
      rail(page).getByRole("link", { name: /create a workspace first/i }),
    ).toHaveCount(0)

    // No repository is created with a workspace.
    await rail(page)
      .getByRole("link", { name: /projects/i })
      .click()
    await expect(page.getByText(/no repositories connected/i)).toBeVisible()

    // A page about one project says how to get one, rather than erroring.
    await rail(page)
      .getByRole("link", { name: "Dashboard", exact: true })
      .click()
    await expect(page).toHaveURL(/\/dashboard$/)
    await expect(
      main(page).getByRole("heading", {
        name: /connect a repository to see its dashboard/i,
      }),
    ).toBeVisible()
  },
)

onboarding(
  "the old onboarding addresses forward into the app",
  async ({ page }) => {
    await page.goto("/onboarding/workspace")
    await expect(page).toHaveURL(/\/projects$/)
  },
)

// ── the workspace screen ────────────────────────────────────────────────────

test("the Workspace tab shows the workspace, the role and the counts", async ({
  page,
}) => {
  await page.goto("/workspace")

  await expect(
    page.getByRole("heading", { name: "Acme Engineering" }),
  ).toBeVisible()
  await expect(main(page).getByText("Org admin")).toBeVisible()
  await expect(page.getByTestId("workspace-project-count")).toHaveText("3")
})

test("an org-admin edits the workspace, and the new name is used everywhere", async ({
  page,
}) => {
  await page.goto("/workspace")
  const name = page.getByLabel(/workspace name/i)
  await name.fill("Acme Platform")
  await page.getByRole("button", { name: "Save changes" }).click()

  await expect(
    page.getByRole("heading", { name: "Acme Platform" }),
  ).toBeVisible()
  // The rail and the Projects page read the same workspace, so the rename is
  // visible wherever the workspace is named.
  await expect(topBar(page).getByText("Acme Platform")).toBeVisible()
  await page.goto("/projects")
  await expect(main(page).getByText("Acme Platform")).toBeVisible()
})

// ── switching ───────────────────────────────────────────────────────────────

test("switching workspace replaces the projects and leaves nothing behind", async ({
  page,
}) => {
  await page.goto("/projects")
  await expect(repoRows(page)).toHaveCount(3)
  // Scoped to the rows: the header's "Active project" chip names a repository
  // too, and a bare text match would find both.
  await expect(repoRows(page).getByText("acme-payments")).toBeVisible()

  await switchTo(page, "Nimbus Labs")

  await expect(page).toHaveURL(/\/projects$/)
  await expect(topBar(page).getByText("Nimbus Labs")).toBeVisible()
  await expect(repoRows(page)).toHaveCount(1)
  await expect(repoRows(page).getByText("nimbus-gateway")).toBeVisible()
  // Not one row, and not one name, from the workspace we just left — anywhere
  // on the page, including the header chips.
  await expect(page.getByText("acme-payments")).toHaveCount(0)
  await expect(page.getByText("web-store")).toHaveCount(0)
})

test("the role travels with the workspace, and so do the controls", async ({
  page,
}) => {
  await page.goto("/projects")
  // org-admin in Acme: connecting is offered.
  await expect(page.getByLabel(/repository url/i)).toBeVisible()

  await switchTo(page, "Nimbus Labs")

  // viewer in Nimbus: it is not, and the page says why rather than failing on
  // the attempt.
  await expect(page.getByLabel(/repository url/i)).toHaveCount(0)
  await expect(
    page.getByText(/needs the manager or org-admin role/i),
  ).toBeVisible()

  await page.goto("/profiles")
  await expect(page.getByRole("button", { name: /new profile/i })).toHaveCount(
    0,
  )
  await expect(
    page.getByText(/needs the manager or org-admin role/i),
  ).toBeVisible()
})

test("each workspace keeps its own profile pool", async ({ page }) => {
  await page.goto("/profiles")
  // Author one in Acme, and make it the default.
  await page.getByRole("button", { name: /duplicate balanced/i }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByLabel("Name").fill("Acme only")
  await dialog.getByRole("button", { name: "Create profile" }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByTestId("custom-count")).toHaveText("1 of 5")

  await switchTo(page, "Nimbus Labs")
  await page.goto("/profiles")

  // Nimbus has its own three built-ins and none of Acme's work.
  await expect(page.getByTestId("custom-count")).toHaveText("0 of 5")
  await expect(page.getByText("Acme only")).toHaveCount(0)
  await expect(page.getByTestId("workspace-default-name")).toHaveText(
    "Balanced",
  )
})

test("a workspace remembers its own project, and never the other's", async ({
  page,
}) => {
  // Acme is left on its second repository.
  await page.goto(`/dashboard/${SECOND_REPO_ID}`)
  await expect(page.getByText("Code Health")).toBeVisible()

  await switchTo(page, "Nimbus Labs")
  // Nimbus has never been opened, so it starts at its own Projects page rather
  // than at a dashboard for a repository it does not have.
  await expect(page).toHaveURL(/\/projects$/)
  await expect(repoRows(page).getByText("nimbus-gateway")).toBeVisible()

  await switchTo(page, "Acme Engineering")
  // …and Acme comes back to where it was.
  await expect(page).toHaveURL(new RegExp(`/dashboard/${SECOND_REPO_ID}$`))
})

// ── the project selector ────────────────────────────────────────────────────

test("the dashboard's project selector changes the URL and the data", async ({
  page,
}) => {
  await page.goto(`/dashboard/${DEMO_REPO_ID}?snapshot_id=stale`)
  await expect(page.getByText("Code Health")).toBeVisible()

  await topBar(page)
    .getByRole("combobox", { name: /^Project:/ })
    .click()
  await page.getByRole("option", { name: /web-store/ }).click()

  // A bare dashboard URL: the snapshot id belonged to the project being left,
  // and asking this one for it would be asking for another project's row.
  await expect(page).toHaveURL(new RegExp(`/dashboard/${SECOND_REPO_ID}$`))
  await expect(
    topBar(page).getByRole("combobox", { name: "Project: web-store" }),
  ).toBeVisible()
})

test("the project selector offers only the active workspace's projects", async ({
  page,
}) => {
  await page.goto(`/dashboard/${DEMO_REPO_ID}`)
  await topBar(page)
    .getByRole("combobox", { name: /^Project:/ })
    .click()

  await expect(page.getByRole("option", { name: /web-store/ })).toBeVisible()
  await expect(page.getByRole("option", { name: /nimbus/i })).toHaveCount(0)
})

// ── layout ──────────────────────────────────────────────────────────────────

for (const [label, width, height] of [
  ["desktop", 1280, 720],
  ["mobile", 390, 844],
] as const) {
  test(`the workspace selectors fit at ${label} without scrolling sideways`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height })
    await page.goto("/workspace")
    await expect(
      page.getByRole("heading", { name: "Acme Engineering" }),
    ).toBeVisible()

    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    )
    expect(overflow, `${label} horizontal overflow`).toBeLessThanOrEqual(0)
  })
}
