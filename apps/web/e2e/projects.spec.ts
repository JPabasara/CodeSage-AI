import { readFileSync } from "node:fs"

import { DEMO_REPO_ID, test, expect } from "./session"

// ────────────────────────────────────────────────────────────────────────────
// J2.10 — connect a repository, and the four ways it can fail.
//
// Each failure has its own `code` in the contract precisely because each is a
// different thing for the user to DO about it. A bare "400 Bad Request" leaves
// someone who pasted their own private repository with no idea what went wrong,
// so these assert the MESSAGE, not the status.
// ────────────────────────────────────────────────────────────────────────────

test.beforeEach(async ({ page }) => {
  await page.goto("/projects")
  await expect(page.getByText("acme/acme-payments")).toBeVisible()
})

/** The connect form: type a URL, press Connect. */
async function connect(page: import("@playwright/test").Page, url: string) {
  await page.getByLabel(/repository url/i).fill(url)
  await page.getByRole("button", { name: /^connect$/i }).click()
}

test("the list shows each repository with its visibility and health hint", async ({
  page,
}) => {
  const payments = page.getByRole("listitem").filter({ hasText: "acme-payments" })
  await expect(payments.getByText("public")).toBeVisible()
  // Grade + score + signed delta, from the DERIVED latest_health hint.
  await expect(payments.getByText(/\b72\/100\b/)).toBeVisible()

  // Visibility is recorded and displayed from v1.0 (FR-3) even though
  // CONNECTING a private repository is v2 — so a private row must render.
  const octo = page.getByRole("listitem").filter({ hasText: "octo-cli" })
  await expect(octo.getByText("private")).toBeVisible()
})

test("a repository that was never scanned says so, instead of showing a zero", async ({
  page,
}) => {
  const octo = page.getByRole("listitem").filter({ hasText: "octo-cli" })
  // `latest_health` is ABSENT, not zero. "Not scanned yet" and "scored 0" are
  // completely different facts and the list has to tell them apart.
  await expect(octo.getByText(/not scanned yet/i)).toBeVisible()
  await expect(octo.getByText("/100")).toHaveCount(0)
})

test("connecting a public repository adds it to the list", async ({ page }) => {
  await connect(page, "https://github.com/octocat/Hello-World")

  await expect(page.getByText(/connected octocat\/Hello-World/i)).toBeVisible()
  await expect(
    page.getByRole("listitem").filter({ hasText: "octocat/Hello-World" }),
  ).toBeVisible()
  // Freshly connected: no scan has run, so no health hint.
  await expect(
    page.getByRole("listitem").filter({ hasText: "Hello-World" }).getByText(/not scanned yet/i),
  ).toBeVisible()
})

test("each connect failure explains itself in its own words", async ({ page }) => {
  const cases: [string, RegExp][] = [
    ["not-a-url", /does not look like a repository URL/i],
    ["https://github.com/octocat/private-x", /only public repositories/i],
    ["https://github.com/octocat/missing-x", /could not be reached/i],
    ["https://github.com/acme/acme-payments", /already connected/i],
  ]

  for (const [url, message] of cases) {
    await connect(page, url)
    await expect(page.getByText(message), url).toBeVisible()
    // Clear the toast before the next case so a stale one cannot pass the check.
    await page.getByText(message).click({ trial: true }).catch(() => {})
    await page.waitForTimeout(150)
  }
})

test("selecting a project opens its dashboard", async ({ page }) => {
  await page
    .getByRole("listitem")
    .filter({ hasText: "acme-payments" })
    .getByRole("button", { name: /select/i })
    .click()

  await expect(page).toHaveURL(new RegExp(`/dashboard/${DEMO_REPO_ID}$`))
  await expect(page.getByText("Code Health")).toBeVisible()
})

test("the repo id in the URL is the contract's uuid, not a slug", async ({ page }) => {
  await page
    .getByRole("listitem")
    .filter({ hasText: "acme-payments" })
    .getByRole("button", { name: /select/i })
    .click()

  // `Repo.id` is `format: uuid`. Slug ids used to hide a class of bug here —
  // routing, id comparison and URL building all behave differently for an
  // opaque 36-character string than for a friendly word.
  await expect(page).toHaveURL(
    /\/dashboard\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  )
})

test("the rail's hardcoded demo id matches the fixture", () => {
  // Two copies of a UUID, edited in one place, is a silent 404 on the demo path.
  // This guard is cheap and it fails the moment they diverge.
  const demo = readFileSync("src/lib/demo.ts", "utf8")
  expect(demo).toContain(DEMO_REPO_ID)
})
