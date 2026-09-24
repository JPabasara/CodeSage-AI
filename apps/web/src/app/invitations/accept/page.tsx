"use client"

import { Suspense, useEffect, useRef, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { LogIn, MailX, UserPlus } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiRequestError, acceptInvitation } from "@/lib/api/client"
import {
  clearPendingInvitation,
  readPendingInvitation,
  savePendingInvitation,
} from "@/lib/pending-invitation"
import { useSession } from "@/hooks/use-session"
import { useWorkspaceSwitch } from "@/hooks/use-workspace"

type Outcome =
  | { kind: "joined"; workspaceId: string }
  | { kind: "unusable" }
  | { kind: "failed"; detail: string }

export default function AcceptInvitationPage() {
  // useSearchParams() needs a Suspense boundary to build.
  return (
    <Suspense fallback={<Pending />}>
      <AcceptInvitation />
    </Suspense>
  )
}

/**
 * `/invitations/accept?token=…` — the link in an invitation email.
 *
 * Public in the middleware on purpose: a signed-out visitor must reach this page
 * so the token can be kept (in this tab's sessionStorage) before sign-in leaves
 * for the identity provider. The token is then scrubbed from the address bar, so
 * it does not sit in history or leak through a Referer.
 */
function AcceptInvitation() {
  const router = useRouter()
  const params = useSearchParams()
  const urlToken = params.get("token")
  // Rendered on the client only (the search params bail out of prerendering),
  // so reading storage in the initialiser cannot mismatch a server render.
  const [token] = useState(() => urlToken ?? readPendingInvitation())
  const { data: session, error: sessionError } = useSession()
  const { switchTo } = useWorkspaceSwitch()
  const [outcome, setOutcome] = useState<Outcome>()
  const [attempt, setAttempt] = useState(0)
  const started = useRef(-1)

  // Once only: a re-run after the accept has cleared the token would put a
  // spent token back in storage and send the next sign-in round here again.
  const saved = useRef(false)
  useEffect(() => {
    if (!urlToken || saved.current) return
    saved.current = true
    savePendingInvitation(urlToken)
    router.replace("/invitations/accept")
  }, [router, urlToken])

  const signedOut =
    sessionError instanceof ApiRequestError && sessionError.status === 401

  useEffect(() => {
    if (!token || !session || started.current === attempt) return
    started.current = attempt
    acceptInvitation(token)
      .then(async (accepted) => {
        clearPendingInvitation()
        try {
          await switchTo(accepted.workspace_id)
          toast.success("You joined the workspace")
          router.replace("/projects")
        } catch {
          // Joined, but the switch did not land — offer it as one action.
          setOutcome({ kind: "joined", workspaceId: accepted.workspace_id })
        }
      })
      .catch((caught: unknown) => {
        if (caught instanceof ApiRequestError && caught.status === 404) {
          // Invalid, expired, revoked, used or for another email: the API
          // answers all of them alike, and so does this page.
          clearPendingInvitation()
          setOutcome({ kind: "unusable" })
        } else {
          setOutcome({
            kind: "failed",
            detail:
              caught instanceof ApiRequestError
                ? caught.detail
                : "Couldn't reach CodeSage.",
          })
        }
      })
  }, [attempt, router, session, switchTo, token])

  if (!token) {
    return (
      <Shell
        icon={<MailX className="size-5" aria-hidden="true" />}
        title="This invitation link is incomplete"
        body="Open the link from your invitation email again. If it still does not work, ask the person who invited you for a new one."
      >
        <Button asChild variant="outline">
          <Link href="/projects">Go to CodeSage</Link>
        </Button>
      </Shell>
    )
  }

  if (signedOut) {
    return (
      <Shell
        icon={<LogIn className="size-5" aria-hidden="true" />}
        title="Sign in to accept your invitation"
        body="Sign in with the email address the invitation was sent to. You will come back here to finish joining."
      >
        <Button asChild>
          <Link href="/login">Sign in</Link>
        </Button>
      </Shell>
    )
  }

  if (outcome?.kind === "unusable") {
    return (
      <Shell
        icon={<MailX className="size-5" aria-hidden="true" />}
        title="This invitation can’t be used"
        body="It may have expired, been revoked or already been used, or it was sent to a different email address than the one you signed in with. Ask the person who invited you to send a new one."
      >
        <Button asChild variant="outline">
          <Link href="/projects">Go to CodeSage</Link>
        </Button>
      </Shell>
    )
  }

  if (outcome?.kind === "failed") {
    return (
      <Shell
        icon={<MailX className="size-5" aria-hidden="true" />}
        title="Couldn’t accept the invitation"
        body={outcome.detail}
      >
        <Button
          onClick={() => {
            setOutcome(undefined)
            setAttempt((n) => n + 1)
          }}
        >
          Try again
        </Button>
      </Shell>
    )
  }

  if (outcome?.kind === "joined") {
    const { workspaceId } = outcome
    return (
      <Shell
        icon={<UserPlus className="size-5" aria-hidden="true" />}
        title="You joined the workspace"
        body="Your membership is active."
      >
        <Button
          onClick={() =>
            switchTo(workspaceId)
              .then(() => router.replace("/projects"))
              .catch(() => toast.error("Couldn't switch to that workspace."))
          }
        >
          Enter workspace
        </Button>
      </Shell>
    )
  }

  return <Pending />
}

function Pending() {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="mx-auto max-w-md space-y-4 p-6 outline-none"
      aria-busy="true"
    >
      <p className="sr-only">Accepting your invitation…</p>
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-32 w-full" />
    </main>
  )
}

function Shell({
  icon,
  title,
  body,
  children,
}: Readonly<{
  icon: React.ReactNode
  title: string
  body: string
  children: React.ReactNode
}>) {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="flex min-h-svh items-center justify-center bg-background px-5 py-10 text-foreground outline-none"
    >
      <section className="w-full max-w-md space-y-5 rounded-lg border bg-card p-6 shadow-sm">
        <Image
          src="/codesage-refactor-branch-mark.svg"
          alt=""
          width={36}
          height={36}
          className="size-9"
        />
        <div className="space-y-2">
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <span className="text-primary">{icon}</span>
            {title}
          </h1>
          <p className="text-sm leading-6 text-muted-foreground">{body}</p>
        </div>
        {children}
      </section>
    </main>
  )
}
