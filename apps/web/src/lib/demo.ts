/**
 * The project the app rail points at until a project picker exists.
 *
 * It lives here rather than in `lib/mocks/` because the rail is production code —
 * importing from the mocks would pull the fake backend into the real bundle even
 * with mocking off. The fixtures import this, not the other way round.
 *
 * Overridable by env, so a deployment can point the rail elsewhere without a code
 * change. Remove once the rail remembers the last project opened.
 */
export const DEMO_REPO_ID =
  process.env.NEXT_PUBLIC_DEMO_REPO_ID ?? "7c9e6679-7425-40de-944b-e07fc1f90ae7"
