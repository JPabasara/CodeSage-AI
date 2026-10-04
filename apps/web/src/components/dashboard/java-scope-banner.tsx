"use client"

import { useState, useSyncExternalStore } from "react"
import Link from "next/link"
import { Info, X } from "lucide-react"

import { Button } from "@/components/ui/button"

const numbers = new Intl.NumberFormat("en-US")

function readDismissed(key: string) {
  try {
    return localStorage.getItem(key) === "1"
  } catch {
    return false
  }
}

const noSubscription = () => () => {}

/**
 * Says plainly what a scan looked at: Java only. Dismissed per person and
 * project; the dashboard shows it again for any other project.
 */
export function JavaScopeBanner({
  storageKey,
  fileCount,
  kloc,
}: Readonly<{
  /** Where the dismissal is remembered; undefined until the session is known. */
  storageKey: string | undefined
  fileCount: number
  kloc?: number | null
}>) {
  const stored = useSyncExternalStore(
    noSubscription,
    () => (storageKey ? readDismissed(storageKey) : true),
    () => true,
  )
  const [dismissedNow, setDismissedNow] = useState(false)
  if (stored || dismissedNow) return null

  const lines =
    kloc !== undefined && kloc !== null && kloc > 0
      ? ` (${kloc >= 10 ? Math.round(kloc) : kloc.toFixed(1)}k lines)`
      : ""

  return (
    <div
      role="note"
      data-testid="java-scope-banner"
      className="flex items-start gap-3 rounded-md border border-l-[3px] border-l-primary bg-card px-3.5 py-3 text-sm"
    >
      <Info
        className="mt-0.5 size-4 shrink-0 text-primary"
        aria-hidden="true"
      />
      <p className="min-w-0 flex-1 text-foreground">
        <strong className="font-semibold text-foreground-strong">
          Java only.
        </strong>{" "}
        This scan analysed{" "}
        <strong className="font-semibold text-foreground-strong tabular-nums">
          {numbers.format(fileCount)} .java {fileCount === 1 ? "file" : "files"}
        </strong>
        {lines}. <code className="font-mono text-[0.84375rem]">pom.xml</code>{" "}
        and <code className="font-mono text-[0.84375rem]">build.gradle</code>{" "}
        are read only to detect the Java version; Markdown, resources, configs
        and other languages are not scored.{" "}
        <Link
          href="/help/what-is-analysed"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          What is analysed
        </Link>
      </p>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="-mt-1 -mr-1 shrink-0"
        aria-label="Dismiss for this project"
        onClick={() => {
          setDismissedNow(true)
          try {
            if (storageKey) localStorage.setItem(storageKey, "1")
          } catch {
            // Blocked storage: it simply comes back next visit.
          }
        }}
      >
        <X />
      </Button>
    </div>
  )
}

export function javaBannerKey(
  userId: string,
  workspaceId: string,
  repoId: string,
) {
  return `codesage.javaBanner.v1:${userId}:${workspaceId}:${repoId}`
}
