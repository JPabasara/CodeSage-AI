import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"

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
import type { HealthPoint } from "@/lib/types"

const chartConfig = {
  score: { label: "Health", color: "var(--chart-1)" },
} satisfies ChartConfig

export type HealthGraphCardProps = {
  history: HealthPoint[]
}

export function HealthGraphCard({ history }: Readonly<HealthGraphCardProps>) {
  const data = history.map((point) => ({
    score: point.score,
    label: point.t.slice(5, 10),
    date: point.t.slice(0, 10),
  }))

  return (
    <Card className="border-t-2 border-t-primary/60 shadow-sm">
      <CardHeader>
        <CardTitle>Health trend</CardTitle>
        <CardDescription>Snapshot score over time</CardDescription>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <div className="flex h-44 items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground">
            No trend data yet
          </div>
        ) : (
          <ChartContainer config={chartConfig} className="h-44 w-full">
            <AreaChart
              data={data}
              margin={{ left: -12, right: 8, top: 8, bottom: 0 }}
            >
              <defs>
                <linearGradient
                  id="healthTrendFill"
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop
                    offset="5%"
                    stopColor="var(--color-score)"
                    stopOpacity={0.28}
                  />
                  <stop
                    offset="95%"
                    stopColor="var(--color-score)"
                    stopOpacity={0.04}
                  />
                </linearGradient>
              </defs>
              <CartesianGrid
                vertical={false}
                stroke="var(--border)"
                strokeDasharray="3 3"
              />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={18}
                tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
              />
              <YAxis
                width={34}
                domain={[0, 100]}
                tickCount={4}
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
              />
              <ChartTooltip content={<ChartTooltipContent labelKey="date" />} />
              <Area
                dataKey="score"
                type="monotone"
                stroke="var(--color-score)"
                strokeWidth={2}
                fill="url(#healthTrendFill)"
                dot={{ r: 2, fill: "var(--color-score)", strokeWidth: 0 }}
                activeDot={{ r: 4, stroke: "var(--background)" }}
              />
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}
