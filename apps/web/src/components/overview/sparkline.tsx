/** A small trend line: the last few scores of one project, oldest first. */
export function Sparkline({
  values,
  falling = false,
  width = 112,
  height = 30,
}: Readonly<{
  values: number[]
  falling?: boolean
  width?: number
  height?: number
}>) {
  if (values.length < 2) {
    return (
      <span className="text-xs text-muted-foreground">
        {values.length === 1 ? "One scan so far" : "No trend yet"}
      </span>
    )
  }
  const min = Math.min(...values) - 2
  const max = Math.max(...values) + 2
  const step = width / (values.length - 1)
  const points = values.map((value, index) => [
    index * step,
    height - ((value - min) / (max - min)) * height,
  ])
  const path = points
    .map(
      ([x, y], index) => `${index ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`,
    )
    .join(" ")
  const [lastX, lastY] = points[points.length - 1]
  const color = falling ? "hsl(var(--health-bad))" : "var(--chart-1)"

  return (
    <svg
      width={width}
      height={height}
      viewBox={`-3 -3 ${width + 6} ${height + 6}`}
      className="overflow-visible"
      role="img"
      aria-label={`Health over the last ${values.length} scans: ${values
        .map((value) => Math.round(value))
        .join(", ")}`}
    >
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={lastX} cy={lastY} r={2.6} fill={color} />
    </svg>
  )
}
