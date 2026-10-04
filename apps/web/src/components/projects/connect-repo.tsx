"use client"

import { LearnMore } from "@/components/support/learn-more"

import { useId, useState } from "react"

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
      className="h-8 w-full px-3 sm:w-auto"
    >
      {busy ? "Connecting…" : "Connect repository"}
    </Button>
  )

  return (
    <section
      aria-labelledby="connect-repo-heading"
      data-tour="project-connect"
      className={cn("rounded-lg border bg-card p-5", className)}
    >
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-md border bg-muted/40 text-foreground">
          <GitHubMark className="size-5" />
        </span>
        <div className="min-w-0 space-y-0.5">
          <h2 id="connect-repo-heading" className="text-base font-semibold">
            Connect a GitHub repository
          </h2>
          <p className="text-sm text-muted-foreground">
            {locked
              ? "You can open every project in this workspace. Connecting and removing repositories needs the manager or org-admin role."
              : "Paste the URL of a public repository to add it to this workspace."}
          </p>
        </div>
      </div>

      <div className="mt-3">
        <LearnMore
          article="stored-data"
          about="repository data stored by CodeSage"
        />
      </div>
      <form
        className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-start"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Input
            className="h-8 min-w-0"
            placeholder="https://github.com/owner/repo"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value)
              if (error) onErrorClear?.()
            }}
            aria-label="Repository URL"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
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
    </section>
  )
}
