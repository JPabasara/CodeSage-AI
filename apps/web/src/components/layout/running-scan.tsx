"use client"

import {
  isStopping,
  useActiveScans,
  useScanLive,
} from "@/hooks/use-scan-center"
import { reportedProgress, toBar } from "@/lib/scan-progress"
import type { ActiveScan, Repo } from "@/lib/types"

export interface RunningScan {
  /** "Scanning", "Queued" or "Stopping". */
  label: string
  /** 0–100 on the same bar the dashboard shows; undefined while queued. */
  bar: number | undefined
}

/**
 * A project's scan right now, from the scan this tab follows or, for a scan
 * started elsewhere (another tab, a teammate), from the workspace's activity.
 * The Overview and the Projects page read the same answer.
 */
export function useRunningScan(
  repo: Repo,
  activity: ActiveScan[] | undefined,
): RunningScan | undefined {
  const tracked = useActiveScans().find(
    (scan) =>
      scan.repoId === repo.id &&
      scan.branch === repo.default_branch &&
      scan.job !== "ready",
  )
  const live = useScanLive(tracked?.key)
  const elsewhere = activity?.find((item) => item.repo_id === repo.id)
  if (tracked) {
    return {
      label: isStopping(tracked)
        ? "Stopping"
        : tracked.status.phase === "queued"
          ? "Queued"
          : "Scanning",
      bar: live?.bar,
    }
  }
  if (elsewhere) {
    const queued = elsewhere.status.phase === "queued"
    return {
      label: elsewhere.status.cancel_requested
        ? "Stopping"
        : queued
          ? "Queued"
          : "Scanning",
      bar: queued ? undefined : toBar(reportedProgress(elsewhere.status)),
    }
  }
  return undefined
}

/** The label, the percentage and a slim bar, for a table cell. */
export function RunningScanCell({
  running,
}: Readonly<{ running: RunningScan }>) {
  const value = running.bar === undefined ? undefined : Math.floor(running.bar)
  return (
    <div className="flex min-w-36 flex-col gap-1.5">
      <span className="text-xs font-medium text-foreground-strong tabular-nums">
        {running.label}
        {value !== undefined ? ` · ${value}%` : "…"}
      </span>
      <span
        role="progressbar"
        aria-label="Scan progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        className="relative block h-1.5 overflow-hidden rounded-full bg-primary/15"
      >
        {value !== undefined ? (
          <span
            className="block h-full rounded-full bg-primary transition-[width] duration-300 motion-reduce:transition-none"
            style={{ width: `${value}%` }}
          />
        ) : (
          <span className="block h-full w-1/3 rounded-full bg-primary motion-safe:animate-[scan-sweep_1.4s_ease-in-out_infinite]" />
        )}
      </span>
    </div>
  )
}
