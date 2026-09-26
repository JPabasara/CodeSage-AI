"use client"

import { useEffect, useMemo, useState } from "react"
import {
  BrainCircuit,
  Bug,
  Calculator,
  Clock,
  FileCode,
  GitBranch,
  Hourglass,
  Save,
  Sparkles,
  type LucideIcon,
} from "lucide-react"

import { formatElapsed } from "@/components/layout/scan-status-strip"
import { useRotatingLine } from "@/hooks/use-rotating-line"
import {
  headlineFor,
  isSlow,
  poolFor,
  typicalLabel,
  type PanelMode,
} from "@/lib/scan-messages"
import { stageOf } from "@/lib/scan-progress"
import type { ScanStatus } from "@/lib/types"
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
      /** A queued or running scan of the branch on screen. */
      kind: "scan"
      status: ScanStatus
      /**
       * Where the whole bar is — from `useSmoothProgress`, shared with the top
       * bar. The scan fills the first 90%, the score the rest.
       */
      progress: number | undefined
      startedAt: number
      repoName?: string
      branch: string
      stopping?: boolean
      /** Injectable for tests; defaults to Math.random. */
      random?: () => number
    }
  | {
      /** The scan finished and its score is being computed (503 SCORE_PENDING). */
      kind: "calculating"
      /** The same bar, continuing through its last section. */
      progress?: number
      /** When the scan started, if this tab saw it — the clock carries on. */
      startedAt?: number
      repoName?: string
      branch?: string
      /** The server has been scoring for longer than usual. */
      slow?: boolean
      random?: () => number
    }

const numbers = new Intl.NumberFormat("en-US")

/**
 * The centre of the dashboard while a scan runs or its score is computed
 * (13H.4): an icon for the stage, a plain headline, one bar that only moves
 * forward from the first stage to the score, and a friendly line that changes
 * every few seconds. It sits on the page itself, with no card around it.
 *
 * Stop stays in the strip under the top bar, so there is one Stop on screen.
 */
export function ScanProgressPanel(props: Readonly<ScanProgressPanelProps>) {
  const now = useNow()
  const scan = props.kind === "scan" ? props : undefined
  const calculating = props.kind === "calculating" ? props : undefined

  const mode: PanelMode = !scan
    ? "calculating"
    : scan.status.phase === "queued"
      ? "queued"
      : stageOf(scan.status)
  const startedAt = props.startedAt
  const elapsed = startedAt !== undefined ? now - startedAt : undefined
  const slow = scan
    ? mode !== "queued" && isSlow(elapsed ?? 0, scan.status.typical_seconds)
    : Boolean(calculating?.slow)

  const poolKey = `${mode}:${slow}`
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const pool = useMemo(() => poolFor(mode, slow), [poolKey])
  const line = useRotatingLine(pool, poolKey, props.random)

  const Icon = slow ? Hourglass : ICONS[mode]
  const headline = scan?.stopping
    ? "Stopping the scan"
    : headlineFor(mode, {
        done: scan?.status.files_done,
        total: scan?.status.files_total,
      })
  const progress = props.progress
  const determinate = progress !== undefined
  const typical = scan ? typicalLabel(scan.status.typical_seconds) : undefined
  const filesRead =
    mode === "reading_code" &&
    scan?.status.files_total &&
    scan.status.files_done !== null &&
    scan.status.files_done !== undefined
      ? `${numbers.format(scan.status.files_done)} of ${numbers.format(scan.status.files_total)} read`
      : undefined
  const percent = determinate ? `${Math.floor(progress)}%` : undefined
  const where = props.branch
    ? `${props.repoName ?? "This project"} on ${props.branch}`
    : undefined

  return (
    <div
      data-testid="scan-progress-panel"
      data-mode={mode}
      data-slow={slow || undefined}
      className="flex flex-1 items-center justify-center p-6"
    >
      <div className="flex w-full max-w-md flex-col items-center gap-5 text-center">
        {/* The icon sits in a softly breathing ring — decoration, and still
            under reduced motion. */}
        <div className="relative flex size-20 items-center justify-center">
          <span
            aria-hidden="true"
            className="absolute inset-0 rounded-full bg-primary/10 motion-safe:animate-[panel-breathe_2.4s_ease-in-out_infinite]"
          />
          {/* Re-keyed by mode, so each new stage's icon pops in. */}
          <Icon
            key={`${mode}:${slow}`}
            aria-hidden="true"
            className={cn(
              "relative size-8 text-primary motion-safe:animate-[panel-pop_400ms_ease-out]",
              slow && "text-amber-600 dark:text-amber-400",
            )}
          />
        </div>

        <div className="flex flex-col gap-1">
          {/* The headline is the one live region: it changes per stage, which
              is worth hearing. The rotating line below is not announced. */}
          <p
            role="status"
            aria-live="polite"
            className="text-lg font-semibold text-foreground"
          >
            {headline}
          </p>
          {where ? (
            <p className="text-sm text-muted-foreground">{where}</p>
          ) : null}
        </div>

        <div className="flex w-full flex-col gap-2">
          <div
            role="progressbar"
            aria-label={scan ? "Scan progress" : "Score progress"}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={determinate ? Math.floor(progress) : undefined}
            className="relative h-2 w-full overflow-hidden rounded-full bg-primary/15"
          >
            {determinate ? (
              <div
                data-testid="scan-progress-fill"
                className="h-full rounded-full bg-primary"
                style={{ width: `${progress}%` }}
              />
            ) : (
              <div className="h-full w-1/3 rounded-full bg-primary motion-safe:animate-[scan-sweep_1.4s_ease-in-out_infinite]" />
            )}
          </div>
          <div className="flex justify-between gap-3 text-xs text-muted-foreground tabular-nums">
            <span>
              {elapsed !== undefined ? formatElapsed(elapsed) : ""}
              {typical ? ` · ${typical}` : ""}
            </span>
            <span>
              {[filesRead, percent].filter(Boolean).join(" · ") || "Waiting"}
            </span>
          </div>
        </div>

        {/* Re-keyed by the line, so each new one fades in. */}
        <p
          key={line}
          data-testid="scan-panel-line"
          className="min-h-10 text-sm text-balance text-muted-foreground motion-safe:animate-[panel-fade_500ms_ease-out]"
        >
          {line}
        </p>
      </div>
    </div>
  )
}
