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
      const started = await startScan(repoId, branch) // phase: "running", progress: 0
      setStatus(started)
      timer.current = setInterval(async () => {
        const next = await getScanStatus(repoId, started.scan_id)
        setStatus(next)
        if (next.phase === "done" || next.phase === "error") {
          clearTimer()
          if (next.phase === "done") {
            toast.success("Scan complete")
            onComplete?.()
          } else {
            toast.error(next.error ?? "Scan failed")
          }
        }
      }, POLL_MS)
    },
    [repoId, onComplete, clearTimer],
  )

  const stop = useCallback(async () => {
    clearTimer() // stop polling *first* so a late tick can't re-paint "running"
    const stopped = await stopScan(repoId, status.scan_id)
    setStatus(stopped) // phase: "idle", progress: 0
    toast("Scan stopped")
  }, [repoId, status.scan_id, clearTimer])

  return { status, scan, stop }
}
