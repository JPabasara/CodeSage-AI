import { DEMO_REPO_ID, test, expect } from "./session"

// ────────────────────────────────────────────────────────────────────────────
// The profiles journey the build guide asks for (§10.5.6):
//
//   "pick a preset, drag a slider, press Apply, assert the list re-orders AND
//    no scan is triggered — route-assert that **/api/repos/*/scan is never hit,
//    and that exactly one PUT **/api/profiles/active fired."
//
// That last half is the point. FR-20 says a profile change is NOT a scan and
// writes NO snapshot; the only way to prove a negative like that is to watch the
// network and assert the request never happened.
// ────────────────────────────────────────────────────────────────────────────

/** Count the requests a journey makes, so "nothing was scanned" is checkable. */
function watchRequests(page: import("@playwright/test").Page) {
  const seen: string[] = []
  page.on("request", (req) =>
    seen.push(`${req.method()} ${new URL(req.url()).pathname}`),
  )
  return {
    scans: () => seen.filter((r) => /^POST .*\/scan$/.test(r)),
    profileWrites: () => seen.filter((r) => r === "PUT /api/profiles/active"),
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto("/profiles")
  await expect(page.getByRole("heading", { name: "Profiles" })).toBeVisible()
})

test("the page opens showing the profile that is really in force", async ({
  page,
}) => {
  // Read from GET /api/profiles/active, not guessed client-side — the sliders
  // must never open on a value the server does not hold.
  await expect(page.getByTestId("profile-label")).toHaveText("Balanced")
  await expect(page.getByTestId("value-security")).toHaveText("1.0")
  await expect(page.getByTestId("value-trust_s")).toHaveText("0.50")
})

test("there are exactly five category weights, plus the trust slider", async ({
  page,
}) => {
  // Five categories (FR-9.3) — not four, and not the six the pre-CR-001 shape had.
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

test("a preset seeds all six numbers in one interaction", async ({ page }) => {
  await page.getByRole("button", { name: "Security-first" }).click()

  await expect(page.getByTestId("value-security")).toHaveText("3.0")
  await expect(page.getByTestId("value-documentation")).toHaveText("0.5")
  await expect(page.getByTestId("profile-label")).toHaveText("Security-first")
})

test("dragging a slider sends nothing — only Apply writes", async ({
  page,
}) => {
  const requests = watchRequests(page)

  const slider = page.getByRole("slider", { name: "Security weight" })
  await slider.focus()
  for (let i = 0; i < 5; i++) await slider.press("ArrowRight")

  await expect(page.getByTestId("value-security")).toHaveText("1.5")
  // A single drag crosses many intermediate values; writing each one would put a
  // write and a full re-derivation on the server per pixel of travel — and would
  // leave the user no way to abandon an experiment.
  expect(requests.profileWrites()).toHaveLength(0)

  // Moving off a preset's exact numbers makes this a custom profile, and the
  // contract says the preset's name is then omitted rather than mislabelling it.
  await expect(page.getByTestId("profile-label")).toHaveText("Custom")
})

test("Apply writes exactly once and starts no scan", async ({ page }) => {
  const requests = watchRequests(page)

  await page.getByRole("button", { name: "Security-first" }).click()
  await page.getByRole("button", { name: /^apply$/i }).click()
  await expect(page.getByText(/profile applied/i)).toBeVisible()

  expect(
    requests.profileWrites(),
    "PUT is idempotent and fires once",
  ).toHaveLength(1)
  // FR-20: six numbers change on one row. No snapshot, no scan, no worker.
  expect(
    requests.scans(),
    "a profile change must never trigger a scan",
  ).toHaveLength(0)
})

test("out-of-range values come back clamped, and the sliders adopt what was stored", async ({
  page,
}) => {
  const slider = page.getByRole("slider", { name: "Security weight" })
  await slider.focus()
  // Drive it past the 3.0 maximum; the client clamp holds it at the bound and the
  // server would clamp it again anyway — the server is the enforcement point.
  for (let i = 0; i < 40; i++) await slider.press("ArrowRight")

  await expect(page.getByTestId("value-security")).toHaveText("3.0")

  await page.getByRole("button", { name: /^apply$/i }).click()
  await expect(page.getByText(/profile applied/i)).toBeVisible()
  // The response is the profile as it is REALLY in force, so the UI shows that
  // rather than trusting what it sent.
  await expect(page.getByTestId("value-security")).toHaveText("3.0")
})

/**
 * Where each finding sits in the Refactor-First list. `allInnerTexts()` does NOT
 * auto-wait, so the rows are awaited first — reading them straight after a
 * navigation returns an empty table and two cheerful -1s.
 */
async function rankings(page: import("@playwright/test").Page) {
  await expect(
    page.getByRole("row").filter({ hasText: /940 lines long/ }),
  ).toBeVisible()
  const rows = await page.getByRole("row").allInnerTexts()
  return {
    longFile: rows.findIndex((r) => /940 lines long/.test(r)),
    sqlInjection: rows.findIndex((r) => /string concatenation/.test(r)),
  }
}

test("applying a profile re-ranks the dashboard with no re-scan (FR-21)", async ({
  page,
}) => {
  const requests = watchRequests(page)

  // Under Balanced, the HIGH code-design finding outranks the MEDIUM security one.
  await page.goto(`/dashboard/${DEMO_REPO_ID}`)
  await expect(page.getByText("72/100")).toBeVisible()
  const before = await rankings(page)
  expect(before.longFile).toBeLessThan(before.sqlInjection)

  // Triple the security weight.
  await page.goto("/profiles")
  await page.getByRole("button", { name: "Security-first" }).click()
  await page.getByRole("button", { name: /^apply$/i }).click()
  await expect(page.getByText(/profile applied/i)).toBeVisible()

  await page.goto(`/dashboard/${DEMO_REPO_ID}`)

  // Every score is recomputed on read, so the ORDER inverts…
  const after = await rankings(page)
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
  const securityRow = (p: import("@playwright/test").Page) =>
    p.getByRole("row").filter({ hasText: "hardcoded" })

  // Push trust all the way to "trust the model".
  const trust = page.getByRole("slider", { name: "Trust slider" })
  await trust.focus()
  for (let i = 0; i < 30; i++) await trust.press("ArrowLeft")
  await expect(page.getByTestId("value-trust_s")).toHaveText("0.00")
  await page.getByRole("button", { name: /^apply$/i }).click()
  await expect(page.getByText(/profile applied/i)).toBeVisible()

  await page.goto(`/dashboard/${DEMO_REPO_ID}`)
  // source_trust is pinned at 1.0 for the security category, so no position of
  // this slider can push the critical secret off the top of the list.
  await expect(page.getByRole("row").nth(1)).toContainText(/hardcoded/i)
  await expect(securityRow(page)).toBeVisible()
})
