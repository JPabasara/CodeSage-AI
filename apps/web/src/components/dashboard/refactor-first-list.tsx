"use client"

import type { KeyboardEvent, ReactNode } from "react"
import { useMemo, useState } from "react"
import {
  ArrowDownWideNarrow,
  CheckCircle2,
  FileCode2,
  FilterX,
  Loader2,
  RotateCcw,
} from "lucide-react"

import {
  CategoryTag,
  SeverityTag,
  SOURCE_LABELS,
  SourceTag,
} from "@/components/dashboard/finding-tag"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type {
  Category,
  Finding,
  FindingStatus,
  Severity,
  Source,
  TreeNode,
} from "@/lib/types"
import { SourceScopeSettings } from "@/components/dashboard/source-scope-settings"
import { cn, severityColor } from "@/lib/utils"

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
}

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low"]

const SEVERITY_LABELS: Record<Severity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
}

type SourceFilter = "all" | Source

const SOURCE_OPTIONS: { value: SourceFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "satd", label: SOURCE_LABELS.satd },
  { value: "rule", label: SOURCE_LABELS.rule },
]

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

function truncateText(value: string, max: number) {
  if (value.length <= max) return value
  return `${value.slice(0, Math.max(0, max - 3)).trimEnd()}...`
}

function findingLocation(finding: Finding) {
  return `${finding.file}:${finding.line}`
}

/** “a”, “a” and “b”, “a”, “b” and “c”. */
function quotedList(items: string[]) {
  const quoted = items.map((item) => `“${item}”`)
  if (quoted.length <= 1) return quoted.join("")
  return `${quoted.slice(0, -1).join(", ")} and ${quoted[quoted.length - 1]}`
}

export type RefactorFirstListProps = {
  findings: Finding[]
  onSelect?: (finding: Finding) => void
  selectedFingerprint?: string
  canTriage?: boolean
  statusBusyFingerprint?: string
  onStatusChange?: (finding: Finding, status: FindingStatus) => void
  includeTestFindingsByDefault?: boolean
  repoId?: string
  treeNodes?: TreeNode[]
}

const PAGE_SIZE = 10

function ListPanel({
  children,
  toolbar,
  count,
  total,
}: Readonly<{
  children: ReactNode
  toolbar?: ReactNode
  count: number
  total?: number
}>) {
  const badgeLabel =
    total !== undefined && total !== count ? `${count} of ${total}` : count

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border bg-card">
      <div className="shrink-0 space-y-3 border-b px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold">Refactor first</h2>
            <Badge variant="outline" className="tabular-nums">
              {badgeLabel}
            </Badge>
          </div>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <ArrowDownWideNarrow className="size-3.5" aria-hidden="true" />
            Ranked by severity × risk — start at the top.
          </p>
        </div>
        {toolbar}
      </div>
      {children}
    </section>
  )
}

const TOOLBAR_ITEM = "data-toolbar-item"
// Toolbar order: the source toggle, the severity chips, then the category menu.
const CATEGORY_FILTER_INDEX = SOURCE_OPTIONS.length + SEVERITIES.length
const DONE_FILTER_INDEX = CATEGORY_FILTER_INDEX + 1
const TEST_FILTER_INDEX = DONE_FILTER_INDEX + 1

function onToolbarKeyDown(event: KeyboardEvent<HTMLDivElement>) {
  const target = event.target as HTMLElement
  if (!event.currentTarget.contains(target)) return
  const items = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(`[${TOOLBAR_ITEM}]`),
  )
  const current = items.indexOf(target)
  if (current === -1) return

  let next: number
  switch (event.key) {
    case "ArrowRight":
      next = (current + 1) % items.length
      break
    case "ArrowLeft":
      next = (current - 1 + items.length) % items.length
      break
    case "Home":
      next = 0
      break
    case "End":
      next = items.length - 1
      break
    default:
      return
  }
  event.preventDefault()
  items[next]?.focus()
}

export function RefactorFirstList({
  findings,
  onSelect,
  selectedFingerprint,
  canTriage = false,
  statusBusyFingerprint,
  onStatusChange,
  includeTestFindingsByDefault = false,
  repoId,
  treeNodes = [],
}: Readonly<RefactorFirstListProps>) {
  const [source, setSource] = useState<SourceFilter>("all")
  const [severities, setSeverities] = useState<ReadonlySet<Severity>>(
    () => new Set(SEVERITIES),
  )
  const [category, setCategory] = useState<Category | "all">("all")
  const [currentPage, setCurrentPage] = useState(() => {
    if (!selectedFingerprint) return 0
    const initiallyVisible = findings
      .filter(
        (finding) =>
          finding.status !== "done" &&
          (includeTestFindingsByDefault || finding.source_scope !== "test"),
      )
      .sort(
        (a, b) =>
          sortKey(b) - sortKey(a) ||
          SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity],
      )
    const selectedIndex = initiallyVisible.findIndex(
      (finding) => finding.fingerprint === selectedFingerprint,
    )
    return selectedIndex < 0 ? 0 : Math.floor(selectedIndex / PAGE_SIZE)
  })
  const [showDone, setShowDone] = useState(false)
  const [showTestFindings, setShowTestFindings] = useState(
    includeTestFindingsByDefault,
  )
  // The toolbar control that holds the single Tab stop (roving tabindex).
  const [focusIndex, setFocusIndex] = useState(CATEGORY_FILTER_INDEX)

  const categories = useMemo(
    () =>
      Array.from(
        new Set([...ALL_CATEGORIES, ...findings.map((f) => f.category)]),
      ),
    [findings],
  )

  const rows = useMemo(() => {
    const filtered = findings.filter(
      (finding) =>
        (showDone || finding.status !== "done") &&
        (showTestFindings || finding.source_scope !== "test") &&
        (source === "all" || finding.source === source) &&
        severities.has(finding.severity) &&
        (category === "all" || finding.category === category),
    )
    return [...filtered].sort(
      (a, b) =>
        sortKey(b) - sortKey(a) ||
        SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity],
    )
  }, [findings, showDone, showTestFindings, source, severities, category])

  const doneCount = findings.filter(
    (finding) => finding.status === "done",
  ).length
  const openCount = findings.length - doneCount

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const safePage = Math.min(currentPage, pageCount - 1)
  const pageStart = safePage * PAGE_SIZE
  const visibleRows = useMemo(
    () => rows.slice(pageStart, pageStart + PAGE_SIZE),
    [rows, pageStart],
  )

  const toggleSeverity = (severity: Severity) => {
    setCurrentPage(0)
    setSeverities((current) => {
      const next = new Set(current)
      if (next.has(severity)) next.delete(severity)
      else next.add(severity)
      return next
    })
  }

  const clearFilters = () => {
    setCurrentPage(0)
    setSource("all")
    setSeverities(new Set(SEVERITIES))
    setCategory("all")
    setShowTestFindings(includeTestFindingsByDefault)
  }

  // Props every toolbar control shares: one of them is tabbable at a time.
  const toolbarItem = (index: number) => ({
    [TOOLBAR_ITEM]: "",
    tabIndex: focusIndex === index ? 0 : -1,
    onFocus: () => setFocusIndex(index),
  })

  const segment =
    "inline-flex h-6 items-center rounded-sm px-2 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"

  const toolbar = findings.length ? (
    <div
      role="toolbar"
      aria-label="Filter findings"
      onKeyDown={onToolbarKeyDown}
      className="flex flex-wrap items-center gap-2"
    >
      <div
        role="group"
        aria-label="Filter by source"
        className="inline-flex items-center gap-0.5 rounded-md border p-px"
      >
        {SOURCE_OPTIONS.map((option, index) => {
          const pressed = source === option.value
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={pressed}
              onClick={() => {
                setCurrentPage(0)
                setSource(option.value)
              }}
              className={cn(
                segment,
                pressed
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
              {...toolbarItem(index)}
            >
              {option.label}
            </button>
          )
        })}
      </div>

      <div
        role="group"
        aria-label="Filter by severity"
        className="inline-flex items-center gap-1"
      >
        {SEVERITIES.map((severity, index) => {
          const pressed = severities.has(severity)
          return (
            <button
              key={severity}
              type="button"
              aria-pressed={pressed}
              onClick={() => toggleSeverity(severity)}
              className={cn(
                segment,
                "h-7 gap-1.5 border",
                pressed
                  ? "border-border bg-card text-foreground hover:bg-muted"
                  : "border-dashed text-muted-foreground hover:text-foreground",
              )}
              {...toolbarItem(SOURCE_OPTIONS.length + index)}
            >
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-full border"
                style={{
                  borderColor: severityColor(severity),
                  backgroundColor: pressed
                    ? severityColor(severity)
                    : "transparent",
                }}
              />
              {SEVERITY_LABELS[severity]}
            </button>
          )
        })}
      </div>

      <Select
        value={category}
        onValueChange={(value) => {
          setCurrentPage(0)
          setCategory(value as Category | "all")
        }}
      >
        <SelectTrigger
          className="w-36"
          aria-label="Filter by debt type"
          {...toolbarItem(CATEGORY_FILTER_INDEX)}
        >
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

      <button
        type="button"
        aria-pressed={showDone}
        onClick={() => {
          setCurrentPage(0)
          setShowDone((current) => !current)
        }}
        className={cn(
          segment,
          "h-7 gap-1.5 border",
          showDone
            ? "border-border bg-accent text-accent-foreground"
            : "border-dashed text-muted-foreground hover:text-foreground",
        )}
        {...toolbarItem(DONE_FILTER_INDEX)}
      >
        <CheckCircle2 className="size-3.5" aria-hidden="true" />
        Show done ({doneCount})
      </button>

      <button
        type="button"
        aria-pressed={showTestFindings}
        onClick={() => {
          setCurrentPage(0)
          setShowTestFindings((current) => !current)
        }}
        className={cn(
          segment,
          "h-7 gap-1.5 border",
          showTestFindings
            ? "border-border bg-accent text-accent-foreground"
            : "border-dashed text-muted-foreground hover:text-foreground",
        )}
        {...toolbarItem(TEST_FILTER_INDEX)}
      >
        <FileCode2 className="size-3.5" aria-hidden="true" />
        Test code
      </button>
      {repoId ? (
        <SourceScopeSettings repoId={repoId} nodes={treeNodes} />
      ) : null}

      <span className="text-xs text-muted-foreground tabular-nums">
        {openCount} open / {doneCount} done
      </span>
    </div>
  ) : null

  if (findings.length === 0) {
    return (
      <ListPanel count={0}>
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center space-y-2 p-6 text-center">
          <div className="mx-auto flex size-9 items-center justify-center rounded-md bg-[hsl(var(--health-good)/0.12)] text-[hsl(var(--health-good))]">
            <CheckCircle2 className="size-5" aria-hidden="true" />
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

  // What the empty result is filtered by, in the words the controls use.
  const activeFilters: string[] = []
  if (source !== "all") activeFilters.push(SOURCE_LABELS[source])
  if (severities.size > 0 && severities.size < SEVERITIES.length) {
    activeFilters.push(
      SEVERITIES.filter((s) => severities.has(s))
        .map((s) => SEVERITY_LABELS[s])
        .join(" + "),
    )
  }
  if (category !== "all") activeFilters.push(category)
  const noMatchDetail =
    severities.size === 0
      ? "Every severity is switched off."
      : activeFilters.length === 1
        ? `No findings match the ${quotedList(activeFilters)} filter.`
        : `No findings match the ${quotedList(activeFilters)} filters.`

  const onlyDoneAreHidden =
    rows.length === 0 && doneCount > 0 && !showDone && openCount === 0

  return (
    <ListPanel toolbar={toolbar} count={rows.length} total={findings.length}>
      {onlyDoneAreHidden ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center space-y-3 p-6 text-center">
          <div className="mx-auto flex size-9 items-center justify-center rounded-md bg-[hsl(var(--health-good)/0.12)] text-[hsl(var(--health-good))]">
            <CheckCircle2 className="size-5" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium">All findings are marked done</p>
            <p className="text-xs text-muted-foreground">
              Done findings are hidden from this snapshot by default.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowDone(true)}>
            Show done findings
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center space-y-3 p-6 text-center">
          <div className="mx-auto flex size-9 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <FilterX className="size-5" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium">No findings match this filter</p>
            <p className="text-xs text-muted-foreground">{noMatchDetail}</p>
          </div>
          <Button variant="outline" size="sm" onClick={clearFilters}>
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
              const priority = Math.round(
                finding.priority ?? SEVERITY_RANK[finding.severity],
              )

              return (
                <li
                  key={finding.fingerprint}
                  className={cn(
                    "overflow-hidden rounded-md border bg-card transition-colors hover:border-primary/40 hover:bg-accent/30",
                    selected && "border-primary/70 bg-accent/40",
                    finding.status === "done" && "opacity-75",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onSelect?.(finding)}
                    aria-current={selected ? "true" : undefined}
                    data-state={selected ? "selected" : undefined}
                    aria-label={`${finding.severity} priority ${priority} finding: ${finding.reason} at ${location}`}
                    data-testid="finding-card"
                    className="group w-full p-3 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="min-w-6 font-mono text-[0.75rem] font-medium text-muted-foreground tabular-nums">
                        #{pageStart + index + 1}
                      </span>
                      <SeverityTag severity={finding.severity} />
                      <CategoryTag category={finding.category} />
                      {finding.source ? (
                        <SourceTag source={finding.source} />
                      ) : null}
                      {finding.status === "done" ? (
                        <Badge variant="outline">Done</Badge>
                      ) : null}
                      <span
                        className="ml-auto font-mono text-[0.75rem] text-muted-foreground tabular-nums"
                        title="Priority"
                      >
                        P{priority}
                      </span>
                    </div>

                    <div className="mt-2 grid gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,1fr)_minmax(11rem,0.34fr)]">
                      <p
                        className="text-sm leading-5 wrap-break-word text-foreground"
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
                          className="font-mono text-xs leading-5 break-all"
                          title={location}
                        >
                          {truncateText(location, 76)}
                        </span>
                      </div>
                    </div>
                  </button>
                  {canTriage ? (
                    <div className="flex justify-end border-t px-3 py-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={statusBusyFingerprint === finding.fingerprint}
                        onClick={() =>
                          onStatusChange?.(
                            finding,
                            finding.status === "done" ? "open" : "done",
                          )
                        }
                      >
                        {statusBusyFingerprint === finding.fingerprint ? (
                          <Loader2
                            className="animate-spin"
                            aria-hidden="true"
                          />
                        ) : finding.status === "done" ? (
                          <RotateCcw aria-hidden="true" />
                        ) : (
                          <CheckCircle2 aria-hidden="true" />
                        )}
                        {finding.status === "done" ? "Reopen" : "Mark as done"}
                      </Button>
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>

          {rows.length > PAGE_SIZE ? (
            <nav
              aria-label="Findings pagination"
              className="sticky bottom-0 flex items-center justify-between gap-3 border-t bg-card px-3 py-2"
            >
              <p
                className="text-xs text-muted-foreground tabular-nums"
                aria-live="polite"
              >
                Page {safePage + 1} of {pageCount} · {pageStart + 1}–
                {Math.min(pageStart + PAGE_SIZE, rows.length)} of {rows.length}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={safePage === 0}
                  onClick={() =>
                    setCurrentPage((page) => Math.max(0, page - 1))
                  }
                >
                  Previous
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={safePage >= pageCount - 1}
                  onClick={() =>
                    setCurrentPage((page) => Math.min(pageCount - 1, page + 1))
                  }
                >
                  Next
                </Button>
              </div>
            </nav>
          ) : null}
        </div>
      )}
    </ListPanel>
  )
}
