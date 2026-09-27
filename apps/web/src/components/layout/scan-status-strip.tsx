"use client"

import { Square } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  isActivePhase,
  useScanLive,
  type TrackedScan,
} from "@/hooks/use-scan-center"

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
}: Readonly<{
  scan: TrackedScan | undefined
  canStop: boolean
  onStop: () => void
}>) {
  // The same bar as the panel, from the app-wide store: it never restarts.
  const live = useScanLive(scan?.key)
  const active = Boolean(
    scan && scan.job === "scanning" && isActivePhase(scan.status.phase),
  )
  if (!scan || !active) return null

  const queued = scan.status.phase === "queued"
  const progress = Math.floor(live?.bar ?? 0)
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
