"use client"

import { useEffect } from "react"
import { usePathname, useRouter } from "next/navigation"

import { ApiRequestError } from "@/lib/api/client"
import { readPendingInvitation } from "@/lib/pending-invitation"
import { SESSION_ENDED_URL } from "@/lib/sign-in"
import { useSession } from "@/hooks/use-session"

/**
 * Where a signed-in visitor actually belongs.
 *
 * Three states, and the middleware can only tell two of them apart — the session
 * cookie is httpOnly, so at the edge "signed in" is all it can see:
 *
 *  • no session at all → /login, saying the session ended;
 *  • signed in with no workspace → /onboarding, NOT /login. Sending someone who
 *    just signed in back to the sign-in page is the classic version of this bug:
 *    they sign in again, land here again, and never learn that what they are
 *    missing is a workspace;
 *  • signed in with a workspace → stay.
 *
 * And one detour before any of those: an invitation opened while signed out is
 * kept for this tab, and sign-in lands here with no way to return to it — so a
 * kept token sends the visitor back to finish accepting.
 *
 * The API is the security boundary either way. This only stops a visitor from
 * staring at a shell that answers 409 to everything it tries to fill itself with.
 */
export function SessionGuard() {
  const router = useRouter()
  const pathname = usePathname()
  const { data: session, error } = useSession()

  useEffect(() => {
    if (error instanceof ApiRequestError && error.status === 401) {
      router.replace(SESSION_ENDED_URL)
      return
    }
    if (session && readPendingInvitation()) {
      router.replace("/invitations/accept")
      return
    }
    // The same address the API's sign-in callback uses, so a new account lands
    // in one place however it arrives.
    if (session?.needs_workspace_setup && !pathname.startsWith("/onboarding")) {
      router.replace("/onboarding/workspace")
    }
  }, [error, pathname, router, session])

  return null
}
