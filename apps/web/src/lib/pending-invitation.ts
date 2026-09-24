// An invitation token waiting for sign-in to finish.
//
// Sign-in leaves the app for the identity provider and the API lands the user on
// /projects or /onboarding/workspace — it has no "return to" address. So the
// accept page keeps the token here, per tab, and whichever screen the user lands
// on sends them back to finish accepting.
//
// sessionStorage rather than localStorage: the token is a one-time credential,
// and it should not outlive the tab it was opened in.

const KEY = "codesage.pendingInvitation"

function store(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage
  } catch {
    return null
  }
}

export function savePendingInvitation(token: string) {
  try {
    store()?.setItem(KEY, token)
  } catch {
    // Storage full or blocked: the token is still in hand for this visit.
  }
}

export function readPendingInvitation(): string | null {
  try {
    return store()?.getItem(KEY) ?? null
  } catch {
    return null
  }
}

export function clearPendingInvitation() {
  try {
    store()?.removeItem(KEY)
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}
