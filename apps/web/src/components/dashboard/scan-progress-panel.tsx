"use client"

import { useEffect, useMemo, useState } from "react"
import {
  BrainCircuit,
  Bug,
  Calculator,
  CircleCheck,
  Clock,
  FileCode,
  GitBranch,
  Hourglass,
  Save,
  Sparkles,
  type LucideIcon,
} from "lucide-react"

import { formatElapsed } from "@/components/layout/scan-status-strip"
import { Button } from "@/components/ui/button"
import { useRotatingLine } from "@/hooks/use-rotating-line"
import {
  modeOf,
  slowOf,
  useScanLive,
  type TrackedScan,
} from "@/hooks/use-scan-center"
import {
  headlineFor,
  poolFor,
  typicalLabel,
  type PanelMode,
} from "@/lib/scan-messages"
import { cn } from "@/lib/utils"

const ICONS: Record<PanelMode, LucideIcon> = {
  queued: Clock,
  cloning: GitBranch,
  reading_code: FileCode,
  finding_debt: Bug,
  predicting_risk: BrainCircuit,
  scoring: Save,
  finishing: Sparkles,
  calculating: Calculator,
}

const numbers = new Intl.NumberFormat("en-US")

/** Ticks once a second while mounted — for the elapsed clock only. */
function useNow() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  return now
}

export type ScanProgressPanelProps =
  | {
      /** A job the app is following: scanning, scoring, or ready to show. */
      kind: "job"
      scan: TrackedScan
      /**
       * `full` fills the middle of a dashboard with nothing else to show (a
       * first scan). `compact` sits above the previous results, which stay
       * usable underneath.
       */
      size: "full" | "compact"
      /** "Show them", once the new results are ready (compact only). */
      onShow?: () => void
    }
  | {
      /**
       * The score is being recalculated with no scan behind it — after a
       * profile change. Nothing to measure, so the bar sweeps.
       */
      kind: "calculating"
      slow?: boolean
      /** Injectable for tests; defaults to Math.random. */
      random?: () => number
    }

/**
 * What the dashboard shows about a scan in progress (13H.4): an icon for the
 * stage, a plain headline, one bar that only moves forward from the first
 * stage to the score, and a friendly line that changes every few seconds.
 *
 * The bar and the line come from the app-wide scan store, not from this
 * component, so leaving the dashboard and coming back continues exactly
 * where it was. Stop stays in the strip under the top bar: one Stop on screen.
 */
export function ScanProgressPanel(props: Readonly<ScanProgressPanelProps>) {
  return props.kind === "job" ? (
    <JobProgress {...props} />
  ) : (
    <ScoreRecalculation slow={props.slow} random={props.random} />
  )
}

function JobProgress({
  scan,
  size,
  onShow,
}: Readonly<Extract<ScanProgressPanelProps, { kind: "job" }>>) {
  const now = useNow()
  const live = useScanLive(scan.key)
  const mode = modeOf(scan)
  const slow = slowOf(scan, now)
  const ready = scan.job === "ready"

  if (ready && size === "compact") {
    return <ReadyCard scan={scan} onShow={onShow} />
  }

  const headline = scan.stopping
    ? "Stopping the scan"
    : headlineFor(mode, {
        done: scan.status.files_done,
        total: scan.status.files_total,
      })
  const bar = live?.bar
  const determinate = bar !== undefined
  const typical =
    scan.job === "scanning"
      ? typicalLabel(scan.status.typical_seconds)
      : undefined
  const filesRead =
    mode === "reading_code" &&
    scan.status.files_total &&
    scan.status.files_done !== null &&
    scan.status.files_done !== undefined
      ? `${numbers.format(scan.status.files_done)} of ${numbers.format(scan.status.files_total)} read`
      : undefined

  return (
    <Layout
      size={size}
      mode={mode}
      slow={slow}
      headline={headline}
      where={`${scan.repoName ?? "This project"} on ${scan.branch}`}
      bar={bar}
      label={scan.job === "scanning" ? "Scan progress" : "Score progress"}
      left={`${formatElapsed(now - scan.startedAt)}${typical ? ` · ${typical}` : ""}`}
      right={
        [filesRead, determinate ? `${Math.floor(bar)}%` : undefined]
          .filter(Boolean)
          .join(" · ") || "Waiting"
      }
      line={live?.line ?? ""}
    />
  )
}

/** A profile change with no scan behind it: the score is recalculated. */
function ScoreRecalculation({
  slow = false,
  random,
}: Readonly<{ slow?: boolean; random?: () => number }>) {
  const poolKey = `calculating:${slow}`
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const pool = useMemo(() => poolFor("calculating", slow), [poolKey])
  const line = useRotatingLine(pool, poolKey, random)
  return (
    <Layout
      size="full"
      mode="calculating"
      slow={slow}
      headline={headlineFor("calculating")}
      bar={undefined}
      label="Score progress"
      line={line}
    />
  )
}

function ReadyCard({
  scan,
  onShow,
}: Readonly<{ scan: TrackedScan; onShow?: () => void }>) {
  const health = scan.health
  return (
    <div
      data-testid="scan-progress-panel"
      data-mode="ready"
      className="m-4 mb-0 flex flex-wrap items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3"
    >
      <CircleCheck
        aria-hidden="true"
        className="size-5 shrink-0 text-primary motion-safe:animate-[panel-pop_400ms_ease-out]"
      />
      <div className="min-w-0 flex-1">
        <p role="status" className="text-sm font-semibold text-foreground">
          New results are ready
        </p>
        <p className="text-xs text-muted-foreground">
          {scan.repoName ?? "This project"} on {scan.branch}
          {health
            ? ` · Health ${Math.round(health.score)} (${health.grade})`
            : ""}
        </p>
      </div>
      <Button size="sm" onClick={onShow}>
        Show them
      </Button>
    </div>
  )
}

function Layout({
  size,
  mode,
  slow,
  headline,
  where,
  bar,
  label,
  left,
  right,
  line,
}: Readonly<{
  size: "full" | "compact"
  mode: PanelMode
  slow: boolean
  headline: string
  where?: string
  bar: number | undefined
  label: string
  left?: string
  right?: string
  line: string
}>) {
  const Icon = slow ? Hourglass : ICONS[mode]
  const compact = size === "compact"
  const determinate = bar !== undefined

  const icon = (
    <div
      className={cn(
        "relative flex shrink-0 items-center justify-center",
        compact ? "size-10" : "size-20",
      )}
    >
      {/* A softly breathing ring — decoration, and still under reduced
          motion. */}
      <span
        aria-hidden="true"
        className="absolute inset-0 rounded-full bg-primary/10 motion-safe:animate-[panel-breathe_2.4s_ease-in-out_infinite]"
      />
      {/* Re-keyed by mode, so each new stage's icon pops in. */}
      <Icon
        key={`${mode}:${slow}`}
        aria-hidden="true"
        className={cn(
          "relative text-primary motion-safe:animate-[panel-pop_400ms_ease-out]",
          compact ? "size-5" : "size-8",
          slow && "text-amber-600 dark:text-amber-400",
        )}
      />
    </div>
  )

  const progress = (
    <div className="flex w-full flex-col gap-2">
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={determinate ? Math.floor(bar) : undefined}
        className={cn(
          "relative w-full overflow-hidden rounded-full bg-primary/15",
          compact ? "h-1.5" : "h-2",
        )}
      >
        {determinate ? (
          <div
            data-testid="scan-progress-fill"
            className="h-full rounded-full bg-primary"
            style={{ width: `${bar}%` }}
          />
        ) : (
          <div className="h-full w-1/3 rounded-full bg-primary motion-safe:animate-[scan-sweep_1.4s_ease-in-out_infinite]" />
        )}
      </div>
      {left !== undefined || right !== undefined ? (
        <div className="flex justify-between gap-3 text-xs text-muted-foreground tabular-nums">
          <span>{left}</span>
          <span>{right}</span>
        </div>
      ) : null}
    </div>
  )

  // The headline is the one live region: it changes per stage, which is worth
  // hearing. The rotating line is not announced.
  const title = (
    <p
      role="status"
      aria-live="polite"
      className={cn(
        "font-semibold text-foreground",
        compact ? "text-sm" : "text-lg",
      )}
    >
      {headline}
    </p>
  )
  // Re-keyed by the line, so each new one fades in.
  const friendly = (
    <p
      key={line}
      data-testid="scan-panel-line"
      className={cn(
        "text-sm text-balance text-muted-foreground motion-safe:animate-[panel-fade_500ms_ease-out]",
        compact ? "truncate text-xs" : "min-h-10",
      )}
    >
      {line}
    </p>
  )

  if (compact) {
    return (
      <div
        data-testid="scan-progress-panel"
        data-mode={mode}
        data-size="compact"
        data-slow={slow || undefined}
        className="m-4 mb-0 flex items-center gap-4 rounded-lg border bg-card px-4 py-3"
      >
        {icon}
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-baseline gap-x-2">
            {title}
            {where ? (
              <span className="truncate text-xs text-muted-foreground">
                {where}
              </span>
            ) : null}
          </div>
          {progress}
          {friendly}
        </div>
      </div>
    )
  }

  return (
    <div
      data-testid="scan-progress-panel"
      data-mode={mode}
      data-size="full"
      data-slow={slow || undefined}
      className="flex flex-1 items-center justify-center p-6"
    >
      <div className="flex w-full max-w-md flex-col items-center gap-5 text-center">
        {icon}
        <div className="flex flex-col gap-1">
          {title}
          {where ? (
            <p className="text-sm text-muted-foreground">{where}</p>
          ) : null}
        </div>
        {progress}
        {friendly}
      </div>
    </div>
  )
}
