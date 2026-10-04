import type { Page } from "@playwright/test"

import { DEMO_REPO_ID, test, expect } from "./session"

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
  { path: "/overview", ready: /workspace health/i },
  { path: `/dashboard/${DEMO_REPO_ID}`, ready: "Code Health" },
  {
    path: `/dashboard/${DEMO_REPO_ID}?view=findings`,
    ready: /ranked by severity/i,
  },
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
  await expect(page.getByTestId("health-score")).toHaveText("72")

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
  await expect(page.getByTestId("health-score")).toHaveText("72")
  await page.waitForLoadState("networkidle")
  expect(
    await page.evaluate(
      () => (window as unknown as { sawSkeleton: boolean }).sawSkeleton,
    ),
  ).toBe(false)
})

/** Sum of unexpected layout shifts since the page started (CLS, roughly). */
async function layoutShift(page: Page) {
  return page.evaluate(() => (window as unknown as { __shift: number }).__shift)
}

for (const { path, ready } of [
  { path: "/overview", ready: /workspace health/i },
  { path: `/dashboard/${DEMO_REPO_ID}`, ready: "Code Health" },
  {
    path: `/dashboard/${DEMO_REPO_ID}?view=findings`,
    ready: /ranked by severity/i,
  },
]) {
  test(`${path} settles without things jumping (layout shift under 0.02)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.addInitScript(() => {
      const state = window as unknown as { __shift: number }
      state.__shift = 0
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as unknown as {
          value: number
          hadRecentInput: boolean
        }[]) {
          if (!entry.hadRecentInput) state.__shift += entry.value
        }
      }).observe({ type: "layout-shift", buffered: true })
    })
    await page.goto(path)
    await expect(page.getByText(ready).first()).toBeVisible()
    await page.waitForLoadState("networkidle")
    await page.waitForTimeout(1000)
    expect(await layoutShift(page)).toBeLessThan(0.02)
  })
}
