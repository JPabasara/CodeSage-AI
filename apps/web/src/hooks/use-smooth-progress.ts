"use client"

import { useEffect, useRef, useState } from "react"

import {
  creepTarget,
  nextShown,
  reportedProgress,
  SCAN_SHARE,
  scoringTarget,
  stageOf,
  toBar,
} from "@/lib/scan-progress"
import type { ScanStatus } from "@/lib/types"

/** How often the bar is redrawn while a scan runs. */
export const SMOOTH_TICK_MS = 100

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)"

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(REDUCED_MOTION).matches
  )
}

/**
 * The position of the one bar for a scan and its score (13H.4), 0–100.
 *
 * The scan fills the first {@link SCAN_SHARE}%: it creeps within the current
 * stage's band, glides to real numbers, and only ever moves forward. Once the
 * scan is done and `scoring` is true, the same bar carries on through the last
 * section while the health score is calculated.
 *
 * Undefined while there is no number to show — no scan, or one still queued —
 * so the caller can draw an indeterminate bar instead of a stalled 0%.
 *
 * Computed once per dashboard and handed to every bar on it, so the top bar
 * and the panel never disagree.
 */
export function useSmoothProgress(
  status: ScanStatus | undefined,
  scoringNow = false,
): number | undefined {
  const running = status?.phase === "running"
  const scoring = !running && scoringNow
  const scanId = status?.scan_id
  const stage = status ? stageOf(status) : undefined

  const [shown, setShown] = useState(0)
  // What the interval reads. Refs, so a poll landing does not restart it.
  const latest = useRef(status)
  const scoringFrom = useRef<number | undefined>(undefined)
  const stageStartedAt = useRef(0)
  const lastScan = useRef<string | undefined>(undefined)
  const lastStage = useRef<string | undefined>(undefined)

  useEffect(() => {
    latest.current = status
  })

  // The score's wait starts when it is first seen, and its clock drives the
  // creep through the bar's last section.
  useEffect(() => {
    scoringFrom.current = scoring ? Date.now() : undefined
  }, [scoring])

  // A new stage restarts its creep clock; a new scan starts from zero. A scan
  // that has ended (no status) keeps the bar where it is, for the score.
  useEffect(() => {
    if (scanId && scanId !== lastScan.current) {
      lastScan.current = scanId
      lastStage.current = undefined
      setShown(0)
    }
    if (stage && stage !== lastStage.current) {
      lastStage.current = stage
      stageStartedAt.current = Date.now()
    }
  }, [scanId, stage])

  useEffect(() => {
    if (!running && !scoring) return
    const reduced = prefersReducedMotion()
    let last = Date.now()
    const id = setInterval(() => {
      const now = Date.now()
      const current = latest.current
      let reported: number
      let target: number
      if (current?.phase === "running") {
        reported = toBar(reportedProgress(current))
        target = reduced
          ? reported
          : toBar(creepTarget(current, now - stageStartedAt.current))
      } else if (scoringFrom.current !== undefined) {
        reported = SCAN_SHARE
        target = reduced ? reported : scoringTarget(now - scoringFrom.current)
      } else {
        return
      }
      const dt = now - last
      last = now
      setShown((value) => nextShown(value, target, dt, reduced, reported))
    }, SMOOTH_TICK_MS)
    return () => clearInterval(id)
  }, [running, scoring, scanId])

  return running || scoring ? shown : undefined
}
