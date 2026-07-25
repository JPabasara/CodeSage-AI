import { Pie, PieChart } from "recharts";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { CategoryBreakdownItem, Grade } from "@/lib/types";
import { gradeColor } from "@/lib/utils";

const CATEGORY_COLORS: Record<string, string> = {
  "code-design": "var(--chart-1)",
  security: "hsl(var(--severity-critical))",
  documentation: "var(--chart-3)",
  requirement: "var(--chart-4)",
  test: "var(--chart-5)",
};

export type OverallHealthCardProps = {
  score: number;
  grade: Grade;
  delta: number;
  redIssueCount: number;
  categoryBreakdown: CategoryBreakdownItem[];
};

export function OverallHealthCard({
  score,
  grade,
  delta,
  redIssueCount,
  categoryBreakdown,
}: Readonly<OverallHealthCardProps>) {
  const chartConfig = Object.fromEntries(
    categoryBreakdown.map((c) => [c.category, { label: c.category, color: CATEGORY_COLORS[c.category] }]),
  ) as ChartConfig;

  // Recharts colours each slice from a `fill` field on the datum (Cell is deprecated in v3).
  const pieData = categoryBreakdown.map((c) => ({
    ...c,
    fill: CATEGORY_COLORS[c.category] ?? "var(--chart-2)",
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Code Health</CardTitle>
        <CardDescription>
          {redIssueCount} red {redIssueCount === 1 ? "issue" : "issues"}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-4">
        <div>
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-bold" style={{ color: gradeColor(grade) }}>
              {grade}
            </span>
            <span className="text-muted-foreground text-lg">{score}/100</span>
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            {delta >= 0 ? `▲ +${delta}` : `▼ ${delta}`} since last scan
          </p>
        </div>

        <ChartContainer config={chartConfig} className="aspect-square h-24 w-24">
          <PieChart>
            <ChartTooltip content={<ChartTooltipContent nameKey="category" hideLabel />} />
            <Pie data={pieData} dataKey="count" nameKey="category" innerRadius={20} outerRadius={40} />
          </PieChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
