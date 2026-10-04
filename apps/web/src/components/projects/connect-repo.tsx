"use client"

import { useId, useState } from "react"
import Link from "next/link"
import { Info } from "lucide-react"

import { GitHubMark } from "@/components/icons/github-mark"
import { LockedAction } from "@/components/locked-action"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

// An example URL box and a Connect button with inline validation.
export type ConnectRepoProps = {
  onConnect?: (url: string) => void | Promise<boolean>
  /** A connect request is in flight; the form is locked until it settles. */
  busy?: boolean
  error?: string
  onErrorClear?: () => void
  lockedReason?: string
  className?: string
}

export function ConnectRepo({
  onConnect,
  busy,
  error,
  onErrorClear,
  lockedReason,
  className,
}: Readonly<ConnectRepoProps>) {
  const [url, setUrl] = useState("")
  const errorId = useId()
  const noteId = useId()
  const locked = Boolean(lockedReason)

  const submit = async () => {
    const trimmed = url.trim()
    if (!trimmed || busy || locked) return
    const connected = await onConnect?.(trimmed)
    if (connected !== false) setUrl("")
  }

  const button = (
    <Button
      type="submit"
      disabled={locked || busy || !url.trim()}
      className="h-10 w-full px-4 text-sm font-semibold sm:w-auto"
    >
      {busy ? "Connecting…" : "Connect repository"}
    </Button>
  )

  return (
    <section
      aria-labelledby="connect-repo-heading"
      data-tour="project-connect"
      className={cn(
        "flex flex-wrap items-start gap-3.5 rounded-md border bg-card p-4.5",
        className,
      )}
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-md border bg-muted text-foreground">
        <GitHubMark className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <h2
          id="connect-repo-heading"
          className="text-base font-semibold text-foreground-strong"
        >
          Connect a GitHub repository
        </h2>
        <p className="text-sm text-muted-foreground">
          {locked
            ? "You can open every project in this workspace. Connecting and removing repositories needs the manager or org-admin role."
            : "Paste the URL of a public repository. CodeSage analyses its Java code."}
        </p>

        <form
          className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-start"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Input
              className="h-10 min-w-0 px-3 md:text-sm"
              placeholder="https://github.com/owner/repo"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value)
                if (error) onErrorClear?.()
              }}
              aria-label="Repository URL"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${errorId} ${noteId}` : noteId}
              disabled={locked || busy}
            />
            {error ? (
              <p id={errorId} role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
          {lockedReason ? (
            <LockedAction reason={lockedReason}>{button}</LockedAction>
          ) : (
            button
          )}
        </form>

        <p
          id={noteId}
          className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground"
        >
          <Info className="size-3.5 shrink-0" aria-hidden="true" />
          Java only. Other files are ignored.
          <Link
            href="/help/what-is-analysed"
            className="rounded-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            What is analysed
          </Link>
        </p>
      </div>
    </section>
  )
}
