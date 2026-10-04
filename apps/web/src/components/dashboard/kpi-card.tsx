import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

/**
 * One headline number: a label, the number with its unit, then a line or two of
 * context. Shared by the project dashboard and the workspace overview.
 */
export function KpiCard({
  label,
  value,
  unit,
  badge,
  children,
  className,
  testId,
}: Readonly<{
  label: ReactNode
  value: ReactNode
  unit?: ReactNode
  /** Sits beside the number: a grade, a delta. */
  badge?: ReactNode
  /** The context lines under the number. */
  children?: ReactNode
  className?: string
  testId?: string
}>) {
  return (
    <section
      data-testid={testId}
      className={cn(
        "flex min-w-0 flex-col gap-1.5 rounded-md border bg-card px-4.5 py-4",
        className,
      )}
    >
      <h2 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {label}
      </h2>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className="text-[2rem] leading-none font-semibold tracking-tight text-foreground-strong tabular-nums">
          {value}
        </span>
        {unit ? (
          <span className="text-sm text-muted-foreground">{unit}</span>
        ) : null}
        {badge}
      </div>
      {children ? (
        <div className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
          {children}
        </div>
      ) : null}
    </section>
  )
}

/** "+3", "−2" (a real minus) or "±0", coloured by direction; `invert` when down is good. */
export function DeltaText({
  value,
  invert = false,
  suffix,
}: Readonly<{ value: number; invert?: boolean; suffix?: string }>) {
  const rounded = Math.round(value)
  const good = invert ? rounded < 0 : rounded > 0
  const bad = invert ? rounded > 0 : rounded < 0
  const text =
    rounded === 0 ? "±0" : rounded > 0 ? `+${rounded}` : `−${Math.abs(rounded)}`
  return (
    <span
      className={cn(
        "font-semibold tabular-nums",
        good && "text-trend-up",
        bad && "text-trend-down",
      )}
    >
      {text}
      {suffix ? <span className="font-normal"> {suffix}</span> : null}
    </span>
  )
}

/** The square grade letter, coloured like everywhere else a grade is shown. */
export function GradeBadge({
  grade,
  color,
  size = "md",
}: Readonly<{ grade: string; color: string; size?: "sm" | "md" }>) {
  return (
    <span
      className={cn(
        "inline-grid shrink-0 place-items-center rounded-sm font-semibold text-white",
        size === "md"
          ? "h-7 min-w-7 px-1.5 text-[0.9375rem]"
          : "h-5 min-w-5 px-1 text-[0.75rem]",
      )}
      style={{ backgroundColor: color }}
    >
      {grade}
    </span>
  )
}
