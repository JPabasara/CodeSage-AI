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