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
  Search,
} from "lucide-react"

import { FindingMeta, SOURCE_LABELS } from "@/components/dashboard/finding-tag"
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

function findingLocation(finding: Finding) {
  return `${finding.file}:${finding.line}`
}

/** What a search looks through: the words, the place and the rule. */
function matchesQuery(finding: Finding, query: string) {
  if (!query) return true
  return [finding.reason, finding.file, finding.symbol, finding.rule_id]
    .filter(Boolean)
    .some((value) => value!.toLowerCase().includes(query))
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

/** Rows shown at first, and added by each "Load more". */
const PAGE_SIZE = 25

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
    <section className="flex flex-col overflow-hidden rounded-md border bg-card">
      <div className="shrink-0 border-b">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 pt-3.5 pb-3">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-foreground-strong">
              Refactor first
            </h2>
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

/** A toggle chip in the toolbar; dashed when it is switched off. */
const chip = (pressed: boolean) =>
  cn(
    "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[0.8125rem] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
    pressed
      ? "border-border bg-card text-foreground hover:bg-muted"
      : "border-dashed text-muted-foreground hover:text-foreground",
  )

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
  const [query, setQuery] = useState("")
  // The list grows by PAGE_SIZE; a linked finding starts with enough rows to show it.
  const [visibleCount, setVisibleCount] = useState(() => {
    if (!selectedFingerprint) return PAGE_SIZE
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
    return selectedIndex < 0
      ? PAGE_SIZE
      : (Math.floor(selectedIndex / PAGE_SIZE) + 1) * PAGE_SIZE
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

  const needle = query.trim().toLowerCase()
  const rows = useMemo(() => {
    const filtered = findings.filter(
      (finding) =>
        (showDone || finding.status !== "done") &&
        (showTestFindings || finding.source_scope !== "test") &&
        (source === "all" || finding.source === source) &&
        severities.has(finding.severity) &&
        (category === "all" || finding.category === category) &&
        matchesQuery(finding, needle),
    )
    return [...filtered].sort(
      (a, b) =>
        sortKey(b) - sortKey(a) ||
        SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity],
    )
  }, [
    findings,
    showDone,
    showTestFindings,
    source,
    severities,
    category,
    needle,
  ])

  const doneCount = findings.filter(
    (finding) => finding.status === "done",
  ).length
  const openCount = findings.length - doneCount

  const visibleRows = useMemo(
    () => rows.slice(0, visibleCount),
    [rows, visibleCount],
  )
  const remaining = rows.length - visibleRows.length

  const toggleSeverity = (severity: Severity) => {
    setVisibleCount(PAGE_SIZE)
    setSeverities((current) => {
      const next = new Set(current)
      if (next.has(severity)) next.delete(severity)
      else next.add(severity)
      return next
    })
  }

  const clearFilters = () => {
    setVisibleCount(PAGE_SIZE)
    setSource("all")
    setSeverities(new Set(SEVERITIES))
    setCategory("all")
    setQuery("")
    setShowTestFindings(includeTestFindingsByDefault)
  }

  // Props every toolbar control shares: one of them is tabbable at a time.
  const toolbarItem = (index: number) => ({
    [TOOLBAR_ITEM]: "",
    tabIndex: focusIndex === index ? 0 : -1,
    onFocus: () => setFocusIndex(index),
  })

  const segment =
    "inline-flex h-7 items-center rounded-[0.25rem] px-2.5 text-[0.8125rem] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"

  // Two lines: search and severity, then source, type and the toggles.
  const toolbar = findings.length ? (
    <div
      role="toolbar"
      aria-label="Filter findings"
      onKeyDown={onToolbarKeyDown}
      className="space-y-2 border-t px-3.5 py-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex h-8 min-w-52 flex-1 items-center gap-2 rounded-md border bg-card px-2.5 text-sm text-muted-foreground focus-within:ring-2 focus-within:ring-ring">
          <Search className="size-4 shrink-0" aria-hidden="true" />
          <span className="sr-only">Search findings</span>
          <input
            type="search"
            value={query}
            onChange={(event) => {
              setVisibleCount(PAGE_SIZE)
              setQuery(event.target.value)
            }}
            placeholder="Search findings or files"
            className="h-full min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
          />
        </label>

        <div
          role="group"
          aria-label="Filter by severity"
          className="inline-flex flex-wrap items-center gap-1.5"
        >
          {SEVERITIES.map((severity, index) => {
            const pressed = severities.has(severity)
            return (
              <button
                key={severity}
                type="button"
                aria-pressed={pressed}
                onClick={() => toggleSeverity(severity)}
                className={chip(pressed)}
                {...toolbarItem(SOURCE_OPTIONS.length + index)}
              >
                <span
                  aria-hidden="true"
                  className="size-2 shrink-0 rounded-xs border"
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
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div
          role="group"
          aria-label="Filter by source"
          className="inline-flex h-8 items-center gap-0.5 rounded-md border p-0.5"
        >
          {SOURCE_OPTIONS.map((option, index) => {
            const pressed = source === option.value
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={pressed}
                onClick={() => {
                  setVisibleCount(PAGE_SIZE)
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

        <Select
          value={category}
          onValueChange={(value) => {
            setVisibleCount(PAGE_SIZE)
            setCategory(value as Category | "all")
          }}
        >
          <SelectTrigger
            className="h-8 w-36 text-[0.8125rem]"
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
            setVisibleCount(PAGE_SIZE)
            setShowDone((current) => !current)
          }}
          className={cn(chip(showDone), showDone && "bg-accent")}
          {...toolbarItem(DONE_FILTER_INDEX)}
        >
          <CheckCircle2 className="size-3.5" aria-hidden="true" />
          Show done ({doneCount})
        </button>

        <button
          type="button"
          aria-pressed={showTestFindings}
          onClick={() => {
            setVisibleCount(PAGE_SIZE)
            setShowTestFindings((current) => !current)
          }}
          className={cn(
            chip(showTestFindings),
            showTestFindings && "bg-accent",
          )}
          {...toolbarItem(TEST_FILTER_INDEX)}
        >
          <FileCode2 className="size-3.5" aria-hidden="true" />
          Test code
        </button>
        {repoId ? (
          <SourceScopeSettings repoId={repoId} nodes={treeNodes} />
        ) : null}

        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {openCount} open / {doneCount} done
        </span>
      </div>
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
  if (needle) activeFilters.push(query.trim())
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
        <div className="flex flex-col">
          <ul aria-label="Ranked refactor findings">
            {visibleRows.map((finding, index) => {
              const location = findingLocation(finding)
              const selected = finding.fingerprint === selectedFingerprint
              const done = finding.status === "done"
              const busy = statusBusyFingerprint === finding.fingerprint
              const priority = Math.round(
                finding.priority ?? SEVERITY_RANK[finding.severity],
              )

              return (
                <li
                  key={finding.fingerprint}
                  className={cn(
                    "flex items-center border-t border-l-[3px] border-l-transparent transition-colors first:border-t-0 hover:bg-muted/50",
                    selected && "border-l-primary bg-accent hover:bg-accent",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onSelect?.(finding)}
                    aria-current={selected ? "true" : undefined}
                    data-state={selected ? "selected" : undefined}
                    aria-label={`${finding.severity} priority ${priority} finding: ${finding.reason} at ${location}`}
                    data-testid="finding-card"
                    className={cn(
                      "group grid min-w-0 flex-1 grid-cols-[1.75rem_minmax(0,1fr)_auto] items-start gap-x-3 py-2.5 pr-3 pl-2.5 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset",
                      done && "opacity-70",
                    )}
                  >
                    <span
                      data-slot="rank"
                      className="pt-0.5 text-center text-xs font-semibold text-muted-foreground tabular-nums"
                    >
                      {index + 1}
                    </span>
                    <span className="min-w-0">
                      <span
                        className="block truncate text-[0.90625rem] leading-snug font-medium text-foreground-strong group-hover:underline group-hover:decoration-border"
                        title={finding.reason}
                      >
                        {finding.reason}
                      </span>
                      <FindingMeta finding={finding} compact className="mt-1">
                        {done ? <Badge variant="outline">Done</Badge> : null}
                      </FindingMeta>
                    </span>
                    <span
                      className="text-right text-sm font-semibold text-foreground-strong tabular-nums"
                      title="Priority"
                    >
                      {priority}
                      <span className="block text-[0.6875rem] font-normal text-muted-foreground">
                        priority
                      </span>
                    </span>
                  </button>
                  {canTriage ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-lg"
                      className="mr-2 shrink-0 text-muted-foreground hover:text-foreground"
                      aria-label={done ? "Reopen" : "Mark as done"}
                      title={done ? "Reopen" : "Mark as done"}
                      disabled={busy}
                      onClick={() =>
                        onStatusChange?.(finding, done ? "open" : "done")
                      }
                    >
                      {busy ? (
                        <Loader2 className="animate-spin" aria-hidden="true" />
                      ) : done ? (
                        <RotateCcw aria-hidden="true" />
                      ) : (
                        <CheckCircle2 aria-hidden="true" />
                      )}
                    </Button>
                  ) : null}
                </li>
              )
            })}
          </ul>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
            <p
              className="text-[0.84375rem] text-muted-foreground tabular-nums"
              aria-live="polite"
            >
              Showing 1–{visibleRows.length} of {rows.length}
            </p>
            {remaining > 0 ? (
              <Button
                type="button"
                variant="outline"
                className="h-8 px-3 text-sm"
                onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
              >
                Load {Math.min(PAGE_SIZE, remaining)} more
              </Button>
            ) : null}
          </div>
        </div>
      )}
    </ListPanel>
  )
}
