"use client"

import { Play, Square } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import type { ScanPhase } from "@/lib/types"

export type ScanControlProps = {
  phase: ScanPhase
  progress: number // 0–100
  /** Stop has been requested but the scan has not reached a terminal phase yet. */
  stopping?: boolean
  onScan?: () => void
  onStop?: () => void
}

/**
 * What a screen reader hears while a scan runs (U-9).
 *
 * Separate from the visible label, and deliberately coarser. The visible text
 * ticks through every percentage the poll returns; announcing each one would
 * read a number aloud that has already changed by the time the sentence ends.
 * Rounding to a quarter turns roughly six updates into four useful ones.
 *
 * `polite`, never `assertive`: progress must wait its turn rather than cut into
 * whatever the user is reading.
 */
function ScanAnnouncement({
  phase,
  progress,
  stopping,
}: Readonly<Pick<ScanControlProps, "phase" | "progress" | "stopping">>) {
  let message: string
  if (stopping) message = "Stopping the scan"
  else if (phase === "queued") message = "Scan queued, waiting for a worker"
  else message = `Scanning, ${Math.floor(progress / 25) * 25} percent complete`

  return (
    <span role="status" aria-live="polite" className="sr-only">
      {message}
    </span>
  )
}

export function ScanControl({
  phase,
  progress,
  stopping,
  onScan,
  onStop,
}: Readonly<ScanControlProps>) {
  const queued = phase === "queued"
  const running = phase === "running" || queued

  if (running) {
    // "Queued" and "running" are different facts. Queued means no worker has
    // picked the job up, so there is no progress to report — and rendering that
    // as "Scanning… 0%" claimed work had started and then stalled, which is the
    // reading that makes someone press Stop on a scan that never began.
    let label: string
    if (stopping) label = "Stopping…"
    else if (queued) label = "Queued…"
    else label = `Scanning… ${progress}%`

    return (
      <div className="flex items-center gap-2">
        {/*
          Cancellation is cooperative: the worker only checks the flag between
          pipeline stages, so the phase stays "running" for up to a full stage
          after Stop is pressed. Saying so is the difference between "working on
          it" and "that button is broken".
        */}
        <span className="text-sm tabular-nums">{label}</span>
        {/* Queued has nothing to fill, and an empty bar reads as 0%, not as
            "not started". The label carries it alone until work begins. */}
        {queued ? null : <Progress value={progress} className="w-24" />}
        <Button
          size="sm"
          variant="outline"
          onClick={onStop}
          disabled={stopping}
        >
          <Square className="size-3.5" /> Stop
        </Button>
        <ScanAnnouncement
          phase={phase}
          progress={progress}
          stopping={stopping}
        />
      </div>
    )
  }

  // Cancelled is NOT idle. Without this branch it falls through to the plain
  // Scan button below and a stopped scan looks identical to one that never ran —
  // the compiler cannot catch it, because nothing here is an exhaustive switch.
  if (phase === "cancelled") {
    return (
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground text-sm">Cancelled</span>
        <Button size="sm" onClick={onScan}>
          <Play className="size-3.5" /> Scan
        </Button>
      </div>
    )
  }

  return (
    <Button size="sm" onClick={onScan}>
      <Play className="size-3.5" /> Scan
    </Button>
  )
}
