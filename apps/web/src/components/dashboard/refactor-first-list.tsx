"use client"

import type { ReactNode } from "react"
import { useMemo, useState } from "react"
import {
  ArrowDownWideNarrow,
  CheckCircle2,
  FileCode2,
  FilterX,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { Category, Finding, Severity } from "@/lib/types"
import { cn, severityColor } from "@/lib/utils"

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
}

function sortKey(finding: Finding) {
  return finding.priority ?? SEVERITY_RANK[finding.severity]
}

export const ALL_CATEGORIES: Category[] = [
  "code-design",
  "requirement",
  "documentation",
  "test",
  "security",
]

const CATEGORY_BADGE_COLORS: Record<Category, string> = {
  "code-design": "var(--category-code-design)",
  requirement: "var(--category-requirement)",
  documentation: "var(--category-documentation)",
  test: "var(--category-test)",
  security: "var(--category-security)",
}

function truncateText(value: string, max: number) {
  if (value.length <= max) return value
  return `${value.slice(0, Math.max(0, max - 3)).trimEnd()}...`
}

function findingLocation(finding: Finding) {
  return `${finding.file}:${finding.line}`
}

export type RefactorFirstListProps = {
  findings: Finding[]
  onSelect?: (finding: Finding) => void
  selectedFingerprint?: string
}

const PAGE_SIZE = 10

function ListPanel({
  children,
  action,
  count,
  total,
}: Readonly<{
  children: ReactNode
  action?: ReactNode
  count: number
  total?: number
}>) {
  const badgeLabel =
    total !== undefined && total !== count ? `${count} of ${total}` : count

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border-t-2 border-t-primary/60 bg-card shadow-sm ring-1 ring-foreground/10">
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b px-3 py-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">Refactor first</h2>
            <Badge variant="outline">{badgeLabel}</Badge>
          </div>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <ArrowDownWideNarrow className="size-3.5" aria-hidden="true" />
            Ranked by severity × risk — start at the top.
          </p>
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

export function RefactorFirstList({
  findings,
  onSelect,
  selectedFingerprint,
}: Readonly<RefactorFirstListProps>) {
  const [category, setCategory] = useState<Category | "all">("all")
  const [showAll, setShowAll] = useState(false)

  const categories = useMemo(
    () =>
      Array.from(
        new Set([...ALL_CATEGORIES, ...findings.map((f) => f.category)]),
      ),
    [findings],
  )

  const rows = useMemo(() => {
    const filtered =
      category === "all"
        ? findings
        : findings.filter((finding) => finding.category === category)
    return [...filtered].sort(
      (a, b) =>
        sortKey(b) - sortKey(a) ||
        SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity],
    )
  }, [findings, category])

  const visibleRows = useMemo(
    () => (showAll ? rows : rows.slice(0, PAGE_SIZE)),
    [rows, showAll],
  )

  const filter = findings.length ? (
    <div>
      <label htmlFor="debt-type-filter" className="sr-only">
        Filter by debt type
      </label>
      <Select
        value={category}
        onValueChange={(value) => setCategory(value as Category | "all")}
      >
        <SelectTrigger id="debt-type-filter" className="w-40" aria-label="Filter by debt type">
          <SelectValue placeholder="All types" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All types</SelectItem>
          {categories.map((item) => (
            <SelectItem key={item} value={item}>
              {item}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  ) : null

  if (findings.length === 0) {
    return (
      <ListPanel count={0}>
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center p-6 text-center space-y-2">
          <div className="mx-auto flex size-9 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="size-5" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium">No refactoring issues found</p>
            <p className="text-xs text-muted-foreground">
              The scan found no technical debt or refactoring issues on this
              branch.
            </p>
            <p className="text-xs text-muted-foreground">
              Run a new scan after pushing code changes to keep track of code
              health.
            </p>
          </div>
        </div>
      </ListPanel>
    )
  }

  return (
    <ListPanel action={filter} count={rows.length} total={findings.length}>
      {rows.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center p-6 text-center space-y-3">
          <div className="mx-auto flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <FilterX className="size-5" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium">No findings match this filter</p>
            <p className="text-xs text-muted-foreground">
              No findings match the &ldquo;{category}&rdquo; filter.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCategory("all")}
          >
            Clear filter
          </Button>
        </div>
      ) : (
        <div
          className="flex min-h-0 flex-1 flex-col overflow-y-auto"
          data-testid="refactor-first-scroll"
        >
          <ul className="space-y-2 p-3" aria-label="Ranked refactor findings">
            {visibleRows.map((finding, index) => {
              const location = findingLocation(finding)
              const selected = finding.fingerprint === selectedFingerprint

              return (
                <li key={finding.fingerprint}>
                  <button
                    type="button"
                    onClick={() => onSelect?.(finding)}
                    aria-current={selected ? "true" : undefined}
                    data-state={selected ? "selected" : undefined}
                    aria-label={`${finding.severity} priority ${Math.round(finding.priority ?? SEVERITY_RANK[finding.severity])} finding: ${finding.reason} at ${location}`}
                    className={cn(
                      "group w-full rounded-md border bg-background/70 p-3 text-left shadow-sm transition hover:border-primary/50 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      selected &&
                        "border-primary bg-accent/45 ring-1 ring-primary/20",
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded-full border border-border/70 bg-card px-2 py-0.5 font-mono text-[0.625rem] font-semibold text-muted-foreground">
                        #{index + 1}
                      </span>
                      <Badge
                        variant="default"
                        className="border-transparent text-white"
                        style={{
                          backgroundColor: severityColor(finding.severity),
                        }}
                      >
                        {finding.severity}
                      </Badge>
                      <span className="rounded-full border border-border/70 bg-card px-2 py-0.5 font-mono text-[0.625rem] text-muted-foreground">
                        P
                        {Math.round(
                          finding.priority ?? SEVERITY_RANK[finding.severity],
                        )}
                      </span>
                      <Badge
                        variant="default"
                        className="border-transparent text-white"
                        style={{
                          backgroundColor:
                            CATEGORY_BADGE_COLORS[finding.category],
                        }}
                      >
                        {finding.category}
                      </Badge>
                      {finding.source ? (
                        <Badge
                          variant="default"
                          className="border-transparent bg-slate-700 text-white dark:bg-slate-500"
                        >
                          {finding.source}
                        </Badge>
                      ) : null}
                    </div>

                    <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(11rem,0.34fr)]">
                      <p
                        className="break-words text-xs font-medium leading-5 text-foreground"
                        title={finding.reason}
                      >
                        {truncateText(finding.reason, 155)}
                      </p>
                      <div className="flex min-w-0 items-start gap-1.5 text-muted-foreground">
                        <FileCode2
                          className="mt-0.5 size-3.5 shrink-0"
                          aria-hidden="true"
                        />
                        <span
                          className="break-all font-mono text-[0.6875rem] leading-5"
                          title={location}
                        >
                          {truncateText(location, 76)}
                        </span>
                      </div>
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>

          {rows.length > PAGE_SIZE && (
            <div className="flex justify-center pb-3 pt-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowAll((prev) => !prev)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                {showAll
                  ? `Show top ${PAGE_SIZE}`
                  : `Show all ${rows.length} findings`}
              </Button>
            </div>
          )}
        </div>
      )}
    </ListPanel>
  )
}
