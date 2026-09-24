// What the sign-in page says, and the one note it carries across sign-out.

/**
 * The API sends a failed sign-in back to `/login?error=<code>`. Each known code
 * gets a calm sentence; anything else gets one generic line. The raw value is
 * never rendered — it came from a URL anyone can craft.
 *
 * `session` is the web's own code: the app got a 401 mid-session.
 */
const MESSAGES: Record<string, string> = {
  expired: "Sign-in took too long. Please try again.",
  invalid: "That sign-in attempt wasn't valid. Please try again.",
  failed: "Asgardeo couldn't confirm your sign-in. Please try again.",
  session: "Your session ended. Sign in again to continue.",
}

const GENERIC = "Something went wrong while signing in. Please try again."

export function signInErrorMessage(
  code: string | string[] | undefined,
): string | undefined {
  const value = Array.isArray(code) ? code[0] : code
  if (!value) return undefined
  return Object.hasOwn(MESSAGES, value) ? MESSAGES[value] : GENERIC
}

/** Where the app sends someone whose session stopped working. */
export const SESSION_ENDED_URL = "/login?error=session"

// ── "You're signed out." ────────────────────────────────────────────────────
//
// Sign-out is a form POST that ends on the identity provider and comes back to
// /login. The post-logout URL is matched exactly by Asgardeo, so it cannot carry
// a query parameter. The note travels in this tab's sessionStorage instead.

const SIGNED_OUT_KEY = "codesage.signedOut"

function store(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage
  } catch {
    return null
  }
}

/** Call just before the sign-out form submits. */
export function markSignedOut() {
  try {
    store()?.setItem(SIGNED_OUT_KEY, "1")
  } catch {
    // No storage: the page simply won't say it. Sign-out still happens.
  }
}

let consumed: boolean | undefined

/**
 * Whether to say "You're signed out." — true once per sign-out, then false.
 *
 * The answer is read once and remembered for the life of the page, so every
 * re-render agrees with the first one while the note itself is already gone
 * from storage and will not show again on a refresh.
 */
export function consumeSignedOut(): boolean {
  if (consumed !== undefined) return consumed
  try {
    consumed = store()?.getItem(SIGNED_OUT_KEY) === "1"
    store()?.removeItem(SIGNED_OUT_KEY)
  } catch {
    consumed = false
  }
  return consumed
}

/** Tests only: forget the remembered answer. */
export function resetSignedOutNotice() {
  consumed = undefined
}
