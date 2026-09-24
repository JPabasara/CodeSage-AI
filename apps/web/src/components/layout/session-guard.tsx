"use client"

import { useEffect } from "react"
import { usePathname, useRouter } from "next/navigation"

import { ApiRequestError } from "@/lib/api/client"
import { useSession } from "@/hooks/use-session"

/**
 * Where a signed-in visitor actually belongs.
 *
 * Three states, and the middleware can only tell two of them apart — the session
 * cookie is httpOnly, so at the edge "signed in" is all it can see:
 *
 *  • no session at all → /login;
 *  • signed in with no workspace → /onboarding, NOT /login. Sending someone who
 *    just signed in back to the sign-in page is the classic version of this bug:
 *    they sign in again, land here again, and never learn that what they are
 *    missing is a workspace;
 *  • signed in with a workspace → stay.
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
      router.replace("/login")
      return
    }
    // The same address the API's sign-in callback uses, so a new account lands
    // in one place however it arrives.
    if (session?.needs_workspace_setup && !pathname.startsWith("/onboarding")) {
      router.replace("/onboarding/workspace")
    }
  }, [error, pathname, router, session?.needs_workspace_setup])

  return null
}
