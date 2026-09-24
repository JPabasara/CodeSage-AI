import { DEMO_REPO_ID, SECOND_REPO_ID, test, expect } from "./session"

// The profiles journey: author a profile, choose what it applies to, and prove
// the two scopes stay separate — a workspace default every project inherits, and
// one project's own override that leaves the others alone.
//
// The negative half matters as much: a profile change writes no snapshot and
// starts no scan, and the only way to prove a negative like that is to watch the
// network and assert the request never happened.

/** Count the requests a journey makes, so "nothing was scanned" is checkable. */
function watchRequests(page: import("@playwright/test").Page) {
  const seen: string[] = []
  page.on("request", (req) =>
    seen.push(`${req.method()} ${new URL(req.url()).pathname}`),
  )
  return {
    scans: () => seen.filter((r) => /^POST .*\/scan$/.test(r)),
    profileWrites: () =>
      seen.filter((r) => /^(POST|PATCH|PUT|DELETE) .*\/api\/profiles/.test(r)),
  }
}

const findingCards = (page: import("@playwright/test").Page) =>
  page
    .getByRole("list", { name: /ranked refactor findings/i })
    .getByRole("button")

const pool = (page: import("@playwright/test").Page) =>
  page.getByRole("list", { name: /workspace profile pool/i })

/** The card for one profile, addressed the way a person does: by its name. */
const card = (page: import("@playwright/test").Page, name: string) =>
  pool(page).getByRole("listitem").filter({ hasText: name }).first()

const selectProfile = async (
  page: import("@playwright/test").Page,
  name: string,
) => card(page, name).getByRole("button", { name }).first().click()

/** Author one custom profile from Balanced, and leave it selected. */
async function createProfile(
  page: import("@playwright/test").Page,
  name: string,
) {
  await page.getByRole("button", { name: /duplicate balanced/i }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByLabel("Name").fill(name)
  await dialog.getByRole("button", { name: "Create profile" }).click()
  await expect(dialog).toBeHidden()
  await expect(card(page, name)).toBeVisible()
}

test.beforeEach(async ({ page }) => {
  await page.goto("/profiles")
  await expect(page.getByRole("heading", { name: "Profiles" })).toBeVisible()
})

test("the pool opens on the three built-ins, with Balanced the default", async ({
  page,
}) => {
  await expect(pool(page).getByRole("listitem")).toHaveCount(3)
  await expect(
    card(page, "Balanced").getByText("Workspace default"),
  ).toBeVisible()
  await expect(page.getByTestId("workspace-default-name")).toHaveText(
    "Balanced",
  )
  // Built-ins do not count toward the five-custom limit.
  await expect(page.getByTestId("custom-count")).toHaveText("0 of 5")
})

test("there are exactly five category weights, plus the trust slider", async ({
  page,
}) => {
  // Five categories — not four, and not the six an earlier shape had.
  for (const label of [
    "Security",
    "Code design",
    "Requirement",
    "Documentation",
    "Test",
  ]) {
    await expect(
      page.getByRole("slider", { name: `${label} weight` }),
    ).toBeVisible()
  }
  await expect(page.getByRole("slider", { name: "Trust slider" })).toBeVisible()
  await expect(page.getByRole("slider")).toHaveCount(6)
})

test("a built-in is read-only, and duplicating it is the way to change it", async ({
  page,
}) => {
  const balanced = card(page, "Balanced")
  await expect(balanced.getByRole("button", { name: /^Edit/ })).toHaveCount(0)
  await expect(balanced.getByRole("button", { name: /^Delete/ })).toHaveCount(0)

  await selectProfile(page, "Balanced")
  await expect(
    page.getByRole("slider", { name: "Security weight" }),
  ).toHaveAttribute("aria-disabled", "true")
  await expect(
    balanced.getByRole("button", { name: /^Duplicate/ }),
  ).toBeVisible()
})

test("a custom profile is created, edited, and made the workspace default", async ({
  page,
}) => {
  const requests = watchRequests(page)
  await createProfile(page, "Release gate")

  // Created, but not in force: authoring a profile and choosing the one that
  // applies are separate, deliberate acts.
  await expect(page.getByTestId("workspace-default-name")).toHaveText(
    "Balanced",
  )
  await expect(page.getByTestId("custom-count")).toHaveText("1 of 5")

  // Edit it. Nothing is sent while the slider moves — only Save writes.
  await selectProfile(page, "Release gate")
  const slider = page.getByRole("slider", { name: "Security weight" })
  await slider.focus()
  for (let i = 0; i < 5; i++) await slider.press("ArrowRight")
  await expect(page.getByTestId("value-security")).toHaveText("1.5")
  await expect(page.getByTestId("unsaved-badge")).toBeVisible()
  expect(requests.profileWrites()).toHaveLength(1) // the create, and nothing else

  await page.getByRole("button", { name: "Save changes" }).click()
  await expect(page.getByTestId("unsaved-badge")).toBeHidden()

  await page.getByRole("button", { name: /set as workspace default/i }).click()
  await expect(page.getByTestId("workspace-default-name")).toHaveText(
    "Release gate",
  )
  // Exactly one default: the badge moved rather than being added.
  await expect(
    card(page, "Balanced").getByText("Workspace default"),
  ).toHaveCount(0)
  // None of it read a line of code.
  expect(requests.scans()).toHaveLength(0)
})

test("out-of-range values come back clamped, and the sliders adopt what was stored", async ({
  page,
}) => {
  await createProfile(page, "Release gate")
  await selectProfile(page, "Release gate")

  const slider = page.getByRole("slider", { name: "Security weight" })
  await slider.focus()
  // Drive it past the 3.0 maximum; the client clamp holds it at the bound and
  // the server would clamp it again anyway — the server is the enforcement point.
  for (let i = 0; i < 40; i++) await slider.press("ArrowRight")
  await page.getByRole("button", { name: "Save changes" }).click()

  await expect(page.getByTestId("value-security")).toHaveText("3.0")
  await expect(page.getByTestId("unsaved-badge")).toBeHidden()
})

test("the sixth custom profile is refused, with the count on screen", async ({
  page,
}) => {
  for (const name of ["One", "Two", "Three", "Four", "Five"]) {
    await createProfile(page, name)
  }

  await expect(page.getByTestId("custom-count")).toHaveText("5 of 5")
  await expect(
    page.getByRole("button", { name: /new profile/i }),
  ).toBeDisabled()
  await expect(
    page.getByText(/delete one before creating another/i),
  ).toBeVisible()
})

test("an unused custom profile is deleted; one in use is not", async ({
  page,
}) => {
  await createProfile(page, "Release gate")

  // Give it to a project first: an in-use profile cannot be deleted.
  await page.getByRole("tab", { name: /project profile/i }).click()
  await selectProfile(page, "Release gate")
  await page.getByRole("button", { name: /use for this project/i }).click()
  await expect(page.getByTestId("effective-summary")).toContainText(
    "an override for this project alone",
  )

  await page.getByRole("button", { name: /delete release gate/i }).click()
  await page.getByRole("button", { name: "Delete profile" }).click()
  await expect(page.getByText(/change those selections first/i)).toBeVisible()
  await page.getByRole("button", { name: "Cancel" }).click()
  await expect(card(page, "Release gate")).toBeVisible()

  // Move the reference away, and the same delete succeeds.
  await page.getByRole("button", { name: /clear override/i }).click()
  await expect(page.getByTestId("effective-summary")).toContainText(
    "inherited from the workspace default",
  )
  await page.getByRole("button", { name: /delete release gate/i }).click()
  await page.getByRole("button", { name: "Delete profile" }).click()
  await expect(card(page, "Release gate")).toHaveCount(0)
  await expect(page.getByTestId("custom-count")).toHaveText("0 of 5")
})

test("one project's override leaves every other project inheriting", async ({
  page,
}) => {
  const requests = watchRequests(page)

  await page.getByRole("tab", { name: /project profile/i }).click()
  await expect(page.getByTestId("effective-summary")).toContainText(
    "acme/acme-payments",
  )
  await expect(page.getByTestId("effective-summary")).toContainText(
    "Balanced, inherited from the workspace default",
  )

  await selectProfile(page, "Security-first")
  await page.getByRole("button", { name: /use for this project/i }).click()
  await expect(page.getByTestId("effective-summary")).toContainText(
    "Security-first, an override for this project alone",
  )

  // The second project is untouched by the first one's choice.
  await page.getByRole("combobox", { name: "Project", exact: true }).click()
  await page.getByRole("option", { name: "acme/web-store" }).click()
  await expect(page.getByTestId("effective-summary")).toContainText(
    "Balanced, inherited from the workspace default",
  )

  // And the dashboards agree: the overridden project is scored with
  // Security-first, its neighbour with the default.
  await page.goto(`/dashboard/${DEMO_REPO_ID}`)
  await expect(page.getByText("36/100")).toBeVisible()
  await page.goto(`/dashboard/${SECOND_REPO_ID}`)
  await expect(page.getByText("36/100")).toHaveCount(0)

  // All of that, and nothing was scanned.
  expect(requests.scans()).toHaveLength(0)
})

test("clearing an override puts the project back on the default", async ({
  page,
}) => {
  await page.getByRole("tab", { name: /project profile/i }).click()
  await selectProfile(page, "Delivery-speed")
  await page.getByRole("button", { name: /use for this project/i }).click()
  await expect(page.getByTestId("effective-summary")).toContainText(
    "Delivery-speed, an override",
  )

  await page.getByRole("button", { name: /clear override/i }).click()
  await expect(page.getByTestId("effective-summary")).toContainText(
    "Balanced, inherited from the workspace default",
  )
  // Clearing removes the override; it does not touch the workspace default.
  await expect(page.getByTestId("workspace-default-name")).toHaveText(
    "Balanced",
  )
})

test("the whole create dialog is operable from the keyboard", async ({
  page,
}) => {
  await page.getByRole("button", { name: /new profile/i }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog).toBeVisible()

  // Focus lands inside the dialog, and the name field is reachable by typing.
  await dialog.getByLabel("Name").fill("Keyboard profile")
  const slider = dialog.getByRole("slider", { name: "Security weight" })
  await slider.focus()
  await slider.press("ArrowRight")
  await expect(page.getByTestId("new-value-security")).toHaveText("1.1")

  await dialog.getByRole("button", { name: "Create profile" }).press("Enter")
  await expect(dialog).toBeHidden()
  await expect(card(page, "Keyboard profile")).toBeVisible()

  // Escape closes the next one without creating anything.
  await page.getByRole("button", { name: /new profile/i }).click()
  await expect(page.getByRole("dialog")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog")).toBeHidden()
  await expect(page.getByTestId("custom-count")).toHaveText("1 of 5")
})

test("a profile change re-ranks the dashboard with no re-scan (FR-21)", async ({
  page,
}) => {
  const requests = watchRequests(page)

  /** Where each finding sits in the Refactor-First list. */
  async function rankings() {
    await expect(
      findingCards(page).filter({ hasText: /940 lines long/ }),
    ).toBeVisible()
    const cards = await findingCards(page).allInnerTexts()
    return {
      longFile: cards.findIndex((r) => /940 lines long/.test(r)),
      sqlInjection: cards.findIndex((r) => /string concatenation/.test(r)),
    }
  }

  // Under Balanced, the HIGH code-design finding outranks the MEDIUM security one.
  await page.goto(`/dashboard/${DEMO_REPO_ID}`)
  await expect(page.getByText("72/100")).toBeVisible()
  const before = await rankings()
  expect(before.longFile).toBeLessThan(before.sqlInjection)

  await page.goto("/profiles")
  await selectProfile(page, "Security-first")
  await page.getByRole("button", { name: /set as workspace default/i }).click()
  await expect(page.getByTestId("workspace-default-name")).toHaveText(
    "Security-first",
  )

  await page.goto(`/dashboard/${DEMO_REPO_ID}`)

  // Every score is recomputed on read, so the ORDER inverts…
  const after = await rankings()
  expect(after.sqlInjection).toBeLessThan(after.longFile)

  // …and so does the health score.
  await expect(page.getByText("36/100")).toBeVisible()
  await expect(page.getByText("72/100")).toHaveCount(0)

  // All of that, and the code was never re-read.
  expect(requests.scans()).toHaveLength(0)
})

test("the trust slider cannot de-weight a security finding (FR-24)", async ({
  page,
}) => {
  await createProfile(page, "Trust the model")
  await selectProfile(page, "Trust the model")

  // Push trust all the way to "trust the model".
  const trust = page.getByRole("slider", { name: "Trust slider" })
  await trust.focus()
  for (let i = 0; i < 30; i++) await trust.press("ArrowLeft")
  await expect(page.getByTestId("value-trust_s")).toHaveText("0.00")
  await page.getByRole("button", { name: "Save changes" }).click()
  await page.getByRole("button", { name: /set as workspace default/i }).click()
  await expect(page.getByTestId("workspace-default-name")).toHaveText(
    "Trust the model",
  )

  await page.goto(`/dashboard/${DEMO_REPO_ID}`)
  // source_trust is pinned at 1.0 for the security category, so no position of
  // this slider can push the critical secret off the top of the list.
  await expect(findingCards(page).first()).toContainText(/hardcoded/i)
})

test("a read-only role sees the pool and no way to change it", async ({
  page,
  baseURL,
}) => {
  await page.context().addCookies([
    {
      name: "codesage_e2e_role",
      value: "viewer",
      url: baseURL ?? "http://localhost:3101",
    },
  ])
  await page.goto("/profiles")

  await expect(pool(page).getByRole("listitem")).toHaveCount(3)
  await expect(
    page.getByText(/needs the manager or org-admin role/i),
  ).toBeVisible()
  await expect(page.getByRole("button", { name: /new profile/i })).toHaveCount(
    0,
  )
  await expect(
    page.getByRole("button", { name: /set as workspace default/i }),
  ).toHaveCount(0)
  // Readable, not operable: the numbers are still on screen.
  await expect(
    page.getByRole("slider", { name: "Security weight" }),
  ).toHaveAttribute("aria-disabled", "true")
})
