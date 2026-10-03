import { test as base, expect } from "@playwright/test"

export const DEMO_REPO_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7"
export const SECOND_REPO_ID = "b4f0a9d2-3c81-4e57-9f26-1d5a8b7c0e34"
export const UNSCANNED_REPO_ID = "e3a1c58f-2b64-4d09-8a17-5c0f9e2d6b48"

export const SESSION_COOKIE =
  process.env.NEXT_PUBLIC_SESSION_COOKIE_NAME ?? "codesage_session"

// Sign-in is the one journey that cannot be tested here, so it is bypassed rather than faked badly.
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
