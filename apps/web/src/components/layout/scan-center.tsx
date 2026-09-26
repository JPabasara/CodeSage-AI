"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import {
  acknowledgeScan,
  onScanEvent,
  resumeScans,
  startScan,
  type ScanTarget,
  type TrackedScan,
} from "@/hooks/use-scan-center"
import { useActiveWorkspaceId } from "@/hooks/use-workspace-scope"

const nameOf = (scan: Pick<TrackedScan, "repoName">) =>
  scan.repoName ?? "this project"

export function dashboardHrefFor(repoId: string, branch: string) {
  return `/dashboard/${repoId}?${new URLSearchParams({ branch })}`
}

const signed = (delta: number) =>
  `${delta >= 0 ? "+" : "−"}${Math.abs(Math.round(delta))}`

/**
 * What the app says about scans, from wherever the user happens to be.
 *
 * Mounted once in the app shell, so the "finished" toast reaches you on the
 * Projects page as surely as on the dashboard, and a refresh picks up the scans
 * this tab was following. Renders nothing.
 */
export function ScanCenter() {
  const router = useRouter()
  const workspaceId = useActiveWorkspaceId()

  // After a refresh, or switching back to a workspace: resume its scans.
  useEffect(() => {
    if (workspaceId) resumeScans(workspaceId)
  }, [workspaceId])

  useEffect(() => {
    const retry = (target: ScanTarget) => ({
      label: "Try again",
      onClick: () => void startScan(target),
    })
    // "View dashboard" is also "Show them": the user asked for the new
    // results, so the dashboard should not keep the previous ones pinned.
    const view = (scan: TrackedScan) => ({
      label: "View dashboard",
      onClick: () => {
        acknowledgeScan(scan.key)
        router.push(dashboardHrefFor(scan.repoId, scan.branch))
      },
    })

    return onScanEvent((event) => {
      switch (event.type) {
        case "queued":
          toast(`Scan queued · ${nameOf(event.scan)} · ${event.scan.branch}`)
          return
        case "attached":
          toast(
            `Already scanning ${nameOf(event.scan)} on ${event.scan.branch} — showing that scan`,
          )
          return
        case "finished": {
          // Sent once the score is ready too, so the toast has the news. A
          // score that came too late still ends the job, and says so.
          const { scan, report } = event
          if (report) {
            toast.success(`${nameOf(scan)} · ${scan.branch} is ready`, {
              description: `Health ${Math.round(report.health_score)} (${report.grade}) · ${signed(report.delta)} since the last scan`,
              action: view(scan),
            })
          } else {
            toast.success(`Scan complete · ${nameOf(scan)} · ${scan.branch}`, {
              description:
                "The health score is still being calculated. It will appear on the dashboard.",
              action: view(scan),
            })
          }
          return
        }
        case "up-to-date":
          toast(`${nameOf(event.scan)} is already up to date`, {
            description: `No new commits on ${event.scan.branch} since the last scan.`,
            action: view(event.scan),
          })
          return
        case "cancelled":
          toast(`Scan stopped · ${nameOf(event.scan)} · ${event.scan.branch}`, {
            description: "The previous results are unchanged.",
            action: retry(event.scan),
          })
          return
        case "failed":
          toast.error(`Scan failed · ${nameOf(event.scan)}`, {
            description: event.reason,
            action: retry(event.scan),
          })
          return
        case "start-failed":
          toast.error("Couldn't start the scan", {
            description: event.reason,
            action: retry(event.target),
          })
          return
        case "stop-failed":
          toast.error("Couldn't stop the scan", {
            description: "It is still running. Try Stop again.",
          })
      }
    })
  }, [router])

  return null
}
