"use client"

import { useState } from "react"
import { GitBranch, Link2, Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

// An example URL box and a Connect button with inline validation. There is
// deliberately no private-repository option; connecting one needs a later
// installation flow that is outside this PR.
export type ConnectRepoProps = {
  onConnect?: (url: string) => void
  /** A connect request is in flight; the form is locked until it settles. */
  busy?: boolean
}

export function ConnectRepo({ onConnect, busy }: Readonly<ConnectRepoProps>) {
  const [url, setUrl] = useState("")

  const submit = () => {
    const trimmed = url.trim()
    if (!trimmed || busy) return
    onConnect?.(trimmed)
    setUrl("")
  }

  return (
    <section className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground">
          <GitBranch className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Connect repository</h2>
          <p className="text-xs text-muted-foreground">
            Paste a public repository URL to add it to this workspace.
          </p>
        </div>
      </div>

      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <div className="relative min-w-0 flex-1">
          <Link2
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <label htmlFor="repo-url-input" className="sr-only">
            Repository URL
          </label>
          <Input
            id="repo-url-input"
            className="pl-8"
            placeholder="https://github.com/owner/repo"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            aria-label="Repository URL"
            disabled={busy}
          />
        </div>
        <Button
          type="submit"
          size="lg"
          disabled={busy || !url.trim()}
          className="sm:min-w-28"
        >
          <Plus className="size-4" /> {busy ? "Connecting..." : "Connect"}
        </Button>
      </form>
    </section>
  )
}
