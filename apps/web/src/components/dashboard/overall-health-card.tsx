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
  const chartConfig = useMemo(
    () =>
      Object.fromEntries(
        categoryBreakdown.map((c) => [
          c.category,
          { label: c.category, color: CATEGORY_COLORS[c.category] },
        ]),
      ) as ChartConfig,
    [categoryBreakdown],
  )

  const totalFindings = useMemo(
    () => categoryBreakdown.reduce((sum, c) => sum + c.count, 0),
    [categoryBreakdown],
  )

  const ariaLabel = useMemo(() => {
    if (totalFindings === 0) {
      return "Category breakdown: zero findings"
    }
    const splitSummary = categoryBreakdown
      .filter((c) => c.count > 0)
      .map((c) => `${c.count} ${c.category}`)
      .join(", ")
    return `Category breakdown: ${splitSummary}. Total: ${totalFindings}`
  }, [categoryBreakdown, totalFindings])

  // Recharts colours each slice from a `fill` field on the datum (Cell is deprecated in v3).
  const pieData = useMemo(() => {
    if (totalFindings === 0) {
      return [{ category: "none", count: 1, fill: "var(--muted)" }]
    }
    return categoryBreakdown
      .filter((c) => c.count > 0)
      .map((c) => ({
        ...c,
        fill: CATEGORY_COLORS[c.category] ?? "var(--category-code-design)",
      }))
  }, [categoryBreakdown, totalFindings])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Code Health</CardTitle>
        <CardDescription>
          {redIssueCount} red {redIssueCount === 1 ? "issue" : "issues"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="flex items-baseline gap-2">
              <span
                className="text-4xl font-bold"
                style={{ color: gradeColor(grade) }}
              >
                {grade}
              </span>
              <span className="text-muted-foreground text-lg">{score}/100</span>
            </div>
            <p className="text-muted-foreground mt-1 text-sm">
              {delta >= 0 ? `▲ +${delta}` : `▼ ${delta}`} since last scan
            </p>
          </div>

          <div className="relative aspect-square h-24 w-24 shrink-0 sm:h-28 sm:w-28">
            <ChartContainer
              config={chartConfig}
              className="aspect-square h-full w-full"
              aria-label={ariaLabel}
            >
              <PieChart>
                {totalFindings > 0 && (
                  <ChartTooltip
                    content={
                      <ChartTooltipContent nameKey="category" hideLabel />
                    }
                  />
                )}
                <Pie
                  data={pieData}
                  dataKey="count"
                  nameKey="category"
                  innerRadius={26}
                  outerRadius={44}
                  strokeWidth={2}
                />
              </PieChart>
            </ChartContainer>
            <div
              className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center"
              aria-hidden="true"
            >
              <span className="text-base font-bold leading-tight tabular-nums sm:text-lg">
                {totalFindings}
              </span>
              <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
                total
              </span>
            </div>
          </div>
        </div>

        {categoryBreakdown.length > 0 && (
          <div className="mt-4 border-t pt-3">
            <ul
              className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-xs"
              aria-label="Category breakdown legend"
            >
              {categoryBreakdown.map((item) => (
                <li key={item.category} className="flex items-center gap-1.5">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{
                      backgroundColor:
                        CATEGORY_COLORS[item.category] ??
                        "var(--category-code-design)",
                    }}
                    aria-hidden="true"
                  />
                  <span className="text-muted-foreground">{item.category}</span>
                  <span className="font-mono font-medium text-foreground tabular-nums">
                    {item.count}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
