"use client"

import { useMemo, useState } from "react"
import { CheckCircle2, FilterX } from "lucide-react"

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

function sortKey(f: Finding) {
  return f.priority ?? SEVERITY_RANK[f.severity]
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
        : findings.filter((f) => f.category === category)
    return [...filtered].sort(
      (a, b) =>
        sortKey(b) - sortKey(a) ||
        SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity],
    )
  }, [findings, category])

  if (findings.length === 0) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Refactor first</h2>
        </div>
        <div className="rounded-md border p-6 text-center space-y-2">
          <div className="mx-auto flex size-9 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="size-5" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium">No refactoring issues found</p>
            <p className="text-muted-foreground text-xs">
              The scan found no technical debt or refactoring issues on this branch.
            </p>
            <p className="text-muted-foreground text-xs">
              Run a new scan after pushing code changes to keep track of code health.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Refactor first</h2>
        <Select
          value={category}
          onValueChange={(v) => setCategory(v as Category | "all")}
        >
          <SelectTrigger className="w-40" aria-label="Filter by debt type">
            <SelectValue placeholder="All types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-md border p-6 text-center space-y-3">
          <div className="mx-auto flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <FilterX className="size-5" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium">No findings match this filter</p>
            <p className="text-muted-foreground text-xs">
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
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Severity</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Reason</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((f) => (
              <TableRow
                key={f.fingerprint}
                onClick={() => onSelect?.(f)}
                data-state={
                  f.fingerprint === selectedFingerprint ? "selected" : undefined
                }
                className="cursor-pointer"
              >
                <TableCell>
                  <Badge
                    variant="outline"
                    style={{
                      borderColor: severityColor(f.severity),
                      color: severityColor(f.severity),
                    }}
                  >
                    {f.severity}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {f.category}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {f.file}:{f.line}
                </TableCell>
                <TableCell className="max-w-md truncate">{f.reason}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
