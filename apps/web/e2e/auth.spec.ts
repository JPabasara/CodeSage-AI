import { test as signedOut, expect } from "@playwright/test"

import { DEMO_REPO_ID, SESSION_COOKIE, test as signedIn } from "./session"

// Route protection.
//
// These use the raw Playwright `test`, not the signed-in fixture: the point is
// to arrive with no session cookie. Every other spec imports from ./session and
// is signed in before it starts.

const PROTECTED = [
  "/projects",
  "/profiles",
  `/dashboard/${DEMO_REPO_ID}`,
  `/dashboard/${DEMO_REPO_ID}/history`,
]

for (const path of PROTECTED) {
  signedOut(
    `a signed-out visit to ${path} lands on /login`,
    async ({ page }) => {
      await page.goto(path)
      await expect(page).toHaveURL(/\/login$/)
      // Not just the URL: the protected page must not have rendered underneath.
      await expect(
        page.getByRole("heading", { name: /continue to your dashboard/i }),
      ).toBeVisible()
    },
  )
}

signedOut(
  "codesage.dev lands on sign-in in one hop, one click from Asgardeo",
  async ({ page }) => {
    await page.goto("/")

    await expect(page).toHaveURL(/\/login$/)
    await expect(
      page.getByRole("link", { name: /sign in with asgardeo/i }),
    ).toHaveAttribute("href", /\/api\/auth\/login$/)
  },
)

signedIn("signed in, / and /login both go into the app", async ({ page }) => {
  await page.goto("/")
  await expect(page).toHaveURL(/\/projects$/)

  // /login is sent on by the page after the API confirms the session — the
  // middleware cannot tell a live cookie from a stale one.
  await page.goto("/login")
  await expect(page).toHaveURL(/\/projects$/)
})

for (const [code, message] of [
  ["expired", /took too long/i],
  ["invalid", /wasn't valid/i],
  ["failed", /couldn't confirm/i],
  ["session", /session ended/i],
] as const) {
  signedOut(`/login?error=${code} explains itself`, async ({ page }) => {
    await page.goto(`/login?error=${code}`)
    await expect(page.locator("#main-content").getByRole("alert")).toHaveText(
      message,
    )
  })
}

signedOut("an unknown error code is never echoed", async ({ page }) => {
  await page.goto("/login?error=%3Cb%3Ehacked%3C%2Fb%3E")
  await expect(page.locator("#main-content").getByRole("alert")).toHaveText(
    /something went wrong/i,
  )
  await expect(page.getByText("hacked")).toHaveCount(0)
})

signedOut(
  "/login itself is reachable signed out — protecting it would loop",
  async ({ page }) => {
    await page.goto("/login")
    await expect(page).toHaveURL(/\/login$/)
  },
)

signedOut(
  "the sign-in button hands the browser to the API, not to a fetch",
  async ({ page }) => {
    await page.goto("/login")

    // A plain link, deliberately: the browser has to leave this page for OIDC,
    // and a service worker cannot intercept a navigation. This is as far as an
    // E2E can follow sign-in.
    const signIn = page.getByRole("link", { name: /sign in with asgardeo/i })
    await expect(signIn).toBeVisible()
    await expect(signIn).toHaveAttribute("href", /\/api\/auth\/login$/)
  },
)

signedIn(
  "with a session cookie, a protected route renders",
  async ({ page }) => {
    await page.goto("/projects")
    await expect(page).toHaveURL(/\/projects$/)
    await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible()
  },
)

signedIn("the account menu shows who is signed in (J3.2)", async ({ page }) => {
  await page.goto("/projects")
  // The mock session's display name. A 401 would have redirected us instead.
  await page.getByRole("button", { name: "Account menu" }).click()
  await expect(page.getByText("Janidu Pabasara")).toBeVisible()
})

signedIn(
  "sign-out is a form POST, not a link — a GET must not end a session",
  async ({ page }) => {
    await page.goto("/projects")
    // Sign out sits at the foot of the rail.
    await page.getByRole("button", { name: /sign out/i }).click()

    // Asked once, in a centred dialog; the form only posts from there.
    const dialog = page.getByRole("alertdialog", {
      name: "Sign out of CodeSage?",
    })
    await expect(dialog).toBeVisible()
    const form = page.locator(`form[action$="/api/auth/logout"]`)
    await expect(form).toHaveAttribute("method", /post/i)
    await expect(
      dialog.getByRole("button", { name: "Sign out", exact: true }),
    ).toBeFocused()

    await page.keyboard.press("Escape")
    await expect(dialog).toBeHidden()
    await expect(page).toHaveURL(/\/projects$/)
  },
)

signedIn(
  "losing the session mid-visit sends you back to /login",
  async ({ page, context }) => {
    await page.goto("/projects")
    await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible()

    // Exactly what an expiry looks like to the browser: the cookie is gone, so
    // the next navigation has no session. This used to render a shell with an
    // error inside it instead of bouncing to sign-in.
    await context.clearCookies({ name: SESSION_COOKIE })
    await page.goto("/projects")
    await expect(page).toHaveURL(/\/login$/)
  },
)
