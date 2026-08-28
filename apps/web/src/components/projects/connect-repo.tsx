"use client"

import { useState } from "react"
import { Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

// An example URL box and a Connect button with inline validation. There is
// deliberately no private-repository option — connecting one needs a GitHub App
// installation, which is v2. An earlier version advertised it as a disabled tab,
// promising a feature two releases away.
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
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <Input
        placeholder="https://github.com/owner/repo"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        aria-label="Repository URL"
        disabled={busy}
      />
      <Button type="submit" disabled={busy || !url.trim()}>
        <Plus className="size-4" /> {busy ? "Connecting…" : "Connect"}
      </Button>
    </form>
  )
}
