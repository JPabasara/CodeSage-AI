"use client"

import { Loader2, Play, Square } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { LockedAction } from "@/components/locked-action"
import type { ScanPhase } from "@/lib/types"

export type ScanControlProps = {
  phase: ScanPhase
  progress: number // 0–100
  /** Stop has been requested but the scan has not reached a terminal phase yet. */
  stopping?: boolean
  scoring?: boolean
  onBar?: boolean
  onScan?: () => void
  onStop?: () => void
  lockedReason?: string
  /** False when Stop lives elsewhere (the dashboard's status strip) or the role cannot stop. */
  showStop?: boolean
}

function ScanAnnouncement({
  phase,
  progress,
  stopping,
  scoring,
}: Readonly<
  Pick<ScanControlProps, "phase" | "progress" | "stopping" | "scoring">
>) {
  let message: string
  if (stopping) message = "Stopping the scan"
  else if (scoring) message = "Scan finished, calculating the health score"
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
  scoring = false,
  onScan,
  onStop,
  onBar = false,
  lockedReason,
  showStop = true,
}: Readonly<ScanControlProps>) {
  // On the mint bar the brand-mint button would vanish into its background.
  const scanClass = onBar ? "bg-white text-topbar hover:bg-white/90" : undefined
  const stopClass = onBar
    ? "border-white/30 bg-transparent text-topbar-foreground hover:bg-white/15 hover:text-topbar-foreground dark:bg-transparent"
    : undefined
  const queued = phase === "queued"
  const running = phase === "running" || queued

  if (running) {
    // "Queued" and "running" are different facts.
    let label: string
    if (stopping) label = "Stopping…"
    else if (scoring) label = "Scoring…"
    else if (queued) label = "Queued…"
    else label = `Scanning… ${progress}%`

    if (!showStop) {
      return (
        <>
          <Button size="sm" className={scanClass} disabled>
            <Loader2
              className="size-3.5 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
            {stopping
              ? "Stopping…"
              : scoring
                ? "Scoring…"
                : queued
                  ? "Queued…"
                  : "Scanning…"}
          </Button>
          <ScanAnnouncement
            phase={phase}
            progress={progress}
            stopping={stopping}
            scoring={scoring}
          />
        </>
      )
    }

    return (
      <div className="flex items-center gap-2">
        <span className="text-sm tabular-nums">{label}</span>
        {/* Queued has nothing to fill, and an empty bar reads as 0%, not as "not started". */}
        {queued || !showStop ? null : (
          <Progress
            value={progress}
            className={onBar ? "w-24 bg-white/25 *:bg-white" : "w-24"}
          />
        )}
        {showStop ? (
          <Button
            size="sm"
            variant="outline"
            className={stopClass}
            onClick={onStop}
            disabled={stopping || !onStop}
          >
            <Square className="size-3.5" /> Stop
          </Button>
        ) : null}
        <ScanAnnouncement
          phase={phase}
          progress={progress}
          stopping={stopping}
          scoring={scoring}
        />
      </div>
    )
  }

  if (phase === "cancelled") {
    return (
      <div className="flex items-center gap-2">
        <span
          className={
            onBar ? "text-sm opacity-75" : "text-muted-foreground text-sm"
          }
        >
          Cancelled
        </span>
        <Button size="sm" className={scanClass} onClick={onScan}>
          <Play className="size-3.5" /> Scan
        </Button>
      </div>
    )
  }

  if (lockedReason) {
    return (
      <LockedAction reason={lockedReason}>
        <Button size="sm" className={scanClass} disabled>
          <Play className="size-3.5" /> Scan
        </Button>
      </LockedAction>
    )
  }

  return (
    <Button size="sm" className={scanClass} onClick={onScan} disabled={!onScan}>
      <Play className="size-3.5" /> Scan
    </Button>
  )
}
