"use client"

import { useMemo } from "react"
import { Calculator, Hourglass } from "lucide-react"

import { useRotatingLine } from "@/hooks/use-rotating-line"
import { headlineFor, poolFor, type PanelMode } from "@/lib/scan-messages"
import { cn } from "@/lib/utils"

export type ScanProgressPanelProps = {
  // The score is being recalculated with no scan behind it — after a profile change.
  // A scan's own progress is ScanProgressCard.
  kind: "calculating"
  slow?: boolean
  random?: () => number
}

export function ScanProgressPanel(props: Readonly<ScanProgressPanelProps>) {
  return <ScoreRecalculation slow={props.slow} random={props.random} />
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
      mode="calculating"
      slow={slow}
      headline={headlineFor("calculating")}
      bar={undefined}
      label="Score progress"
      line={line}
    />
  )
}

function Layout({
  mode,
  slow,
  headline,
  bar,
  label,
  line,
}: Readonly<{
  mode: PanelMode
  slow: boolean
  headline: string
  bar: number | undefined
  label: string
  line: string
}>) {
  const Icon = slow ? Hourglass : Calculator
  const determinate = bar !== undefined

  return (
    <div
      data-testid="scan-progress-panel"
      data-mode={mode}
      data-size="full"
      data-slow={slow || undefined}
      className="flex flex-1 items-center justify-center p-6"
    >
      <div className="flex w-full max-w-md flex-col items-center gap-5 text-center">
        <div className="relative flex size-20 shrink-0 items-center justify-center">
          {/* A softly breathing ring — decoration, and still under reduced motion. */}
          <span
            aria-hidden="true"
            className="absolute inset-0 rounded-full bg-primary/10 motion-safe:animate-[panel-breathe_2.4s_ease-in-out_infinite]"
          />
          <Icon
            key={`${mode}:${slow}`}
            aria-hidden="true"
            className={cn(
              "relative size-8 text-primary motion-safe:animate-[panel-pop_400ms_ease-out]",
              slow && "text-amber-600 dark:text-amber-400",
            )}
          />
        </div>
        {/* The headline is the one live region. */}
        <p
          role="status"
          aria-live="polite"
          className="text-lg font-semibold text-foreground-strong"
        >
          {headline}
        </p>
        <div
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={determinate ? Math.floor(bar) : undefined}
          className="relative h-2 w-full overflow-hidden rounded-full bg-primary/15"
        >
          {determinate ? (
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${bar}%` }}
            />
          ) : (
            <div className="h-full w-1/3 rounded-full bg-primary motion-safe:animate-[scan-sweep_1.4s_ease-in-out_infinite]" />
          )}
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
