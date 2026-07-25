import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function healthColor(score: number) {
  if (score < 40) return "hsl(var(--health-bad))";
  if (score < 70) return "hsl(var(--health-mid))";
  return "hsl(var(--health-good))";
}

// grade → colour (A/B green, C amber, D orange, E red). Returns an hsl() string
// for use in style={{ color }} (severity/health tokens aren't Tailwind colours).
export function gradeColor(grade: string) {
  switch (grade) {
    case "A":
    case "B":
      return "hsl(var(--health-good))";
    case "C":
      return "hsl(var(--health-mid))";
    case "D":
      return "hsl(var(--severity-high))";
    default: // "E"
      return "hsl(var(--severity-critical))";
  }
}

// severity → colour, drives finding badges. severity value matches the CSS var name.
export function severityColor(severity: string) {
  return `hsl(var(--severity-${severity}))`;
}

// short commit SHA for display (first 7 chars, like git).
export function shortSha(sha: string) {
  return sha.slice(0, 7);
}