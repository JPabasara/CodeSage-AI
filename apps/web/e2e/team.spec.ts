import { test as base } from "@playwright/test"

import { SESSION_COOKIE, expect, test } from "./session"

// Team lives on the Workspace page beside its settings: one place for "this
// workspace", with settings and people in separate columns because they are
// separate permissions. Old `?tab=team` links still land here.

const MOCK_INVITATION_TOKEN = "orbit-studio-invitation-token-0123456789"

const main = (page: import("@playwright/test").Page) =>
  page.locator("#main-content")

/** Signed in as a viewer, via the E2E role cookie. */
const asViewer = base.extend({
  page: async ({ page, baseURL }, runTest) => {
    const url = baseURL ?? "http://localhost:3101"
    await page.context().addCookies([
      { name: SESSION_COOKIE, value: "e2e-seeded-session", url },
      { name: "codesage_e2e_role", value: "viewer", url },
    ])
    await runTest(page)
  },
})

test("an org-admin invites, revokes, and changes a role on the Workspace page", async ({
  page,
}) => {
  await page.goto("/workspace")
  // No tabs: the team is on the page next to the settings.
  await expect(main(page).getByRole("tab")).toHaveCount(0)
  await expect(
    main(page).getByRole("heading", { name: "Members" }),
  ).toBeVisible()

  await page.getByLabel("Email").fill("e2e.teammate@example.com")
  await page.getByRole("button", { name: "Send invite" }).click()
  await expect(main(page).getByText("e2e.teammate@example.com")).toBeVisible()

  await page
    .getByRole("button", {
      name: "Revoke invitation to e2e.teammate@example.com",
    })
    .click()
  await expect(main(page).getByText("e2e.teammate@example.com")).toHaveCount(0)

  await page.getByRole("combobox", { name: "Role for Sam Perera" }).click()
  await page.getByRole("option", { name: "Viewer" }).click()
  await expect(
    page.getByRole("combobox", { name: "Role for Sam Perera" }),
  ).toHaveText("Viewer")
})

test("an old ?tab=team link works, and deactivation needs a named confirm", async ({
  page,
}) => {
  await page.goto("/workspace?tab=team")
  await page.getByRole("button", { name: "Deactivate Priya Fernando" }).focus()
  await page.keyboard.press("Enter")
  const dialog = page.getByRole("dialog", {
    name: "Deactivate Priya Fernando?",
  })
  await expect(dialog).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(dialog).toBeHidden()
})

asViewer(
  "a viewer reads the team but is offered no management controls",
  async ({ page }) => {
    await page.goto("/workspace?tab=team")
    await expect(page.getByTestId("member-row")).toHaveCount(5)
    await expect(page.getByRole("button", { name: "Send invite" })).toHaveCount(
      0,
    )
    await expect(page.getByRole("button", { name: /deactivate/i })).toHaveCount(
      0,
    )
  },
)

test("accepting an invitation joins and enters the new workspace", async ({
  page,
}) => {
  await page.goto(`/invitations/accept?token=${MOCK_INVITATION_TOKEN}`)
  await expect(page).toHaveURL(/\/projects$/)

  await page.goto("/workspace")
  await expect(
    main(page).getByRole("heading", { name: "Orbit Studio" }),
  ).toBeVisible()
  await expect(
    main(page).locator("header").getByText("Developer"),
  ).toBeVisible()
})

test("an unusable invitation gets one plain answer", async ({ page }) => {
  await page.goto("/invitations/accept?token=not-a-real-token-000000000000000")
  await expect(
    page.getByRole("heading", { name: /this invitation can.t be used/i }),
  ).toBeVisible()
})

base(
  "signed out, the invitation page asks for sign-in and keeps the token",
  async ({ page }) => {
    await page.goto(`/invitations/accept?token=${MOCK_INVITATION_TOKEN}`)
    await expect(
      page.getByRole("heading", { name: /sign in to accept/i }),
    ).toBeVisible()
    // Scrubbed from the address bar, kept for after sign-in.
    await expect(page).toHaveURL(/\/invitations\/accept$/)
    expect(
      await page.evaluate(() =>
        sessionStorage.getItem("codesage.pendingInvitation"),
      ),
    ).toBe(MOCK_INVITATION_TOKEN)
  },
)

test.describe("mobile", () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test("the team column does not overflow a phone screen", async ({ page }) => {
    await page.goto("/workspace?tab=team")
    await expect(page.getByTestId("member-row").first()).toBeVisible()
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
  })
})
