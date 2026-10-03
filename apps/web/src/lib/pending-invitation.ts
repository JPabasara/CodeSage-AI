// An invitation token waiting for sign-in to finish.

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
