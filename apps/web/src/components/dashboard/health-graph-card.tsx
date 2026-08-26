import { Area, AreaChart, CartesianGrid, XAxis } from "recharts"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
  // v1: repo-scoped trend. Later, the same shape holds a hovered node's history.
  const data = history.map((p) => ({ score: p.score, label: p.t.slice(0, 10) }))

  return (
    <Card>
      <CardHeader>
        <CardTitle>Health trend</CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="h-45 w-full">
          <AreaChart data={data} margin={{ left: 8, right: 8, top: 8 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={24}
            />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Area
              dataKey="score"
              type="monotone"
              stroke="var(--color-score)"
              fill="var(--color-score)"
              fillOpacity={0.2}
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
