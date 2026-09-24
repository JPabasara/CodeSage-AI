"use client"

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  type ChartConfig,
} from "@/components/ui/chart"
import type { HealthPoint } from "@/lib/types"
import { cn } from "@/lib/utils"

const chartConfig = {
  score: { label: "Health", color: "var(--chart-1)" },
} satisfies ChartConfig

// Dots on every point only while there are few enough to tell apart.
const MAX_DOTTED_POINTS = 16

type TrendPoint = {
  index: number
  score: number
  t: string
  delta: number | null
}

const shortDate = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
})

const fullDateTime = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
})

function formatShortDate(iso: string) {
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? iso.slice(5, 10)
    : shortDate.format(date)
}

function formatDateTime(iso: string) {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : fullDateTime.format(date)
}

/**
 * A y-axis that reads: round ticks, at most five of them, padded around the
 * data and kept inside 0–100. A wide spread gets the full 0/25/50/75/100
 * scale; a narrow one zooms in (70/75/80…) so a real change is visible
 * instead of a flat line pinned to one gridline.
 */
function trendScale(scores: number[]) {
  if (scores.length === 0)
    return { domain: [0, 100], ticks: [0, 25, 50, 75, 100] }
  const min = Math.min(...scores)
  const max = Math.max(...scores)
  const pad = Math.max(5, (max - min) * 0.15)
  const lo = Math.max(0, min - pad)
  const hi = Math.min(100, max + pad)

  for (const step of [5, 10, 20, 25]) {
    let from = Math.floor(lo / step) * step
    let to = Math.ceil(hi / step) * step
    // Never fewer than two intervals, so a flat line still has a scale.
    if (to - from < step * 2) {
      if (to + step <= 100) to += step
      else from = Math.max(0, from - step)
    }
    if ((to - from) / step <= 4) {
      const ticks: number[] = []
      for (let tick = from; tick <= to; tick += step) ticks.push(tick)
      return { domain: [from, to], ticks }
    }
  }
  return { domain: [0, 100], ticks: [0, 25, 50, 75, 100] }
}

function TrendTooltip({
  active,
  payload,
}: Readonly<{
  active?: boolean
  payload?: ReadonlyArray<{ payload?: TrendPoint }>
}>) {
  const point = active ? payload?.[0]?.payload : undefined
  if (!point) return null
  const delta =
    point.delta === null
      ? null
      : point.delta === 0
        ? "No change"
        : point.delta > 0
          ? `+${point.delta}`
          : `${point.delta}`

  return (
    <div className="grid min-w-36 gap-1 rounded-md border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md">
      <span className="text-muted-foreground tabular-nums">
        {formatDateTime(point.t)}
      </span>
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="h-0.5 w-3 rounded-full"
            style={{ backgroundColor: "var(--color-score)" }}
          />
          <span className="text-muted-foreground">Health</span>
        </span>
        <span className="font-semibold text-foreground tabular-nums">
          {point.score}
          <span className="font-normal text-muted-foreground">/100</span>
        </span>
      </div>
      {delta ? (
        <span className="text-muted-foreground tabular-nums">
          {delta === "No change" ? delta : `${delta} since the scan before`}
        </span>
      ) : null}
    </div>
  )
}

export type HealthGraphCardProps = {
  history: HealthPoint[]
}

export function HealthGraphCard({ history }: Readonly<HealthGraphCardProps>) {
  // Whole numbers, as everywhere else a score is shown.
  const data: TrendPoint[] = history.map((point, index) => {
    const score = Math.round(point.score)
    const previous = index > 0 ? Math.round(history[index - 1].score) : null
    return {
      index,
      score,
      t: point.t,
      delta: previous === null ? null : score - previous,
    }
  })
  const { domain, ticks } = trendScale(data.map((point) => point.score))
  const first = data[0]
  const last = data[data.length - 1]
  const summary =
    first && last
      ? data.length === 1
        ? `One scan so far, scored ${last.score} on ${formatDateTime(last.t)}.`
        : `Health went from ${first.score} on ${formatDateTime(first.t)} to ${last.score} on ${formatDateTime(last.t)}, across ${data.length} scans.`
      : undefined

  return (
    <Card className="h-full gap-3 border ring-0">
      <CardHeader>
        <CardTitle className="text-[15px] font-semibold">
          Health trend
        </CardTitle>
        <CardDescription>
          {data.length === 1
            ? "The trend starts with the next scan"
            : "Score after each scan"}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1">
        {data.length === 0 ? (
          <div className="flex h-32 items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground">
            No trend yet. Scores appear here after each scan.
          </div>
        ) : (
          <>
            <ChartContainer
              config={chartConfig}
              initialDimension={{ width: 320, height: 128 }}
              className={cn(
                "aspect-auto h-32 w-full rounded-sm",
                // recharts' own keyboard layer: arrow keys move the tooltip
                // along the line. Its outline is hidden by the container, so
                // the focus is shown here instead.
                "has-[.recharts-surface:focus-visible]:ring-2 has-[.recharts-surface:focus-visible]:ring-ring/50",
              )}
            >
              <LineChart
                data={data}
                margin={{ left: 0, right: 8, top: 8, bottom: 0 }}
              >
                <CartesianGrid
                  vertical={false}
                  stroke="var(--border)"
                  strokeWidth={1}
                />
                <XAxis
                  dataKey="index"
                  type="category"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={6}
                  minTickGap={24}
                  interval="preserveStartEnd"
                  // Inset the first and last points so their date labels are
                  // never cut off at the edges.
                  padding={{ left: 12, right: 14 }}
                  tickFormatter={(value: number) =>
                    data[value] ? formatShortDate(data[value].t) : ""
                  }
                  tick={{
                    fontSize: 11,
                    fill: "var(--muted-foreground)",
                    className: "tabular-nums",
                  }}
                />
                <YAxis
                  width={26}
                  domain={domain}
                  ticks={ticks}
                  allowDataOverflow
                  tickLine={false}
                  axisLine={false}
                  tickMargin={4}
                  tick={{
                    fontSize: 11,
                    fill: "var(--muted-foreground)",
                    className: "tabular-nums",
                  }}
                />
                <ChartTooltip
                  cursor={{
                    stroke: "var(--muted-foreground)",
                    strokeOpacity: 0.35,
                    strokeWidth: 1,
                  }}
                  content={<TrendTooltip />}
                />
                <Line
                  dataKey="score"
                  type="monotone"
                  stroke="var(--color-score)"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  dot={
                    data.length <= MAX_DOTTED_POINTS
                      ? {
                          r: data.length === 1 ? 4 : 2.5,
                          fill: "var(--color-score)",
                          stroke: "var(--card)",
                          strokeWidth: 1.5,
                        }
                      : false
                  }
                  activeDot={{
                    r: 4.5,
                    fill: "var(--color-score)",
                    stroke: "var(--card)",
                    strokeWidth: 2,
                  }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ChartContainer>
            {summary ? <p className="sr-only">{summary}</p> : null}
          </>
        )}
      </CardContent>
    </Card>
  )
}
