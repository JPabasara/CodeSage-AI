"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { getHealthReport } from "@/lib/api/client"
import {
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
    const view = (scan: TrackedScan) => ({
      label: "View",
      onClick: () => router.push(dashboardHrefFor(scan.repoId, scan.branch)),
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
          const { scan } = event
          // The score is the news. It may still be being prepared (the
          // snapshot lands before its score); then the toast just says done.
          getHealthReport(scan.repoId, scan.branch)
            .then((report) =>
              toast.success(
                `Scan finished · health ${Math.round(report.health_score)} (${signed(report.delta)})`,
                {
                  description: `${nameOf(scan)} · ${scan.branch}`,
                  action: view(scan),
                },
              ),
            )
            .catch(() =>
              toast.success(`Scan finished · ${nameOf(scan)}`, {
                description: `${scan.branch} · the score is being prepared`,
                action: view(scan),
              }),
            )
          return
        }
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
