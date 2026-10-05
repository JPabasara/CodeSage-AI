"use client"

import { findingSummary as findingText } from "@/lib/finding-summary"
import { ArrowRight } from "lucide-react"

import { DebtByTypeCard } from "@/components/dashboard/debt-by-type-card"
import { FindingMeta } from "@/components/dashboard/finding-tag"
import { HealthGraphCard } from "@/components/dashboard/health-graph-card"
import { DeltaText, GradeBadge, KpiCard } from "@/components/dashboard/kpi-card"
import { LearnMore } from "@/components/support/learn-more"
import {
  findingSummary,
  hotspotCount,
  hotspotFiles,
  HOTSPOT_HEALTH,
  leafFiles,
  topFindings,
} from "@/lib/dashboard-summary"
import type { Finding, HealthReport, Severity, TreeNode } from "@/lib/types"
import { cn, gradeColor, healthColor, severityColor } from "@/lib/utils"

const numbers = new Intl.NumberFormat("en-US")

function SeverityCount({
  severity,
  count,
}: Readonly<{ severity: Severity; count: number }>) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden="true"
        className="size-2 rounded-[2px]"
        style={{ backgroundColor: severityColor(severity) }}
      />
      <span className="font-medium text-foreground tabular-nums">{count}</span>{" "}
      {severity}
    </span>
  )
}

function CardHeading({
  title,
  description,
  action,
}: Readonly<{
  title: string
  description: string
  action?: React.ReactNode
}>) {
  return (
    <div className="flex items-start justify-between gap-3 px-4.5 pt-4">
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-foreground-strong">
          {title}
        </h2>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  )
}

function CardLink({
  onClick,
  children,
}: Readonly<{ onClick: () => void; children: React.ReactNode }>) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex shrink-0 items-center gap-1 rounded-sm text-[0.84375rem] font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
      <ArrowRight className="size-3.5" aria-hidden="true" />
    </button>
  )
}

/** The dashboard's first view: how healthy, where it is going, what to fix first. */
export function DashboardOverview({
  report,
  findings,
  includeTestFindingsByDefault,
  onOpenFinding,
  onOpenFile,
  onShowFindings,
  onShowCodeMap,
}: Readonly<{
  report: HealthReport
  findings: Finding[]
  includeTestFindingsByDefault?: boolean
  onOpenFinding: (finding: Finding) => void
  onOpenFile: (node: TreeNode) => void
  onShowFindings: () => void
  onShowCodeMap: () => void
}>) {
  const includeTests =
    includeTestFindingsByDefault ?? report.include_test_findings ?? false
  const summary = findingSummary(
    { ...report, include_test_findings: includeTests },
    findings,
  )
  const bySeverity = summary?.open_by_severity
  const criticalAndHigh = bySeverity
    ? bySeverity.critical + bySeverity.high
    : report.red_issue_count
  const files = report.java_file_count ?? leafFiles(report.tree).length
  const top = topFindings(findings, includeTests, 6)
  const hotspots = hotspotFiles(report.tree, 6)
  const previous =
    report.history.length > 1
      ? report.history[report.history.length - 2]
      : undefined

  return (
    <div className="flex flex-col gap-4">
      <section
        aria-label="Project summary"
        data-tour="dashboard-health"
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        <KpiCard
          testId="kpi-health"
          label={
            <>
              Code Health
              <LearnMore article="scoring-method" about="health scoring" />
            </>
          }
          value={
            <span data-testid="health-score">
              {Math.round(report.health_score)}
            </span>
          }
          unit="/100"
          badge={
            <GradeBadge grade={report.grade} color={gradeColor(report.grade)} />
          }
        >
          <span>
            <DeltaText value={report.delta} />{" "}
            {previous
              ? `since the previous scan (${Math.round(previous.score)})`
              : "first scan of this branch"}
          </span>
        </KpiCard>
        <KpiCard
          testId="kpi-critical-high"
          label="Critical & high"
          value={criticalAndHigh}
          unit={criticalAndHigh === 1 ? "finding" : "findings"}
        >
          {bySeverity ? (
            <span className="flex flex-wrap gap-x-3 gap-y-1">
              <SeverityCount severity="critical" count={bySeverity.critical} />
              <SeverityCount severity="high" count={bySeverity.high} />
            </span>
          ) : (
            <span>Open and in scope</span>
          )}
        </KpiCard>
        <KpiCard
          testId="kpi-open"
          label="Open findings"
          value={summary ? numbers.format(summary.open) : "—"}
        >
          <span>
            {summary
              ? `${numbers.format(summary.done)} marked done`
              : "Counting…"}
            {includeTests ? "" : " · test code set apart"}
          </span>
        </KpiCard>
        <KpiCard
          testId="kpi-hotspots"
          label="Hotspot files"
          value={hotspotCount(report.tree)}
          unit={`of ${numbers.format(files)}`}
        >
          <span>Files with health below {HOTSPOT_HEALTH}</span>
        </KpiCard>
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <HealthGraphCard history={report.history} />
        <DebtByTypeCard breakdown={report.category_breakdown} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <section className="min-w-0 rounded-md border bg-card">
          <CardHeading
            title="Refactor first"
            description={`Highest priority under the ${report.profile} profile`}
            action={
              summary && summary.open > 0 ? (
                <CardLink onClick={onShowFindings}>
                  All {numbers.format(summary.open)} findings
                </CardLink>
              ) : null
            }
          />
          {top.length === 0 ? (
            <p className="m-4.5 rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
              No open findings. Nothing to refactor first.
            </p>
          ) : (
            <ol className="px-2 pt-2 pb-2" aria-label="Top findings">
              {top.map((finding, index) => (
                <li key={finding.fingerprint}>
                  <button
                    type="button"
                    onClick={() => onOpenFinding(finding)}
                    className="grid w-full grid-cols-[1.75rem_minmax(0,1fr)_auto] items-start gap-x-3 rounded-md px-2.5 py-2.5 text-left outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="pt-0.5 text-center text-xs font-semibold text-muted-foreground tabular-nums">
                      {index + 1}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-foreground-strong">
                        {findingText(finding)}
                      </span>
                      <FindingMeta finding={finding} className="mt-1" />
                    </span>
                    <span className="text-right text-sm font-semibold text-foreground-strong tabular-nums">
                      {Math.round(finding.priority)}
                      <span className="block text-[0.6875rem] font-normal text-muted-foreground">
                        priority
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="min-w-0 rounded-md border bg-card">
          <CardHeading
            title="Hotspot files"
            description="Lowest file health"
            action={<CardLink onClick={onShowCodeMap}>Code map</CardLink>}
          />
          {hotspots.length === 0 ? (
            <p className="m-4.5 rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
              No files in this snapshot.
            </p>
          ) : (
            <ul className="px-2 pt-2 pb-2" aria-label="Hotspot files">
              {hotspots.map((file) => (
                <li key={file.path}>
                  <button
                    type="button"
                    onClick={() => onOpenFile(file)}
                    className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 rounded-md px-2.5 py-2 text-left outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-foreground-strong">
                        {file.name}
                      </span>
                      <span className="block truncate font-mono text-xs text-muted-foreground">
                        {file.path.slice(0, -file.name.length - 1) || "/"}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "text-sm font-semibold tabular-nums",
                        file.health_score < HOTSPOT_HEALTH
                          ? "text-trend-down"
                          : "text-foreground-strong",
                      )}
                    >
                      {Math.round(file.health_score)}
                    </span>
                    <span className="col-span-2 h-1.5 overflow-hidden rounded-full bg-muted">
                      <span
                        className="block h-full rounded-full"
                        style={{
                          width: `${Math.max(2, file.health_score)}%`,
                          backgroundColor: healthColor(file.health_score),
                        }}
                      />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
