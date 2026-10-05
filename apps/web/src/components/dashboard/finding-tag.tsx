import type { CSSProperties, ReactNode } from "react"

import type { Category, Finding, Severity, Source } from "@/lib/types"
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

// One tag on a finding: its severity, debt type or source.
export function FindingTag({
  color,
  className,
  children,
}: Readonly<{ color: string; className?: string; children: ReactNode }>) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-sm border px-1.5 text-[0.75rem] leading-none font-medium whitespace-nowrap",
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
export function SourceTag({
  source,
  commentRule = false,
}: Readonly<{ source: Source; commentRule?: boolean }>) {
  return (
    <FindingTag
      color="var(--muted-foreground)"
      className={source === "satd" ? "uppercase" : undefined}
    >
      {commentRule ? "Comment rule" : source}
    </FindingTag>
  )
}

/** "code-design" → "Code design". */
export function sentenceCase(value: string) {
  const spaced = value.replace(/-/g, " ")
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/** Where a finding came from, as people say it: PMD, a CodeSage rule, or SATD. */
export function sourceLabel(finding: Pick<Finding, "source" | "rule_id">) {
  if (finding.source === "satd") return "SATD"
  if (finding.rule_id === "comment-pattern") return "Comment rule"
  return finding.rule_id?.startsWith("pmd:") ? "PMD" : "Rule"
}

/** Severity as a small square and a word: quieter than a filled tag. */
export function SeverityLabel({ severity }: Readonly<{ severity: Severity }>) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 font-medium text-foreground">
      <span
        aria-hidden="true"
        className="size-2 shrink-0 rounded-[2px]"
        style={{ backgroundColor: severityColor(severity) }}
      />
      <span className="capitalize">{severity}</span>
    </span>
  )
}

export function CategoryLabel({ category }: Readonly<{ category: Category }>) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 font-medium text-foreground">
      <span
        aria-hidden="true"
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: categoryColor(category) }}
      />
      {sentenceCase(category)}
    </span>
  )
}

/** The line under a finding's title: severity, type, source and where it is. */
export function FindingMeta({
  finding,
  location = true,
  compact = false,
  className,
  children,
}: Readonly<{
  finding: Finding
  location?: boolean
  /** One line: the labels keep their size and the path gives way, cut with "…". */
  compact?: boolean
  className?: string
  children?: ReactNode
}>) {
  return (
    <span
      className={cn(
        "flex min-w-0 items-center gap-x-3 gap-y-1 text-xs text-muted-foreground",
        compact ? "flex-nowrap whitespace-nowrap" : "flex-wrap",
        className,
      )}
    >
      <SeverityLabel severity={finding.severity} />
      <CategoryLabel category={finding.category} />
      <span className="shrink-0">{sourceLabel(finding)}</span>
      {location ? (
        <span
          className="max-w-full min-w-0 truncate font-mono"
          title={`${finding.file}:${finding.line}`}
        >
          {finding.file}:{finding.line}
        </span>
      ) : null}
      {children}
    </span>
  )
}
