"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { CircleCheck } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { dashboardHrefFor } from "@/components/layout/scan-center"
import { refreshActivity, useActivity } from "@/hooks/use-activity"
import {
  acknowledgeScan,
  isStopping,
  onScanEvent,
  useActiveScans,
  useScanLive,
  type TrackedScan,
} from "@/hooks/use-scan-center"
import {
  activityItems,
  busyCount,
  readyCount,
  type ActivityItem,
} from "@/lib/activity"
import {
  labelFor,
  reportedProgress,
  stepInfo,
  stepOf,
  toBar,
} from "@/lib/scan-progress"
import { cn } from "@/lib/utils"

export function ActivityMenu() {
  const tracked = useActiveScans()
  const server = useActivity()
  const items = useMemo(() => activityItems(tracked, server), [tracked, server])
  const busy = busyCount(items)
  const ready = readyCount(items)
  const [open, setOpen] = useState(false)

  // A job just ended here: the server's list is stale until it is asked.
  useEffect(
    () =>
      onScanEvent((event) => {
        if (event.type !== "queued") refreshActivity()
      }),
    [],
  )

  if (items.length === 0) return null

  const onlyItem = items.length === 1 ? items[0] : undefined
  const summary =
    busy === 0
      ? ready === 1
        ? "Results ready"
        : `${ready} results ready`
      : onlyItem
        ? itemTitle(onlyItem)
        : `${busy} running`

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="activity-trigger"
          aria-label={`Activity: ${busy} running${ready ? `, ${ready} ready` : ""}`}
          className="inline-flex h-8.5 max-w-56 items-center gap-2 rounded-full bg-tb-pill px-3 text-[0.8125rem] font-medium text-tb-fg outline-none transition-colors hover:bg-tb-hover focus-visible:ring-2 focus-visible:ring-tb-focus"
        >
          {busy > 0 ? (
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-full bg-tb-dot motion-safe:animate-pulse"
            />
          ) : (
            <CircleCheck
              aria-hidden="true"
              className="size-3.5 shrink-0 text-tb-muted"
            />
          )}
          <span className="truncate">{summary}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <p className="border-b px-3 py-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Activity
        </p>
        <ul
          aria-label="Running in this workspace"
          className="max-h-96 overflow-y-auto"
        >
          {items.map((item) => (
            <li key={item.key} className="border-b px-3 py-2.5 last:border-b-0">
              <ActivityRow item={item} onNavigate={() => setOpen(false)} />
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}

function itemTitle(item: ActivityItem) {
  if (item.kind === "job") {
    return item.scan.job === "ready"
      ? `${item.scan.repoName ?? "A project"} is ready`
      : item.scan.job === "scoring"
        ? `Scoring ${item.scan.repoName ?? "a project"}`
        : `Scanning ${item.scan.repoName ?? "a project"}`
  }
  if (item.kind === "scan") return `Scanning ${shortName(item.repoName)}`
  return `Re-scoring ${shortName(item.repoName)}`
}

/** "acme/payments" → "payments": the bar has little room. */
const shortName = (repoName: string) => repoName.split("/").pop() || repoName

function ActivityRow({
  item,
  onNavigate,
}: Readonly<{ item: ActivityItem; onNavigate: () => void }>) {
  if (item.kind === "job")
    return <JobRow scan={item.scan} onNavigate={onNavigate} />
  if (item.kind === "scan") {
    const queued = item.status.phase === "queued"
    const bar = queued ? undefined : toBar(reportedProgress(item.status))
    return (
      <Row
        title={`${item.repoName} · ${item.branch}`}
        detail={
          queued
            ? "Queued · waiting for a free slot"
            : `${labelFor(stepOf(item.status), item.status)} · ${Math.floor(bar ?? 0)}%`
        }
        bar={bar}
        href={dashboardHrefFor(item.repoId, item.branch)}
        onNavigate={onNavigate}
      />
    )
  }
  return (
    <Row
      title={item.repoName}
      detail={`Re-scoring under the current profile · ${item.snapshotsLeft} ${
        item.snapshotsLeft === 1 ? "scan" : "scans"
      } left`}
      bar={undefined}
      href={`/dashboard/${item.repoId}`}
      onNavigate={onNavigate}
    />
  )
}

/** A job this tab follows: the same live bar as the dashboard's panel. */
function JobRow({
  scan,
  onNavigate,
}: Readonly<{ scan: TrackedScan; onNavigate: () => void }>) {
  const router = useRouter()
  const live = useScanLive(scan.key)
  const href = dashboardHrefFor(scan.repoId, scan.branch)
  const title = `${scan.repoName ?? "This project"} · ${scan.branch}`

  if (scan.job === "ready") {
    return (
      <div className="flex items-center gap-3">
        <CircleCheck
          aria-hidden="true"
          className="size-4 shrink-0 text-primary"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{title}</p>
          <p className="text-xs text-muted-foreground">
            New results ready
            {scan.health
              ? ` · Health ${Math.round(scan.health.score)} (${scan.health.grade})`
              : ""}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            acknowledgeScan(scan.key)
            onNavigate()
            router.push(href)
          }}
        >
          View
        </Button>
      </div>
    )
  }

  const bar = live?.bar
  return (
    <Row
      title={title}
      detail={`${
        isStopping(scan)
          ? "Stopping the scan"
          : scan.job === "scoring"
            ? stepInfo("score").title
            : scan.status.phase === "queued"
              ? "Queued · waiting for a free slot"
              : labelFor(stepOf(scan.status), scan.status)
      }${bar !== undefined ? ` · ${Math.floor(bar)}%` : ""}`}
      bar={bar}
      href={href}
      onNavigate={onNavigate}
    />
  )
}

function Row({
  title,
  detail,
  bar,
  href,
  onNavigate,
}: Readonly<{
  title: string
  detail: string
  bar: number | undefined
  href: string
  onNavigate: () => void
}>) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{title}</p>
          <p className="truncate text-xs text-muted-foreground">{detail}</p>
        </div>
        <Button asChild size="sm" variant="ghost">
          {/* Named for what it opens: several rows, several "Open"s. */}
          <Link href={href} onClick={onNavigate} aria-label={`Open ${title}`}>
            Open
          </Link>
        </Button>
      </div>
      <div
        aria-hidden="true"
        className="relative h-1 w-full overflow-hidden rounded-full bg-primary/15"
      >
        {bar !== undefined ? (
          <div
            className="h-full rounded-full bg-primary"
            style={{ width: `${bar}%` }}
          />
        ) : (
          <div
            className={cn(
              "h-full w-1/3 rounded-full bg-primary",
              "motion-safe:animate-[scan-sweep_1.4s_ease-in-out_infinite]",
            )}
          />
        )}
      </div>
    </div>
  )
}
