"use client"

import { useMemo, useState } from "react"

import { Badge } from "@/components/ui/badge"
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
    () => Array.from(new Set(findings.map((f) => f.category))),
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
              // U-9. This row was `onClick` on a plain <tr>: no tab stop, no key
              // handler, so the core triage flow could not be reached by
              // keyboard at all. A tab stop plus Enter/Space is the smallest fix
              // that keeps this a real table — swapping the table for a list of
              // buttons would take the column alignment with it.
              tabIndex={0}
              onClick={() => onSelect?.(f)}
              onKeyDown={(event) => {
                // Both keys, because that is what a button answers to and this
                // row now behaves like one. Space scrolls the page by default,
                // so activating on it is only safe once that is prevented.
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault()
                  onSelect?.(f)
                }
              }}
              // `aria-current` carries the selection to a screen reader;
              // `data-state` is what shadcn's row styling reads. Both, because
              // neither one does the other's job.
              aria-current={
                f.fingerprint === selectedFingerprint ? "true" : undefined
              }
              data-state={
                f.fingerprint === selectedFingerprint ? "selected" : undefined
              }
              // An outline rather than a ring: a ring on `display: table-row`
              // renders inconsistently across browsers. Inset, so the row at the
              // edge of the scroll container does not lose half of it.
              className="focus-visible:outline-ring cursor-pointer focus-visible:-outline-offset-2 focus-visible:outline-2"
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

      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No findings for this filter.
        </p>
      ) : null}
    </div>
  )
}
