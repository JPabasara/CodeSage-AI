import { test as base, expect } from "@playwright/test"

/**
 * The demo repository's id. Kept in step with `src/lib/demo.ts` by the guard
 * test in `nav.spec.ts` — a UUID copied into two files and edited in one is a
 * debugging session nobody needs.
 */
export const DEMO_REPO_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7"
/** A second connected repository — proves the rail is not pinned to the demo one. */
export const SECOND_REPO_ID = "b4f0a9d2-3c81-4e57-9f26-1d5a8b7c0e34"
export const UNSCANNED_REPO_ID = "e3a1c58f-2b64-4d09-8a17-5c0f9e2d6b48"

export const SESSION_COOKIE =
  process.env.NEXT_PUBLIC_SESSION_COOKIE_NAME ?? "codesage_session"

/**
 * Sign-in is the one journey that cannot be tested here, so it is bypassed
 * rather than faked badly.
 *
 * The button hands the browser to the identity provider, which needs real
 * credentials and shows an interactive consent screen. Driving that headlessly
 * would mean storing a password in the repo and depending on a third party being
 * up, for a flow that is one `<a href>` on our side.
 *
 * So every journey starts already signed in, via the cookie the middleware
 * actually checks. That is honest: the middleware only checks the cookie exists
 * (it is httpOnly, so the edge cannot read it), and the mock session handler
 * reads the same cookie. What is left untested is the OIDC round trip, which is
 * verified by hand against the live site.
 *
 * `auth.spec.ts` covers the signed-out half without this fixture.
 */
export const test = base.extend({
  page: async ({ page, baseURL }, runTest) => {
    await page.context().addCookies([
      {
        name: SESSION_COOKIE,
        value: "e2e-seeded-session",
        url: baseURL ?? "http://localhost:3101",
      },
    ])
    await runTest(page)
  },
})

export { expect }
