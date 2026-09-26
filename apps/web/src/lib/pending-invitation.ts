// An invitation token waiting for sign-in to finish.
//
// FALLBACK, for one release. Sign-in now carries the accept page back as
// `return_to` (see `signInHref`), which works from any tab. This per-tab copy
// only covers a sign-in started some other way, and is removed after that.
// Whichever screen the user lands on sends them back to finish accepting.
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
