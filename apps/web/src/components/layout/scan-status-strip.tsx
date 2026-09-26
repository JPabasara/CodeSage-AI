"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Square } from "lucide-react"

import { Button } from "@/components/ui/button"
import { dashboardHrefFor } from "@/components/layout/scan-center"
import {
  isActivePhase,
  useActiveScans,
  type TrackedScan,
} from "@/hooks/use-scan-center"
import { cn } from "@/lib/utils"

/** "1m 12s" — minutes and seconds, the way a person reads a wait. */
export function formatElapsed(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`
}

/**
 * The slim bar under the app bar while this dashboard's scan is queued or
 * running: what is being scanned, a thin line for how far along — and Stop.
 * The percentage and the clock are in the scan panel in the middle, so they
 * are not repeated here.
 *
 * Nothing here polls. The scan store does that once, for every screen.
 */
export function ScanStatusStrip({
  scan,
  canStop,
  onStop,
  progress: smoothed,
}: Readonly<{
  scan: TrackedScan | undefined
  canStop: boolean
  onStop: () => void
  /** The dashboard's smoothed percentage (13H.4); the raw one when absent. */
  progress?: number
}>) {
  const active = Boolean(scan && isActivePhase(scan.status.phase))
  if (!scan || !active) return null

  const queued = scan.status.phase === "queued"
  const progress = Math.floor(smoothed ?? scan.status.progress)
  const determinate = !queued && progress > 0
  const what = `${scan.repoName ?? "this project"} on ${scan.branch}`
  const label = scan.stopping
    ? `Stopping the scan of ${what}…`
    : queued
      ? `Queued · ${what} · waiting for a worker`
      : `Scanning ${what}`

  return (
    <div
      data-testid="scan-status-strip"
      className="relative shrink-0 border-b bg-card"
    >
      <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
        <span
          className="size-2 shrink-0 rounded-full bg-primary motion-safe:animate-pulse"
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
        {canStop ? (
          <Button
            size="sm"
            variant="outline"
            onClick={onStop}
            disabled={scan.stopping || !scan.status.scan_id}
          >
            <Square className="size-3.5" aria-hidden="true" />
            {scan.stopping ? "Stopping…" : "Stop"}
          </Button>
        ) : null}
      </div>
      {/* A thin mint line: its fill when there is a number, a slow sweep while
          there is not. Under reduced motion the sweep is a still bar. */}
      <div
        className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-primary/15"
        aria-hidden="true"
      >
        {determinate ? (
          <div
            className="h-full bg-primary"
            style={{ width: `${progress}%` }}
          />
        ) : (
          <div className="h-full w-1/3 bg-primary motion-safe:animate-[scan-sweep_1.4s_ease-in-out_infinite]" />
        )}
      </div>
    </div>
  )
}

/**
 * On every other page, a small "Scanning ‹project›" in the app bar that leads
 * back to it. Hidden on the dashboard that already shows the strip.
 */
export function ScanPill() {
  const pathname = usePathname()
  const scans = useActiveScans().filter((scan) =>
    isActivePhase(scan.status.phase),
  )
  const shown = scans.filter(
    (scan) =>
      !pathname.startsWith(`/dashboard/${scan.repoId}`) ||
      pathname.endsWith("/history"),
  )
  if (shown.length === 0) return null
  const first = shown[0]
  const text =
    shown.length === 1
      ? `Scanning ${first.repoName ?? "a project"}`
      : `${shown.length} scans running`

  return (
    <Link
      href={dashboardHrefFor(first.repoId, first.branch)}
      data-testid="scan-pill"
      className={cn(
        "inline-flex h-8 max-w-48 items-center gap-2 rounded-md border border-white/25 px-3 text-xs font-medium text-topbar-foreground outline-none transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/70",
      )}
    >
      <span
        className="size-1.5 shrink-0 rounded-full bg-white motion-safe:animate-pulse"
        aria-hidden="true"
      />
      <span className="truncate">{text}</span>
    </Link>
  )
}
