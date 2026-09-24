import type { CSSProperties, ReactNode } from "react"

import type { Category, Severity, Source } from "@/lib/types"
import { cn, severityColor } from "@/lib/utils"

export const CATEGORY_COLORS: Record<string, string> = {
  "code-design": "var(--category-code-design)",
  security: "var(--category-security)",
  documentation: "var(--category-documentation)",
  requirement: "var(--category-requirement)",
  test: "var(--category-test)",
}

export function categoryColor(category: Category | string) {
  return CATEGORY_COLORS[category] ?? "var(--category-code-design)"
}

export const SOURCE_LABELS: Record<Source, string> = {
  satd: "SATD",
  rule: "Rule-based",
}

/**
 * One tag on a finding: its severity, debt type or source.
 *
 * A tint of the tag's own colour, a border in the same colour, and text in a
 * darker (light theme) or lighter (dark theme) shade of it. The text is mixed
 * with `--foreground` in OKLab, which keeps the hue — mixing in OKLCH swings
 * amber towards pink on the way to slate — and clears 4.5:1 on a card for every
 * severity and category colour in both themes (worst case: medium, ~5:1).
 *
 * The label is the value itself, so colour is never the only signal.
 */
export function FindingTag({
  color,
  className,
  children,
}: Readonly<{ color: string; className?: string; children: ReactNode }>) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-sm border px-1.5 text-[11px] leading-none font-medium whitespace-nowrap",
        "border-[color-mix(in_oklab,var(--tag)_40%,transparent)] bg-[color-mix(in_oklab,var(--tag)_13%,transparent)] text-[color-mix(in_oklab,var(--tag)_50%,var(--foreground))]",
        "dark:border-[color-mix(in_oklab,var(--tag)_45%,transparent)] dark:bg-[color-mix(in_oklab,var(--tag)_22%,transparent)] dark:text-[color-mix(in_oklab,var(--tag)_70%,var(--foreground))]",
        className,
      )}
      style={{ "--tag": color } as CSSProperties}
    >
      {children}
    </span>
  )
}

export function SeverityTag({ severity }: Readonly<{ severity: Severity }>) {
  return <FindingTag color={severityColor(severity)}>{severity}</FindingTag>
}

export function CategoryTag({ category }: Readonly<{ category: Category }>) {
  return <FindingTag color={categoryColor(category)}>{category}</FindingTag>
}

/** The raw value stays the text ("satd", "rule"); CSS only changes its case. */
export function SourceTag({ source }: Readonly<{ source: Source }>) {
  return (
    <FindingTag
      color="var(--muted-foreground)"
      className={source === "satd" ? "uppercase" : undefined}
    >
      {source}
    </FindingTag>
  )
}
