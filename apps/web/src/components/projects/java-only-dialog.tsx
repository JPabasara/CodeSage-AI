"use client"

import { useRef, useState } from "react"
import Link from "next/link"
import { CircleCheck, Play, X } from "lucide-react"

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"

/** "connect" adds the repository; "scan" also queues its first scan. */
export type ConnectMode = "connect" | "scan"

export function javaOnlyAckKey(userId: string, workspaceId: string) {
  return `codesage.javaOnlyAck.v1:${userId}:${workspaceId}`
}

/** The choice saved with "Don't show this again", or undefined when the dialog should show. */
export function readJavaOnlyAck(
  key: string | undefined,
): ConnectMode | undefined {
  if (!key) return undefined
  try {
    const value = localStorage.getItem(key)
    if (!value) return undefined
    return value === "connect" ? "connect" : "scan"
  } catch {
    return undefined
  }
}

function writeJavaOnlyAck(key: string, mode: ConnectMode) {
  try {
    localStorage.setItem(key, mode)
  } catch {
    // Blocked storage: the dialog simply shows again next time.
  }
}

/** "owner/repo" out of a URL that already passed isGitHubRepositoryUrl. */
export function repositoryLabel(url: string) {
  try {
    return new URL(url).pathname
      .replace(/\.git\/?$/, "")
      .split("/")
      .filter(Boolean)
      .join("/")
  } catch {
    return url
  }
}

const ANALYSED = [
  <>
    <code className="font-mono text-xs">.java</code> files on the branch you
    scan
  </>,
  "Test code, tagged separately so it can be filtered",
  <>
    <code className="font-mono text-xs">pom.xml</code> /{" "}
    <code className="font-mono text-xs">build.gradle</code>, only to detect the
    Java version
  </>,
  "Git history, for change frequency",
]

const NOT_ANALYSED = [
  <>
    Markdown and docs (<code className="font-mono text-xs">.md</code>)
  </>,
  "Resources, XML, properties, YAML",
  "Other languages (Kotlin, JavaScript, Python…)",
  "Files over 1 MB and binaries",
]

function ScopeBox({
  title,
  icon,
  items,
  className,
}: Readonly<{
  title: string
  icon: React.ReactNode
  items: React.ReactNode[]
  className: string
}>) {
  return (
    <div className="rounded-md border px-3.5 py-3">
      <h3
        className={`mb-2 flex items-center gap-1.5 text-sm font-semibold ${className}`}
      >
        {icon}
        {title}
      </h3>
      <ul className="grid gap-1.5 text-sm text-foreground">
        {items.map((item, index) => (
          <li key={index} className="flex items-baseline gap-2">
            <span aria-hidden="true" className="text-muted-foreground">
              •
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Unmounts with the dialog, so the checkbox starts clear on every open. */
function JavaOnlyBody({
  ackKey,
  scanRef,
  onConfirm,
}: Readonly<{
  ackKey: string | undefined
  scanRef: React.RefObject<HTMLButtonElement | null>
  onConfirm: (mode: ConnectMode) => void
}>) {
  const [dontShow, setDontShow] = useState(false)
  const confirm = (mode: ConnectMode) => {
    if (dontShow && ackKey) writeJavaOnlyAck(ackKey, mode)
    onConfirm(mode)
  }

  return (
    <>
      {/* Step 1: the Java-only notice. */}
      <section aria-label="What the scan looks at" className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <ScopeBox
            title="Analysed"
            icon={<CircleCheck className="size-4" aria-hidden="true" />}
            items={ANALYSED}
            className="text-trend-up"
          />
          <ScopeBox
            title="Not analysed"
            icon={<X className="size-4" aria-hidden="true" />}
            items={NOT_ANALYSED}
            className="text-muted-foreground"
          />
        </div>
        <Link
          href="/help/what-is-analysed"
          target="_blank"
          rel="noreferrer"
          className="w-fit rounded-sm text-xs font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          What is analysed
          <span className="sr-only"> (opens in a new tab)</span>
        </Link>
      </section>

      {/* Step 2 (Chamodh's folders to skip) slots in here; the footer below stays the same. */}

      <label className="flex w-fit items-center gap-2 text-sm text-muted-foreground">
        <input
          type="checkbox"
          checked={dontShow}
          disabled={!ackKey}
          onChange={(event) => setDontShow(event.target.checked)}
          className="size-4 rounded border-border accent-primary"
        />
        Don&apos;t show this again in this workspace
      </label>

      <AlertDialogFooter className="mt-1">
        <AlertDialogCancel variant="ghost" className="h-9 px-3.5 text-sm">
          Cancel
        </AlertDialogCancel>
        <Button
          type="button"
          variant="outline"
          className="h-9 px-3.5 text-sm"
          onClick={() => confirm("connect")}
        >
          Connect only
        </Button>
        <Button
          ref={scanRef}
          type="button"
          className="h-9 gap-1.5 px-3.5 text-sm"
          onClick={() => confirm("scan")}
        >
          <Play aria-hidden="true" />
          Connect and scan
        </Button>
      </AlertDialogFooter>
    </>
  )
}

/**
 * Says what a scan will and will not read before a repository is connected,
 * then connects it, with or without its first scan.
 */
export function JavaOnlyDialog({
  repository,
  ackKey,
  onConfirm,
  onCancel,
}: Readonly<{
  /** "owner/repo" while the dialog is open; undefined closes it. */
  repository: string | undefined
  /** Where "Don't show this again" is kept; undefined until the session is known. */
  ackKey: string | undefined
  onConfirm: (mode: ConnectMode) => void
  onCancel: () => void
}>) {
  const scanRef = useRef<HTMLButtonElement>(null)

  return (
    <AlertDialog
      open={Boolean(repository)}
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
    >
      <AlertDialogContent
        className="gap-4 p-5 data-[size=default]:max-w-[calc(100%-2rem)] data-[size=default]:sm:max-w-140"
        // Connect and scan is the usual next step, so Enter takes it; Esc and Cancel close.
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          scanRef.current?.focus()
        }}
      >
        <AlertDialogHeader className="gap-1.5">
          <AlertDialogTitle className="text-lg font-semibold text-foreground-strong">
            Connect {repository}?
          </AlertDialogTitle>
          <AlertDialogDescription className="text-sm text-muted-foreground">
            CodeSage analyses{" "}
            <span className="font-medium text-foreground">
              Java source code only
            </span>
            . Here is what the scan will and will not look at.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <JavaOnlyBody ackKey={ackKey} scanRef={scanRef} onConfirm={onConfirm} />
      </AlertDialogContent>
    </AlertDialog>
  )
}
