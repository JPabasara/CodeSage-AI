/**
 * The project the app rail points at until a project picker exists.
 *
 * It lives here, not in `lib/mocks/`, because the rail is production code: an
 * import from the mocks would pull the whole fake backend and its scoring engine
 * into the real bundle even with mocking switched off. The fixtures import this
 * constant, not the other way round, so there is still exactly one copy of it.
 *
 * Overridable by env so a deployment can point the rail at a real repository
 * without a code change. Remove all of this once the rail knows which project
 * you last opened.
 */
export const DEMO_REPO_ID =
  process.env.NEXT_PUBLIC_DEMO_REPO_ID ?? "7c9e6679-7425-40de-944b-e07fc1f90ae7"
