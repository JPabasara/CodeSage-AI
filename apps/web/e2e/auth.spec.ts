import { test as signedOut, expect } from "@playwright/test"

import { DEMO_REPO_ID, SESSION_COOKIE, test as signedIn } from "./session"

// ────────────────────────────────────────────────────────────────────────────
// J3.3 — route protection.
//
// These use the RAW Playwright `test`, not the signed-in fixture: the whole
// point is to arrive with no session cookie. Every other spec in this folder
// imports from ./session and is signed in before it starts.
// ────────────────────────────────────────────────────────────────────────────

const PROTECTED = [
  "/projects",
  "/profiles",
  `/dashboard/${DEMO_REPO_ID}`,
  `/dashboard/${DEMO_REPO_ID}/history`,
]

for (const path of PROTECTED) {
  signedOut(`a signed-out visit to ${path} lands on /login`, async ({ page }) => {
    await page.goto(path)
    await expect(page).toHaveURL(/\/login$/)
    // Not just the URL: the protected page must not have rendered underneath.
    await expect(page.getByRole("heading", { name: "Code Sage AI" })).toBeVisible()
  })
}

signedOut("/login itself is reachable signed out — protecting it would loop", async ({
  page,
}) => {
  await page.goto("/login")
  await expect(page).toHaveURL(/\/login$/)
})

signedOut("the sign-in button hands the browser to the API, not to a fetch", async ({
  page,
}) => {
  await page.goto("/login")

  // A plain link, deliberately: the browser has to LEAVE this page for OIDC, and
  // a service worker cannot intercept a navigation. This is as far as an E2E can
  // follow sign-in — the rest is Asgardeo's consent screen. See e2e/session.ts.
  const signIn = page.getByRole("link", { name: /^sign in$/i })
  await expect(signIn).toBeVisible()
  await expect(signIn).toHaveAttribute("href", /\/api\/auth\/login$/)
})

signedIn("with a session cookie, a protected route renders", async ({ page }) => {
  await page.goto("/projects")
  await expect(page).toHaveURL(/\/projects$/)
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible()
})

signedIn("the rail shows who is signed in (J3.2)", async ({ page }) => {
  await page.goto("/projects")
  // The mock session's display name. A 401 would have redirected us instead.
  await expect(page.getByText("Janidu Pabasara")).toBeVisible()
})

signedIn("sign-out is a form POST, not a link — a GET must not end a session", async ({
  page,
}) => {
  await page.goto("/projects")

  const form = page.locator(`form[action$="/api/auth/logout"]`)
  await expect(form).toHaveAttribute("method", /post/i)
  await expect(form.getByRole("button", { name: /sign out/i })).toBeVisible()
})

signedIn("losing the session mid-visit sends you back to /login", async ({
  page,
  context,
}) => {
  await page.goto("/projects")
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible()

  // Exactly what an expiry looks like to the browser: the cookie is gone, so the
  // next navigation has no session. Without J3.3 this rendered a shell with an
  // error inside it instead of bouncing to sign-in.
  await context.clearCookies({ name: SESSION_COOKIE })
  await page.goto("/projects")
  await expect(page).toHaveURL(/\/login$/)
})
