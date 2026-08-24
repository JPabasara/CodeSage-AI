import { test as base } from "@playwright/test"

// J3.3 put a middleware guard in front of every (app) route: no session cookie,
// no page. Every journey below therefore needs a session before it can navigate.
//
// It seeds the cookie rather than signing in for real, because since J2.6 the
// sign-in button hands the browser to Asgardeo, which needs credentials and an
// interactive consent screen — neither of which belongs in a headless journey.
// That is honest, not a shortcut: the middleware only checks the cookie EXISTS
// (it is httpOnly, so the edge cannot read it), and the API — the actual
// security boundary — is mocked away in E2E. What these journeys test is the
// UI, and a seeded cookie is exactly what the UI sees after a real sign-in.
// The fixture callback is named `runTest`, not Playwright's conventional `use`:
// the React hooks lint rule sees a bare `use(...)` call and reads it as React's
// `use` hook in a non-component. Playwright passes it positionally, so the name
// is ours to choose.
export const test = base.extend({
  page: async ({ page }, runTest) => {
    await page.context().addCookies([
      {
        name: process.env.NEXT_PUBLIC_SESSION_COOKIE_NAME ?? "codesage_session",
        value: "e2e-seeded-session",
        url: "http://localhost:3000",
      },
    ])
    await runTest(page)
  },
})

export { expect } from "@playwright/test"
