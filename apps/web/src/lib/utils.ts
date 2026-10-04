import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function healthColor(score: number) {
  if (score < 40) return "hsl(var(--health-bad))"
  if (score < 70) return "hsl(var(--health-mid))"
  return "hsl(var(--health-good))"
}

export function gradeColor(grade: string) {
  switch (grade) {
    case "A":
    case "B":
      return "hsl(var(--health-good))"
    case "C":
      return "hsl(var(--health-mid))"
    case "D":
      return "hsl(var(--severity-high))"
    default: // "E"
      return "hsl(var(--severity-critical))"
  }
}

// severity → colour, drives finding badges. severity value matches the CSS var name.
export function severityColor(severity: string) {
  return `hsl(var(--severity-${severity}))`
}

export function shortSha(sha: string) {
  return sha.slice(0, 7)
}

const relativeFormat = new Intl.RelativeTimeFormat("en", { numeric: "auto" })

/** "2 hours ago", "yesterday": how a person reads a recent time. */
export function relativeTime(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return undefined
  const parsed = Date.parse(iso)
  if (Number.isNaN(parsed)) return undefined
  let value = Math.round((parsed - now) / 1000)
  const steps: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, "second"],
    [60, "minute"],
    [24, "hour"],
    [30, "day"],
    [12, "month"],
  ]
  for (const [size, unit] of steps) {
    if (Math.abs(value) < size) return relativeFormat.format(value, unit)
    value = Math.round(value / size)
  }
  return relativeFormat.format(value, "year")
}

/** "Saturday, 4 October 2026 at 11:42": the exact time, for a title. */
export function absoluteTime(iso: string | null | undefined) {
  if (!iso) return undefined
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return undefined
  return parsed.toLocaleString(undefined, {
    dateStyle: "full",
    timeStyle: "short",
  })
}
