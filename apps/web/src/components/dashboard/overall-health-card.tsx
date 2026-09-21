import { useMemo } from "react"
import { Pie, PieChart } from "recharts"

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
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import type { CategoryBreakdownItem, Grade } from "@/lib/types"
import { gradeColor } from "@/lib/utils"

export const CATEGORY_COLORS: Record<string, string> = {
  "code-design": "var(--category-code-design)",
  security: "var(--category-security)",
  documentation: "var(--category-documentation)",
  requirement: "var(--category-requirement)",
  test: "var(--category-test)",
}

export type OverallHealthCardProps = {
  score: number
  grade: Grade
  delta: number
  redIssueCount: number
  categoryBreakdown: CategoryBreakdownItem[]
}

export function OverallHealthCard({
  score,
  grade,
  delta,
  redIssueCount,
  categoryBreakdown,
}: Readonly<OverallHealthCardProps>) {
  const deltaSummary =
    delta === 0 ? "No change" : delta > 0 ? `Up +${delta}` : `Down ${delta}`

  const chartConfig = useMemo(
    () =>
      Object.fromEntries(
        categoryBreakdown.map((item) => [
          item.category,
          { label: item.category, color: CATEGORY_COLORS[item.category] },
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

  const pieData = useMemo(() => {
    if (totalFindings === 0) {
      return [{ category: "none", count: 1, fill: "var(--muted)" }]
    }
    return categoryBreakdown
      .filter((item) => item.count > 0)
      .map((item) => ({
        ...item,
        fill: CATEGORY_COLORS[item.category] ?? "var(--category-code-design)",
      }))
  }, [categoryBreakdown, totalFindings])

  return (
    <Card className="border-t-2 border-t-primary/60 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle>Code Health</CardTitle>
        <CardDescription>
          {redIssueCount} red {redIssueCount === 1 ? "issue" : "issues"}
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="grid gap-3 sm:grid-cols-[minmax(6.5rem,0.6fr)_minmax(0,1.4fr)] sm:items-center">
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <span
                className="text-4xl font-bold"
                style={{ color: gradeColor(grade) }}
              >
                {grade}
              </span>
              <span className="text-lg text-muted-foreground">{score}/100</span>
            </div>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">
              <span className="block">{deltaSummary}</span>
              <span className="block">since last scan</span>
            </p>
          </div>

          <div className="flex min-w-0 flex-wrap items-center justify-end gap-3">
            <div className="relative aspect-square h-28 w-28 shrink-0 overflow-visible">
              <ChartContainer
                config={chartConfig}
                className="aspect-square h-full w-full overflow-visible"
                aria-label={ariaLabel}
              >
                <PieChart>
                  {totalFindings > 0 ? (
                    <ChartTooltip
                      cursor={false}
                      position={{ x: -112, y: 8 }}
                      wrapperStyle={{ pointerEvents: "none" }}
                      content={
                        <ChartTooltipContent nameKey="category" hideLabel />
                      }
                    />
                  ) : null}
                  <Pie
                    data={pieData}
                    dataKey="count"
                    nameKey="category"
                    innerRadius={37}
                    outerRadius={52}
                    paddingAngle={totalFindings > 0 ? 3 : 0}
                    cornerRadius={totalFindings > 0 ? 3 : 0}
                    stroke="var(--card)"
                    strokeWidth={2}
                  />
                </PieChart>
              </ChartContainer>
              <div
                className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center"
                aria-hidden="true"
              >
                <span className="text-lg font-bold tracking-tight text-foreground tabular-nums">
                  {totalFindings}
                </span>
                <span className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
                  total
                </span>
              </div>
            </div>

            {categoryBreakdown.length > 0 ? (
              <ul
                className="min-w-36 flex-1 space-y-1 text-[0.6875rem]"
                aria-label="Category breakdown legend"
              >
                {categoryBreakdown.map((item) => {
                  const pct =
                    totalFindings > 0
                      ? Math.round((item.count / totalFindings) * 100)
                      : 0
                  return (
                    <li
                      key={item.category}
                      className="grid grid-cols-[minmax(0,1fr)_2.25rem_2rem] items-center gap-1"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          className="size-2 shrink-0 rounded-full"
                          style={{
                            backgroundColor:
                              CATEGORY_COLORS[item.category] ??
                              "var(--category-code-design)",
                          }}
                          aria-hidden="true"
                        />
                        <span className="truncate capitalize text-muted-foreground">
                          {item.category}
                        </span>
                      </div>
                      <span className="text-right text-[0.625rem] text-muted-foreground tabular-nums">
                        {pct}%
                      </span>
                      <span className="rounded bg-muted/70 px-1 py-0.5 text-center font-mono text-[0.625rem] font-medium text-foreground tabular-nums">
                        {item.count}
                      </span>
                    </li>
                  )
                })}
              </ul>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
