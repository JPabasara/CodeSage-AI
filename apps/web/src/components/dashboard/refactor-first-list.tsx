"use client"

import type { ReactNode } from "react"
import { useMemo, useState } from "react"
import { ArrowDownWideNarrow, CheckCircle2, FilterX } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { Category, Finding, Severity } from "@/lib/types"
import { severityColor } from "@/lib/utils"

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

export type RefactorFirstListProps = {
  findings: Finding[]
  onSelect?: (finding: Finding) => void
  selectedFingerprint?: string
}

function ListPanel({
  children,
  action,
  count,
}: Readonly<{
  children: ReactNode
  action?: ReactNode
  count: number
}>) {
  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border-t-2 border-t-primary/60 bg-card shadow-sm ring-1 ring-foreground/10">
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b px-3 py-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">Refactor first</h2>
            <Badge variant="outline">{count}</Badge>
          </div>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <ArrowDownWideNarrow className="size-3.5" aria-hidden="true" />
            Ranked by priority
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

  const filter = findings.length ? (
    <Select
      value={category}
      onValueChange={(value) => setCategory(value as Category | "all")}
    >
      <SelectTrigger className="w-40" aria-label="Filter by debt type">
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
    <ListPanel action={filter} count={rows.length}>
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
          className="min-h-0 flex-1 overflow-y-auto"
          data-testid="refactor-first-scroll"
        >
          <Table className="table-fixed">
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow>
                <TableHead className="w-28">Priority</TableHead>
                <TableHead>Finding</TableHead>
                <TableHead className="w-[34%]">Location</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((finding) => (
                <TableRow
                  key={finding.fingerprint}
                  tabIndex={0}
                  onClick={() => onSelect?.(finding)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault()
                      onSelect?.(finding)
                    }
                  }}
                  aria-current={
                    finding.fingerprint === selectedFingerprint
                      ? "true"
                      : undefined
                  }
                  data-state={
                    finding.fingerprint === selectedFingerprint
                      ? "selected"
                      : undefined
                  }
                  className="cursor-pointer focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <TableCell className="whitespace-normal align-top">
                    <div className="flex flex-col items-start gap-1">
                      <Badge
                        variant="outline"
                        style={{
                          borderColor: severityColor(finding.severity),
                          color: severityColor(finding.severity),
                        }}
                      >
                        {finding.severity}
                      </Badge>
                      <span className="rounded-full border border-border/70 px-2 py-0.5 font-mono text-[0.625rem] text-muted-foreground">
                        P{Math.round(finding.priority)}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-normal align-top">
                    <div className="space-y-2">
                      <p className="break-words text-xs text-foreground">
                        {finding.reason}
                      </p>
                      <div className="flex flex-wrap gap-1">
                        <Badge variant="secondary">{finding.category}</Badge>
                        <Badge variant="secondary">{finding.source}</Badge>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-normal align-top font-mono text-[0.6875rem] text-muted-foreground">
                    <span className="break-all">
                      {finding.file}:{finding.line}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </ListPanel>
  )
}
