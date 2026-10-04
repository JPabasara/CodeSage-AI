"use client"

import { useEffect, useState, useSyncExternalStore } from "react"
import { useRouter } from "next/navigation"
import { ArrowRight, CircleAlert, CircleCheck, Loader2 } from "lucide-react"

import { getSession } from "@/lib/api/client"
import { consumeSignedOut } from "@/lib/sign-in"

const noSubscribe = () => () => {}

// The one sign-in button, and the two things the page says around it.
export function SignInPanel({
  href,
  error,
}: Readonly<{ href: string; error?: string }>) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const signedOut = useSyncExternalStore(
    noSubscribe,
    consumeSignedOut,
    () => false,
  )

  useEffect(() => {
    let alive = true
    getSession()
      .then(() => {
        if (alive) router.replace("/overview")
      })
      .catch(() => {
        // 401 is the expected answer here; anything else leaves the button.
      })
    return () => {
      alive = false
    }
  }, [router])

  useEffect(() => {
    const onShow = (event: PageTransitionEvent) => {
      if (event.persisted) setPending(false)
    }
    window.addEventListener("pageshow", onShow)
    return () => window.removeEventListener("pageshow", onShow)
  }, [])

  return (
    <div className="space-y-4">
      {error ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-foreground"
        >
          <CircleAlert
            className="mt-0.5 size-4 shrink-0 text-destructive"
            aria-hidden="true"
          />
          {error}
        </p>
      ) : signedOut ? (
        <p
          role="status"
          className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2.5 text-sm text-foreground"
        >
          <CircleCheck
            className="size-4 shrink-0 text-primary"
            aria-hidden="true"
          />
          You&apos;re signed out.
        </p>
      ) : null}

      <a
        href={href}
        aria-disabled={pending || undefined}
        onClick={(event) => {
          if (pending) {
            event.preventDefault()
            return
          }
          setPending(true)
        }}
        className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md px-5 text-sm font-medium transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none aria-disabled:cursor-default aria-disabled:opacity-80"
      >
        {pending ? (
          <>
            <Loader2
              className="size-4 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
            Redirecting to Asgardeo…
          </>
        ) : (
          <>
            Sign in with Asgardeo
            <ArrowRight className="size-4" aria-hidden="true" />
          </>
        )}
      </a>
    </div>
  )
}
