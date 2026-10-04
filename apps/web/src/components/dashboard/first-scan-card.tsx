"use client"

import Link from "next/link"
import { Info, Play, ScanSearch } from "lucide-react"

import { LockedAction } from "@/components/locked-action"
import { Button } from "@/components/ui/button"

/** The branch picker in the top bar, opened for the user. */
function openBranchPicker() {
  const picker = document.querySelector<HTMLElement>(
    '[data-testid="app-top-bar"] [aria-label="Branch"]',
  )
  picker?.focus()
  picker?.click()
}

/**
 * A project with no scan on this branch: one clear next step instead of an
 * empty dashboard (what "Connect only" leads to).
 */
export function FirstScanCard({
  repoName,
  branch,
  otherBranches,
  onScan,
  lockedReason,
}: Readonly<{
  repoName: string
  branch: string
  /** Offer "Choose another branch" only when there is one. */
  otherBranches: boolean
  onScan?: () => void
  lockedReason?: string
}>) {
  const scanButton = (
    <Button
      className="h-10.5 min-w-40 gap-2 px-4.5 text-sm font-semibold"
      onClick={onScan}
      disabled={Boolean(lockedReason) || !onScan}
    >
      <Play className="size-4" aria-hidden="true" />
      {branch ? `Scan ${branch}` : "Scan"}
    </Button>
  )

  return (
    <section
      aria-labelledby="first-scan-title"
      data-testid="first-scan-card"
      className="mx-auto mt-4 flex w-full max-w-xl flex-col items-center rounded-md border bg-card px-7 py-8 text-center"
    >
      <div className="mb-4 grid size-[4.75rem] place-items-center rounded-full bg-accent text-primary">
        <ScanSearch className="size-8" aria-hidden="true" />
      </div>
      <h2
        id="first-scan-title"
        className="text-xl font-semibold text-foreground-strong"
      >
        Run the first scan of {repoName}
      </h2>
      <p className="mt-2 max-w-md text-sm text-balance text-muted-foreground">
        CodeSage will read the Java code on{" "}
        {branch ? (
          <span className="font-mono text-foreground">{branch}</span>
        ) : (
          "this branch"
        )}
        , rank the debt worth fixing first, and give the project a health score.
        It usually takes a couple of minutes.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {lockedReason ? (
          <LockedAction reason={lockedReason}>{scanButton}</LockedAction>
        ) : (
          scanButton
        )}
        {otherBranches ? (
          <Button
            variant="outline"
            className="h-10.5 px-4 text-sm"
            onClick={openBranchPicker}
          >
            Choose another branch
          </Button>
        ) : null}
      </div>
      <p className="mt-4 flex items-center gap-1.5 text-[0.8125rem] text-muted-foreground">
        <Info className="size-3.5" aria-hidden="true" />
        Only .java files are analysed.
        <Link
          href="/help/what-is-analysed"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          What is analysed
        </Link>
      </p>
    </section>
  )
}
