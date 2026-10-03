"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

import { ApiRequestError } from "@/lib/api/client"
import { readPendingInvitation } from "@/lib/pending-invitation"
import { SESSION_ENDED_URL } from "@/lib/sign-in"
import { useSession } from "@/hooks/use-session"

// Where a signed-in visitor actually belongs.
export function SessionGuard() {
  const router = useRouter()
  const { data: session, error } = useSession()

  useEffect(() => {
    if (error instanceof ApiRequestError && error.status === 401) {
      router.replace(SESSION_ENDED_URL)
      return
    }
    if (session && readPendingInvitation()) {
      router.replace("/invitations/accept")
    }
  }, [error, router, session])

  return null
}
