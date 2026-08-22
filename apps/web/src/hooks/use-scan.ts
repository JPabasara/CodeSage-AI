"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import { getScanStatus, startScan, stopScan } from "@/lib/api/client"
import type { ScanStatus } from "@/lib/types"

// ~6 polls × 17% ≈ 4s from 0 → done; slow enough to watch, fast enough to demo.
const POLL_MS = 600
const IDLE: ScanStatus = { scan_id: "", phase: "idle", progress: 0 }

/**
 * Drives the Scan button. `scan(branch)` POSTs to start, then polls the scan
 * endpoint until the backend says `done`; `stop()` cancels. `onComplete` runs
 * once on success — the dashboard uses it to refetch the health report (9.3).
 *
 * State is only ever set inside callbacks (never in the effect body), so this
 * stays clear of React 19's react-hooks/set-state-in-effect rule.
 */
export function useScan(repoId: string, onComplete?: () => void) {
  const [status, setStatus] = useState<ScanStatus>(IDLE)
  // True from the moment Stop is pressed until the scan actually reaches a
  // terminal phase. The backend keeps reporting "running" in that window, so
  // without this the button looks like it did nothing and users press it again.
  const [stopping, setStopping] = useState(false)
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined)

  const clearTimer = useCallback(() => {
    if (timer.current) clearInterval(timer.current)
    timer.current = undefined
  }, [])

  // Only job of the effect: stop polling if the user navigates away mid-scan.
  useEffect(() => () => clearTimer(), [clearTimer])

  const scan = useCallback(
    async (branch: string) => {
      clearTimer()
      setStopping(false) // a fresh scan clears any leftover stopping state
      const started = await startScan(repoId, branch) // phase: "running", progress: 0
      setStatus(started)
      timer.current = setInterval(async () => {
        const next = await getScanStatus(repoId, started.scan_id)
        setStatus(next)
        // Three terminal phases, not two. `cancelled` ends the poll loop just
        // like `done` and `error` — miss it and the UI polls a dead scan forever.
        if (
          next.phase === "done" ||
          next.phase === "error" ||
          next.phase === "cancelled"
        ) {
          clearTimer()
          setStopping(false)
          if (next.phase === "done") {
            toast.success("Scan complete")
            onComplete?.()
          } else if (next.phase === "cancelled") {
            toast("Scan cancelled")
          } else {
            toast.error(next.error ?? "Scan failed")
          }
        }
      }, POLL_MS)
    },
    [repoId, onComplete, clearTimer],
  )

  /**
   * Ask the backend to cancel. Deliberately does NOT stop polling.
   *
   * Cancellation is cooperative: the POST returns 202 with the phase usually
   * still "running", because the worker only stops at the next stage boundary.
   * The scan is over when a poll reports "cancelled" — and that poll is what
   * clears the timer and raises the toast. Clearing the timer here instead would
   * strand the UI on "Scanning…" forever.
   */
  const stop = useCallback(async () => {
    setStopping(true)
    try {
      setStatus(await stopScan(repoId, status.scan_id))
    } catch {
      // The request never landed, so nothing is going to stop. Release the flag
      // rather than stranding the button on "Stopping…" forever.
      setStopping(false)
      toast.error("Couldn't stop the scan")
    }
  }, [repoId, status.scan_id])

  return { status, stopping, scan, stop }
}
