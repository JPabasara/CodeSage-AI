"use client"

import { Loader2, Play, Square } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { LockedAction } from "@/components/locked-action"
import { ScanButtonLabel } from "@/components/layout/scan-button-label"
import type { ScanPhase } from "@/lib/types"
import { cn } from "@/lib/utils"

export type ScanControlProps = {
  phase: ScanPhase
  progress: number // 0–100
  /** Stop has been requested but the scan has not reached a terminal phase yet. */
  stopping?: boolean
  scoring?: boolean
  /** Names the button: "Scan main". */
  branch?: string
  /** `lg` is the page header's main action. */
  size?: "default" | "lg"
  onScan?: () => void
  onStop?: () => void
  lockedReason?: string
  /** False when Stop lives elsewhere (the dashboard's progress card) or the role cannot stop. */
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
  branch,
  size = "default",
  onScan,
  onStop,
  lockedReason,
  showStop = true,
}: Readonly<ScanControlProps>) {
  const large = size === "lg"
  const buttonSize = large ? "lg" : "sm"
  // The header's main action keeps its width while its words change, and a
  // long branch name never pushes it past `max-w-64` (ScanButtonLabel clips it).
  const buttonClass = cn(
    "max-w-64",
    large &&
      "h-10.5 min-w-40 gap-2 px-4.5 text-sm font-semibold [&_svg:not([class*='size-'])]:size-4",
  )
  const scanTitle = branch ? `Scan ${branch}` : undefined
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
          <Button
            size={buttonSize}
            // Busy, not unavailable: it keeps its full colour.
            className={cn(buttonClass, "disabled:opacity-100")}
            disabled
          >
            <Loader2
              className="animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
            {stopping
              ? "Stopping…"
              : scoring
                ? "Scoring…"
                : queued
                  ? "Queued…"
                  : progress > 0
                    ? `Scanning ${progress}%`
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
        {queued ? null : <Progress value={progress} className="w-24" />}
        <Button
          size="sm"
          variant="outline"
          onClick={onStop}
          disabled={stopping || !onStop}
        >
          <Square className="size-3.5" /> Stop
        </Button>
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
        <span className="text-sm text-muted-foreground">Cancelled</span>
        <Button
          size={buttonSize}
          className={buttonClass}
          title={scanTitle}
          onClick={onScan}
        >
          <Play /> <ScanButtonLabel branch={branch} />
        </Button>
      </div>
    )
  }

  if (lockedReason) {
    return (
      <LockedAction reason={lockedReason}>
        <Button size={buttonSize} className={buttonClass} disabled>
          <Play /> <ScanButtonLabel branch={branch} />
        </Button>
      </LockedAction>
    )
  }

  return (
    <Button
      size={buttonSize}
      className={buttonClass}
      title={scanTitle}
      onClick={onScan}
      disabled={!onScan}
    >
      <Play /> <ScanButtonLabel branch={branch} />
    </Button>
  )
}
