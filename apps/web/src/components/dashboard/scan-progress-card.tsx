"use client"

import { useEffect, useState } from "react"
import {
  Check,
  CircleCheck,
  Clock,
  Hourglass,
  Loader2,
  Square,
} from "lucide-react"

import { formatElapsed, typicalLabel } from "@/lib/scan-messages"
import { Button } from "@/components/ui/button"
import {
  isActivePhase,
  slowOf,
  useScanLive,
  type TrackedScan,
} from "@/hooks/use-scan-center"
import {
  countLabel,
  STEPS,
  stepIndex,
  stepInfo,
  stepOf,
  type StepId,
} from "@/lib/scan-progress"
import { cn } from "@/lib/utils"

/** Ticks once a second while mounted — for the elapsed clock only. */
function useNow() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  return now
}

/** The seven steps as dots: done is filled, now is a ring, the rest are hollow. */
function Stepper({
  current,
  wide,
}: Readonly<{
  current: number
  /** Room for all seven on one line; the narrow first-scan card uses two rows. */
  wide: boolean
}>) {
  return (
    <ol
      aria-label="Scan steps"
      className={cn(
        "grid grid-cols-2 gap-x-1.5 gap-y-2 sm:grid-cols-4",
        wide && "xl:grid-cols-7",
      )}
    >
      {STEPS.map((step, index) => {
        const done = index < current
        const now = index === current
        return (
          <li
            key={step.id}
            aria-current={now ? "step" : undefined}
            data-state={done ? "done" : now ? "now" : "upcoming"}
            className={cn(
              "flex min-w-0 items-center gap-1.5 text-xs whitespace-nowrap",
              done && "text-foreground",
              now && "font-semibold text-foreground-strong",
              !done && !now && "text-muted-foreground",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "grid size-[1.125rem] shrink-0 place-items-center rounded-full border-[1.5px] bg-card",
                done && "border-primary bg-primary text-primary-foreground",
                now &&
                  "border-primary shadow-[0_0_0_3px_color-mix(in_oklab,var(--primary)_22%,transparent)]",
              )}
            >
              {done ? <Check className="size-3" strokeWidth={3} /> : null}
              {now ? (
                <span className="size-[0.4375rem] rounded-full bg-primary" />
              ) : null}
            </span>
            <span className="truncate">{step.label}</span>
            <span className="sr-only">
              {done ? " (done)" : now ? " (in progress)" : ""}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

/** New results waiting to be shown, after a scan finished on this page. */
function ReadyCard({
  scan,
  onShow,
}: Readonly<{ scan: TrackedScan; onShow?: () => void }>) {
  const health = scan.health
  const delta =
    health && health.delta !== 0
      ? ` (${health.delta > 0 ? "+" : ""}${Math.round(health.delta)})`
      : ""
  return (
    <div
      data-testid="scan-progress-panel"
      data-mode="ready"
      className="flex flex-wrap items-center gap-3 rounded-md border border-primary/35 bg-accent px-4 py-3"
    >
      <CircleCheck
        aria-hidden="true"
        className="size-5 shrink-0 text-primary motion-safe:animate-[panel-pop_400ms_ease-out]"
      />
      <div className="min-w-0 flex-1">
        <p
          role="status"
          className="text-sm font-semibold text-foreground-strong"
        >
          New results are ready
        </p>
        <p className="text-xs text-muted-foreground">
          {scan.repoName ?? "This project"} on {scan.branch}
          {health
            ? ` · Health ${Math.round(health.score)} (${health.grade})${delta}`
            : ""}
        </p>
      </div>
      <Button className="h-8 px-3 text-sm" onClick={onShow}>
        Show them
      </Button>
    </div>
  )
}

export interface ScanProgressCardProps {
  scan: TrackedScan
  /** "card" sits under the header; "full" is the first scan, with no report yet. */
  size?: "card" | "full"
  canStop?: boolean
  onStop?: () => void
  onShow?: () => void
}

/**
 * A running scan, told once: the step, its count, the bar and the stepper all
 * come from the same status, so they never disagree.
 */
export function ScanProgressCard({
  scan,
  size = "card",
  canStop = false,
  onStop,
  onShow,
}: Readonly<ScanProgressCardProps>) {
  const now = useNow()
  const live = useScanLive(scan.key)

  if (scan.job === "ready") {
    return size === "card" ? <ReadyCard scan={scan} onShow={onShow} /> : null
  }

  const queued = scan.job === "scanning" && scan.status.phase === "queued"
  const step: StepId | undefined = queued
    ? undefined
    : scan.job === "scoring"
      ? "score"
      : stepOf(scan.status)
  const current = step ? stepIndex(step) : -1
  const slow = slowOf(scan, now)
  const where = `${scan.repoName ?? "This project"} on ${scan.branch}`
  const count = step ? countLabel(step, scan.status) : undefined

  const title = scan.stopping
    ? "Stopping the scan"
    : queued
      ? "Queued"
      : stepInfo(step!).title
  const sub = queued
    ? `${where} · waiting for a worker`
    : [`Step ${current + 1} of ${STEPS.length}`, count, where]
        .filter(Boolean)
        .join(" · ")

  const bar = queued ? undefined : live?.bar
  const percent = bar === undefined ? undefined : Math.floor(bar)
  const elapsed = formatElapsed(now - scan.startedAt)
  const typical =
    scan.job === "scanning"
      ? typicalLabel(scan.status.typical_seconds)
      : undefined
  const stoppable =
    canStop &&
    scan.job === "scanning" &&
    isActivePhase(scan.status.phase) &&
    Boolean(onStop)

  const Icon = queued ? Clock : slow ? Hourglass : Loader2
  const full = size === "full"

  const progressbar = (
    <div
      role="progressbar"
      aria-label={scan.job === "scoring" ? "Score progress" : "Scan progress"}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className={cn(
        "relative w-full overflow-hidden rounded-full bg-primary/15",
        full ? "h-2.5" : "h-2",
      )}
    >
      {bar !== undefined ? (
        <div
          data-testid="scan-progress-fill"
          className="h-full rounded-full bg-primary transition-[width] duration-300 ease-linear motion-reduce:transition-none"
          style={{ width: `${bar}%` }}
        />
      ) : (
        <div className="h-full w-1/3 rounded-full bg-primary motion-safe:animate-[scan-sweep_1.4s_ease-in-out_infinite]" />
      )}
    </div>
  )

  const stopButton = stoppable ? (
    <Button
      variant="outline"
      className="h-8 px-3 text-sm"
      onClick={onStop}
      disabled={scan.stopping || !scan.status.scan_id}
    >
      <Square className="size-3.5" aria-hidden="true" />
      {scan.stopping ? "Stopping…" : "Stop"}
    </Button>
  ) : null

  // The step title is the one live region: it changes per step, which is worth hearing.
  const heading = (
    <p
      role="status"
      aria-live="polite"
      className={cn(
        "font-semibold text-foreground-strong",
        full ? "text-xl" : "text-[0.96875rem]",
      )}
    >
      {title}
    </p>
  )

  if (full) {
    return (
      <section
        data-testid="scan-progress-panel"
        data-mode={queued ? "queued" : step}
        data-size="full"
        data-slow={slow || undefined}
        aria-label="First scan"
        className="mx-auto mt-4 flex w-full max-w-2xl flex-col items-center rounded-md border bg-card px-7 py-8 text-center"
      >
        <div className="mb-4 grid size-[4.75rem] place-items-center rounded-full bg-accent text-primary">
          <Icon
            aria-hidden="true"
            className={cn(
              "size-8",
              Icon === Loader2 && "motion-safe:animate-spin",
              slow && "text-amber-600 dark:text-amber-400",
            )}
          />
        </div>
        {heading}
        <p className="mt-1 text-sm text-muted-foreground">{sub}</p>
        <div className="mt-5 w-full">{progressbar}</div>
        <div className="mt-2 flex w-full justify-between gap-3 text-[0.84375rem] text-muted-foreground tabular-nums">
          <span>
            {elapsed}
            {typical ? ` · ${typical.toLowerCase()}` : ""}
          </span>
          <span>{percent === undefined ? "Waiting" : `${percent}%`}</span>
        </div>
        <div className="mt-5 w-full text-left">
          <Stepper current={current} wide={false} />
        </div>
        <p className="mt-6 text-[0.84375rem] text-muted-foreground">
          You can leave this page. The scan keeps running and the top bar shows
          its progress.
        </p>
        {stopButton ? <div className="mt-4">{stopButton}</div> : null}
      </section>
    )
  }

  return (
    <section
      data-testid="scan-progress-panel"
      data-mode={queued ? "queued" : step}
      data-size="card"
      data-slow={slow || undefined}
      aria-label="Scan in progress"
      className="rounded-md border border-primary/30 bg-[color-mix(in_oklab,var(--accent)_55%,var(--card))] px-4.5 py-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <Icon
          aria-hidden="true"
          className={cn(
            "size-5 shrink-0 text-primary",
            Icon === Loader2 && "motion-safe:animate-spin",
            slow && "text-amber-600 dark:text-amber-400",
          )}
        />
        <div className="min-w-[12rem] flex-1">
          {heading}
          <p className="text-[0.84375rem] text-muted-foreground">{sub}</p>
        </div>
        <div className="text-right text-[0.84375rem] text-muted-foreground tabular-nums">
          <span className="font-semibold text-foreground-strong">
            {percent === undefined ? "Waiting" : `${percent}%`}
          </span>{" "}
          · {elapsed}
          {typical ? <span className="block text-xs">{typical}</span> : null}
        </div>
        {stopButton}
      </div>
      <div className="mt-3">{progressbar}</div>
      <div className="mt-3">
        <Stepper current={current} wide />
      </div>
    </section>
  )
}
