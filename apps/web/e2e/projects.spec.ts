import { readFileSync } from "node:fs"

import { DEMO_REPO_ID, SECOND_REPO_ID, test, expect } from "./session"

const SELECTED_PROJECT_KEY = "codesage.selectedProjectId.v2"
const WORKSPACE_ID = "1e2f3a4b-5c6d-4e7f-8091-a2b3c4d5e6f7"

// The project this workspace is on, out of storage.
const storedProject = (page: import("@playwright/test").Page) =>
  page.evaluate(
    ([key, workspaceId]) => {
      const raw = localStorage.getItem(key)
      if (!raw) return null
      try {
        return (JSON.parse(raw) as Record<string, string>)[workspaceId] ?? null
      } catch {
        return null
      }
    },
    [SELECTED_PROJECT_KEY, WORKSPACE_ID] as const,
  )

// Connect a repository, and the four ways it can fail.

test.beforeEach(async ({ page }) => {
  await page.goto("/projects")
  await expect(
    page
      .getByRole("list", { name: /connected repositories/i })
      .getByText("acme-payments"),
  ).toBeVisible()
})

// The repository rows, and ONLY those.
const repoRows = (page: import("@playwright/test").Page) =>
  page
    .getByRole("list", { name: /connected repositories/i })
    .getByRole("listitem")

/** The connect panel, where a refusal is shown under the URL field. */
const connectForm = (page: import("@playwright/test").Page) =>
  page.getByRole("region", { name: /connect a github repository/i })

async function connect(page: import("@playwright/test").Page, url: string) {
  await page.getByLabel(/repository url/i).fill(url)
  await page.getByRole("button", { name: /^connect repository$/i }).click()
}

async function removeRepository(
  page: import("@playwright/test").Page,
  repositoryName: string,
) {
  const row = repoRows(page).filter({ hasText: repositoryName })
  await row.getByRole("button", { name: /delete .* repository/i }).click()
  await page.getByRole("button", { name: /^remove repository$/i }).click()
}

test("the list shows each repository with its visibility and health hint", async ({
  page,
}) => {
  const payments = repoRows(page).filter({ hasText: "acme-payments" })
  await expect(payments.getByText("public")).toBeVisible()
  // Grade + score + signed delta, from the DERIVED latest_health hint.
  await expect(payments.getByText(/\b72\/100\b/)).toBeVisible()

  const octo = repoRows(page).filter({ hasText: "octo-cli" })
  await expect(octo.getByText("private")).toBeVisible()
})

test("a repository that was never scanned says so, instead of showing a zero", async ({
  page,
}) => {
  const octo = repoRows(page).filter({ hasText: "octo-cli" })
  await expect(octo.getByText(/not scanned yet/i)).toBeVisible()
  await expect(octo.getByText("/100")).toHaveCount(0)
})

test("connecting a public repository adds it to the list", async ({ page }) => {
  await connect(page, "https://github.com/octocat/Hello-World")

  await expect(page.getByText(/connected octocat\/Hello-World/i)).toBeVisible()
  await expect(repoRows(page).filter({ hasText: "Hello-World" })).toBeVisible()
  // Freshly connected: no scan has run, so no health hint.
  await expect(
    repoRows(page)
      .filter({ hasText: "Hello-World" })
      .getByText(/not scanned yet/i),
  ).toBeVisible()
})

test("each connect failure explains itself in its own words", async ({
  page,
}) => {
  const cases: [string, RegExp][] = [
    ["not-a-url", /valid GitHub repository link/i],
    [
      "https://github.com/octocat/private-x",
      /private repositories cannot be connected yet/i,
    ],
    ["https://github.com/octocat/missing-x", /could not be reached/i],
    ["https://github.com/acme/acme-payments", /already connected/i],
  ]

  for (const [url, message] of cases) {
    await connect(page, url)
    // Asserted under the URL field (13H.1): the toast says the same thing but is gone in seconds.
    await expect(connectForm(page).getByRole("alert"), url).toHaveText(message)
  }
})

test("a repository with no Java is refused with a clear sentence and adds no row", async ({
  page,
}) => {
  const rowsBefore = await repoRows(page).count()

  await connect(page, "https://github.com/acme/nojava-site")

  const refusal = connectForm(page).getByRole("alert")
  await expect(refusal).toContainText(
    "We couldn't find any Java in this repository.",
  )
  await expect(refusal).toContainText("more languages are coming soon")
  await expect(refusal).toContainText("GitHub lists Python and Shell")
  await expect(repoRows(page)).toHaveCount(rowsBefore)
  await expect(repoRows(page).filter({ hasText: "nojava-site" })).toHaveCount(0)
})

test("selecting a project opens its dashboard", async ({ page }) => {
  await repoRows(page)
    .filter({ hasText: "acme-payments" })
    .getByRole("link", { name: /go to dashboard/i })
    .click()

  await expect(page).toHaveURL(new RegExp(`/dashboard/${DEMO_REPO_ID}$`))
  await expect(page.getByText("Code Health")).toBeVisible()
})

test("the repo id in the URL is the contract's uuid, not a slug", async ({
  page,
}) => {
  await repoRows(page)
    .filter({ hasText: "acme-payments" })
    .getByRole("link", { name: /go to dashboard/i })
    .click()

  await expect(page).toHaveURL(
    /\/dashboard\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  )
})

test("the rail's fallback demo id matches the fixture", () => {
  // Two copies of a UUID, edited in one place, is a silent 404 on the demo path.
  const demo = readFileSync("src/lib/demo.ts", "utf8")
  expect(demo).toContain(DEMO_REPO_ID)
})

test("deleting the active project selects a remaining project everywhere", async ({
  page,
}) => {
  await expect.poll(() => storedProject(page)).toBe(DEMO_REPO_ID)

  await removeRepository(page, "acme-payments")

  await expect(repoRows(page).filter({ hasText: "acme-payments" })).toHaveCount(
    0,
  )
  await expect.poll(() => storedProject(page)).toBe(SECOND_REPO_ID)
  await expect(
    page.getByRole("link", { name: "Dashboard", exact: true }),
  ).toHaveAttribute("href", `/dashboard/${SECOND_REPO_ID}`)
  await expect(
    page.getByRole("link", { name: "Scan history", exact: true }),
  ).toHaveAttribute("href", `/dashboard/${SECOND_REPO_ID}/history`)
})

test("deleting a non-active project preserves the active rail links", async ({
  page,
}) => {
  await expect.poll(() => storedProject(page)).toBe(DEMO_REPO_ID)

  await removeRepository(page, "web-store")

  await expect(repoRows(page).filter({ hasText: "web-store" })).toHaveCount(0)
  await expect.poll(() => storedProject(page)).toBe(DEMO_REPO_ID)
  await expect(
    page.getByRole("link", { name: "Dashboard", exact: true }),
  ).toHaveAttribute("href", `/dashboard/${DEMO_REPO_ID}`)
})
