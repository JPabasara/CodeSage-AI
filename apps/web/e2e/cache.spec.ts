import type { Page } from "@playwright/test"

import { DEMO_REPO_ID, test, expect } from "./session"

// 13G and 13H.3: every read is asked once, and the dashboard comes back
// instantly when nothing changed.

/** Record every API GET the page sends, as "path?query". */
function recordGets(page: Page) {
  const gets: string[] = []
  page.on("request", (request) => {
    const url = new URL(request.url())
    if (request.method() === "GET" && url.pathname.startsWith("/api/")) {
      gets.push(`${url.pathname}${url.search}`)
    }
  })
  return gets
}

const duplicates = (gets: string[]) =>
  gets.filter((get, index) => gets.indexOf(get) !== index)

const PAGES = [
  { path: `/dashboard/${DEMO_REPO_ID}`, ready: "Code Health" },
  { path: `/dashboard/${DEMO_REPO_ID}/history`, ready: /scan history/i },
  { path: "/projects", ready: /projects/i },
  { path: "/profiles", ready: /profiles/i },
  { path: "/workspace", ready: /workspace/i },
]

for (const { path, ready } of PAGES) {
  test(`first load of ${path} sends no identical GET twice`, async ({
    page,
  }) => {
    const gets = recordGets(page)
    await page.goto(path)
    await expect(page.getByText(ready).first()).toBeVisible()
    await page.waitForLoadState("networkidle")
    expect(gets.length).toBeGreaterThan(0)
    expect(duplicates(gets)).toEqual([])
  })
}

test("Dashboard → Projects → Dashboard shows the report without the skeleton", async ({
  page,
}) => {
  await page.goto(`/dashboard/${DEMO_REPO_ID}`)
  await expect(page.getByTestId("health-score")).toHaveText("72/100")

  await page.getByRole("link", { name: "Projects", exact: true }).click()
  await expect(page).toHaveURL(/\/projects$/)
  await page.waitForLoadState("networkidle")

  // Watch the DOM from here on: any skeleton, even for one frame, is caught.
  await page.evaluate(() => {
    const w = window as unknown as { sawSkeleton: boolean }
    w.sawSkeleton = false
    new MutationObserver(() => {
      if (document.querySelector('[aria-busy="true"]')) w.sawSkeleton = true
    }).observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
    })
  })

  await page.getByRole("link", { name: "Dashboard", exact: true }).click()
  await expect(page.getByTestId("health-score")).toHaveText("72/100")
  await page.waitForLoadState("networkidle")
  expect(
    await page.evaluate(
      () => (window as unknown as { sawSkeleton: boolean }).sawSkeleton,
    ),
  ).toBe(false)
})
