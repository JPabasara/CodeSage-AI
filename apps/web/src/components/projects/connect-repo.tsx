"use client"

import { useState } from "react"

import { GitHubMark } from "@/components/icons/github-mark"
import { LockedAction } from "@/components/locked-action"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

// An example URL box and a Connect button with inline validation. There is
// deliberately no private-repository option; connecting one needs a later
// installation flow that is outside this PR.
export type ConnectRepoProps = {
  onConnect?: (url: string) => void
  /** A connect request is in flight; the form is locked until it settles. */
  busy?: boolean
  /**
   * This role cannot connect. The same form is shown, disabled, with this
   * reason on the button — so the page reads the same for every role and says
   * why rather than leaving a gap.
   */
  lockedReason?: string
  className?: string
}

export function ConnectRepo({
  onConnect,
  busy,
  lockedReason,
  className,
}: Readonly<ConnectRepoProps>) {
  const [url, setUrl] = useState("")
  const locked = Boolean(lockedReason)

  const submit = () => {
    const trimmed = url.trim()
    if (!trimmed || busy || locked) return
    onConnect?.(trimmed)
    setUrl("")
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
      className={cn("rounded-lg border bg-card p-5", className)}
    >
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-md border bg-muted/40 text-foreground">
          <GitHubMark className="size-5" />
        </span>
        <div className="min-w-0 space-y-0.5">
          <h2 id="connect-repo-heading" className="text-[15px] font-semibold">
            Connect a GitHub repository
          </h2>
          <p className="text-sm text-muted-foreground">
            {locked
              ? "You can open every project in this workspace. Connecting and removing repositories needs the manager or org-admin role."
              : "Paste the URL of a public repository to add it to this workspace."}
          </p>
        </div>
      </div>

      <form
        className="mt-4 flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <Input
          className="h-8 min-w-0 flex-1"
          placeholder="https://github.com/owner/repo"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          aria-label="Repository URL"
          disabled={locked || busy}
        />
        {lockedReason ? (
          <LockedAction reason={lockedReason}>{button}</LockedAction>
        ) : (
          button
        )}
      </form>
    </section>
  )
}
