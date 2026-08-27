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
 * SIGN-IN IS THE ONE JOURNEY THAT CANNOT BE TESTED HERE, so it is bypassed
 * rather than faked badly.
 *
 * Since J2.6 the sign-in button hands the browser to Asgardeo, which needs real
 * credentials and shows an interactive consent screen. Driving that headlessly
 * would mean storing a password in the repo and depending on a third party
 * being up — for a flow that is one `<a href>` on our side.
 *
 * So every journey starts already signed in, via the cookie the middleware
 * actually checks. This is honest for three reasons:
 *
 *   1. J3.3's middleware only checks the cookie EXISTS — it is httpOnly, so the
 *      edge cannot read it. A seeded cookie is exactly what it sees after a real
 *      sign-in; there is nothing further to imitate.
 *   2. The mock `/api/auth/session` handler reads the same cookie, so the rail
 *      shows a signed-in user for the same reason the real app would.
 *   3. What is left untested is the OIDC round trip, which is verified by hand
 *      against the live site — see the manual checklist.
 *
 * `auth.spec.ts` covers the SIGNED-OUT half without this fixture, because that
 * half needs no identity provider at all.
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
