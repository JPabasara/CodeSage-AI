// What the sign-in page says, and the one note it carries across sign-out.

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

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000"

export function signInHref(returnTo?: string): string {
  const url = `${API_BASE}/api/auth/login`
  return returnTo
    ? `${url}?${new URLSearchParams({ return_to: returnTo })}`
    : url
}

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

// Whether to say "You're signed out." — true once per sign-out, then false.
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
