"use client"

import type { KeyboardEvent, MouseEvent } from "react"
import {
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { Pie, PieChart, Sector, type PieSectorShapeProps } from "recharts"

import { categoryColor } from "@/components/dashboard/finding-tag"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ChartContainer, type ChartConfig } from "@/components/ui/chart"
import type { CategoryBreakdownItem, Grade } from "@/lib/types"
import { cn, gradeColor } from "@/lib/utils"

export { CATEGORY_COLORS } from "@/components/dashboard/finding-tag"

export type OverallHealthCardProps = {
  score: number
  grade: Grade
  delta: number
  redIssueCount: number
  categoryBreakdown: CategoryBreakdownItem[]
}

// The donut's geometry, in px. The chart box is fixed so the tooltip can be
// anchored to a slice by arithmetic rather than by asking recharts.
const CHART_SIZE = 120
const OUTER_RADIUS = 54
const INNER_RADIUS = 40
// Slices run clockwise from twelve o'clock.
const START_ANGLE = 90
const END_ANGLE = -270
// How far the tooltip sits from the pointer.
const CURSOR_OFFSET = 12

type Slice = CategoryBreakdownItem & {
  fill: string
  pct: number
  /** "Security · 12 findings · 34%" — the tooltip and the live region. */
  text: string
}

type Active = { index: number; via: "pointer" | "keyboard" }

function sentenceCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function findingsLabel(count: number) {
  return `${count} ${count === 1 ? "finding" : "findings"}`
}

export function OverallHealthCard({
  score,
  grade,
  delta,
  redIssueCount,
  categoryBreakdown,
}: Readonly<OverallHealthCardProps>) {
  const [firstScore] = useState(score)
  const deltaSummary =
    delta === 0 ? "No change" : delta > 0 ? `Up +${delta}` : `Down ${delta}`

  const chartConfig = useMemo(
    () =>
      Object.fromEntries(
        categoryBreakdown.map((item) => [
          item.category,
          { label: item.category, color: categoryColor(item.category) },
        ]),
      ) as ChartConfig,
    [categoryBreakdown],
  )

  const totalFindings = useMemo(
    () => categoryBreakdown.reduce((sum, item) => sum + item.count, 0),
    [categoryBreakdown],
  )

  const ariaLabel = useMemo(() => {
    if (totalFindings === 0) return "Category breakdown: zero findings"
    const splitSummary = categoryBreakdown
      .filter((item) => item.count > 0)
      .map((item) => `${item.count} ${item.category}`)
      .join(", ")
    return `Category breakdown: ${splitSummary}. Total: ${totalFindings}`
  }, [categoryBreakdown, totalFindings])

  const slices = useMemo<Slice[]>(() => {
    if (totalFindings === 0) return []
    return categoryBreakdown
      .filter((item) => item.count > 0)
      .map((item) => {
        const pct = Math.round((item.count / totalFindings) * 100)
        return {
          ...item,
          fill: categoryColor(item.category),
          pct,
          text: `${sentenceCase(item.category)} · ${findingsLabel(item.count)} · ${pct}%`,
        }
      })
  }, [categoryBreakdown, totalFindings])

  const pieData = useMemo(
    () =>
      slices.length > 0
        ? slices
        : [{ category: "none", count: 1, fill: "var(--muted)" }],
    [slices],
  )

  // ── the tooltip ────────────────────────────────────────────────────────────
  //
  // Drawn here rather than by recharts: its tooltip is confined to the chart's
  // own box, which is far narrower than "Documentation · 12 findings · 34%".
  // This one lives in the card's content area, follows the pointer, and is
  // clamped to that area — so the card's overflow never clips it.
  const [active, setActive] = useState<Active | null>(null)
  const activeSlice = active ? slices[active.index] : undefined
  const areaRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<HTMLDivElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const pointer = useRef<{ x: number; y: number } | null>(null)
  const liveId = useId()

  const placeTooltip = useCallback(() => {
    const area = areaRef.current
    const chart = chartRef.current
    const tip = tipRef.current
    if (!area || !chart || !tip || !active) return

    const box = area.getBoundingClientRect()
    const width = tip.offsetWidth
    const height = tip.offsetHeight
    let x: number
    let y: number

    if (active.via === "pointer" && pointer.current) {
      // Below-right of the pointer; flipped to the left when that would run
      // off the card.
      x = pointer.current.x - box.left + CURSOR_OFFSET
      y = pointer.current.y - box.top + CURSOR_OFFSET
      if (x + width > box.width)
        x = pointer.current.x - box.left - CURSOR_OFFSET - width
    } else {
      // Keyboard: beside the middle of the active slice, on its outer side.
      const before = slices
        .slice(0, active.index)
        .reduce((sum, slice) => sum + slice.count, 0)
      const slice = slices[active.index]
      const fraction = (before + (slice?.count ?? 0) / 2) / totalFindings
      const angle =
        (START_ANGLE + (END_ANGLE - START_ANGLE) * fraction) * (Math.PI / 180)
      const rect = chart.getBoundingClientRect()
      const cx = rect.left + rect.width / 2 - box.left
      const cy = rect.top + rect.height / 2 - box.top
      const px = cx + (OUTER_RADIUS + 6) * Math.cos(angle)
      const py = cy - (OUTER_RADIUS + 6) * Math.sin(angle)
      x = px >= cx ? px + 4 : px - 4 - width
      y = py - height / 2
    }

    x = Math.min(Math.max(0, x), Math.max(0, box.width - width))
    y = Math.min(Math.max(0, y), Math.max(0, box.height - height))
    tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`
  }, [active, slices, totalFindings])

  // The tooltip's size depends on its text, so it is placed after it renders.
  useLayoutEffect(() => {
    placeTooltip()
  }, [placeTooltip])

  const interactive = slices.length > 0

  const onPointerMove = (event: MouseEvent<HTMLDivElement>) => {
    pointer.current = { x: event.clientX, y: event.clientY }
    placeTooltip()
  }

  const step = (from: number | undefined, by: number) => {
    const count = slices.length
    const start = from ?? (by > 0 ? -1 : 0)
    return (start + by + count) % count
  }

  const onChartKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!interactive) return
    const current = active?.index
    let next: number
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        next = step(current, 1)
        break
      case "ArrowLeft":
      case "ArrowUp":
        next = step(current, -1)
        break
      case "Home":
        next = 0
        break
      case "End":
        next = slices.length - 1
        break
      case "Escape":
        setActive(null)
        return
      default:
        return
    }
    event.preventDefault()
    pointer.current = null
    setActive({ index: next, via: "keyboard" })
  }

  const renderSector = (props: PieSectorShapeProps, index: number) => {
    const isActive = active?.index === index
    const dimmed = interactive && active !== null && !isActive
    return (
      <Sector
        cx={props.cx}
        cy={props.cy}
        innerRadius={props.innerRadius}
        outerRadius={props.outerRadius + (interactive && isActive ? 3 : 0)}
        startAngle={props.startAngle}
        endAngle={props.endAngle}
        cornerRadius={props.cornerRadius}
        fill={props.fill}
        fillOpacity={dimmed ? 0.35 : 1}
        stroke="var(--card)"
        strokeWidth={2}
        className="transition-[fill-opacity] duration-150"
      />
    )
  }

  return (
    <Card className="h-full gap-3 border ring-0">
      <CardHeader>
        <CardTitle className="text-[15px] font-semibold">Code Health</CardTitle>
        <CardDescription className="tabular-nums">
          {redIssueCount} red {redIssueCount === 1 ? "issue" : "issues"}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1">
        <div
          ref={areaRef}
          className="relative flex h-full items-center justify-between gap-4"
        >
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-baseline gap-2.5">
              <span
                className="text-4xl leading-none font-semibold"
                style={{ color: gradeColor(grade) }}
              >
                {grade}
              </span>
              {/* Re-keyed by the score, so a new score after a scan replays a
                  brief highlight — never on first load, and never under
                  reduced motion. The API sends a float; people read whole
                  numbers. */}
              <span
                key={score}
                data-testid="health-score"
                className={cn(
                  "rounded-sm px-0.5 text-lg font-medium text-foreground tabular-nums",
                  score !== firstScore &&
                    "motion-safe:animate-[score-flash_600ms_ease-out]",
                )}
              >
                {Math.round(score)}/100
              </span>
            </div>
            <p className="text-xs text-muted-foreground tabular-nums">
              <span>{deltaSummary}</span> <span>since last scan</span>
            </p>
          </div>

          <div
            ref={chartRef}
            className={cn(
              "relative shrink-0 rounded-full outline-none",
              interactive &&
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card",
            )}
            style={{ width: CHART_SIZE, height: CHART_SIZE }}
            // Named as an image when there is nothing to explore; a focusable
            // group when there is — arrow keys step through the slices and
            // show the same details as hovering.
            role={interactive ? "group" : "img"}
            aria-label={ariaLabel}
            aria-describedby={interactive ? liveId : undefined}
            tabIndex={interactive ? 0 : undefined}
            onKeyDown={onChartKeyDown}
            onFocus={() => {
              if (interactive && active === null) {
                pointer.current = null
                setActive({ index: 0, via: "keyboard" })
              }
            }}
            onBlur={() => {
              if (active?.via === "keyboard") setActive(null)
            }}
            onMouseMove={interactive ? onPointerMove : undefined}
            onMouseLeave={() => {
              pointer.current = null
              if (active?.via === "pointer") setActive(null)
            }}
          >
            <ChartContainer
              config={chartConfig}
              className="aspect-square h-full w-full"
              initialDimension={{ width: CHART_SIZE, height: CHART_SIZE }}
              aria-hidden="true"
            >
              <PieChart accessibilityLayer={false}>
                <Pie
                  data={pieData}
                  dataKey="count"
                  nameKey="category"
                  innerRadius={INNER_RADIUS}
                  outerRadius={OUTER_RADIUS}
                  startAngle={START_ANGLE}
                  endAngle={END_ANGLE}
                  paddingAngle={slices.length > 1 ? 2 : 0}
                  cornerRadius={slices.length > 0 ? 2 : 0}
                  rootTabIndex={-1}
                  shape={renderSector}
                  onMouseEnter={
                    interactive
                      ? (_, index) => setActive({ index, via: "pointer" })
                      : undefined
                  }
                  // Off a slice (into the hole, say), the tooltip goes too.
                  onMouseLeave={() =>
                    setActive((current) =>
                      current?.via === "pointer" ? null : current,
                    )
                  }
                />
              </PieChart>
            </ChartContainer>
            <div
              className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center"
              aria-hidden="true"
            >
              <span className="text-xl leading-tight font-semibold text-foreground tabular-nums">
                {totalFindings}
              </span>
              <span className="text-xs text-muted-foreground">total</span>
            </div>
          </div>

          {activeSlice ? (
            <div
              ref={tipRef}
              aria-hidden="true"
              className="pointer-events-none absolute top-0 left-0 z-10 flex items-center gap-2 rounded-md border bg-popover px-2.5 py-1.5 text-xs whitespace-nowrap text-popover-foreground shadow-md"
            >
              <span
                className="h-3 w-1 shrink-0 rounded-sm"
                style={{ backgroundColor: activeSlice.fill }}
              />
              <span className="font-medium tabular-nums">
                {activeSlice.text}
              </span>
            </div>
          ) : null}
        </div>

        {/* The legend, for screen readers only: the donut carries the split
            visually, and the tooltip carries the numbers on hover and focus. */}
        {slices.length > 0 ? (
          <ul className="sr-only" aria-label="Category breakdown legend">
            {slices.map((slice) => (
              <li key={slice.category}>
                <span>{slice.category}</span> · <span>{slice.count}</span>{" "}
                {slice.count === 1 ? "finding" : "findings"} ·{" "}
                <span>{slice.pct}%</span>
              </li>
            ))}
          </ul>
        ) : null}
        <span id={liveId} className="sr-only" aria-live="polite">
          {active?.via === "keyboard" && activeSlice ? activeSlice.text : ""}
        </span>
      </CardContent>
    </Card>
  )
}
