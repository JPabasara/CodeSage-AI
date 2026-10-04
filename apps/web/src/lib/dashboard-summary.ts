// The dashboard's headline numbers, kept pure so they can be tested without a page.
import type {
  Finding,
  FindingSummary,
  HealthReport,
  Severity,
  TreeNode,
} from "@/lib/types"

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
}

/** Below this a file counts as a hotspot: grade D or E. */
export const HOTSPOT_HEALTH = 40

/** Every file in the tree, in tree order. */
export function leafFiles(nodes: TreeNode[]): TreeNode[] {
  return nodes.flatMap((node) =>
    node.type === "file" ? [node] : leafFiles(node.children ?? []),
  )
}

/** Whether a finding is in the list's default view (test code set apart). */
export function inDefaultScope(finding: Finding, includeTests: boolean) {
  return includeTests || finding.source_scope !== "test"
}

/** The same order as the Refactor-first list: priority, then severity. */
export function byPriority(a: Finding, b: Finding) {
  return (
    (b.priority ?? SEVERITY_RANK[b.severity]) -
      (a.priority ?? SEVERITY_RANK[a.severity]) ||
    SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]
  )
}

/**
 * Open, done and open-by-severity counts in the default view. Loaded findings
 * are counted first, because they already carry any "Mark as done" made on this
 * page; the API's own summary stands in until they arrive.
 */
export function findingSummary(
  report: Pick<HealthReport, "finding_summary" | "include_test_findings">,
  findings: Finding[] | undefined,
): FindingSummary | undefined {
  if (!findings) return report.finding_summary ?? undefined
  const includeTests = report.include_test_findings ?? false
  const scoped = findings.filter((finding) =>
    inDefaultScope(finding, includeTests),
  )
  const open = scoped.filter((finding) => finding.status !== "done")
  const openBySeverity: Record<Severity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  }
  for (const finding of open) openBySeverity[finding.severity] += 1
  return {
    total: scoped.length,
    open: open.length,
    done: scoped.length - open.length,
    open_by_severity: openBySeverity,
  }
}

/** The first `count` open findings worth fixing, in list order. */
export function topFindings(
  findings: Finding[],
  includeTests: boolean,
  count = 6,
): Finding[] {
  return findings
    .filter(
      (finding) =>
        finding.status !== "done" && inDefaultScope(finding, includeTests),
    )
    .sort(byPriority)
    .slice(0, count)
}

/** The least healthy files, worst first. */
export function hotspotFiles(tree: TreeNode[], count = 6): TreeNode[] {
  return [...leafFiles(tree)]
    .sort((a, b) => a.health_score - b.health_score)
    .slice(0, count)
}

/** How many files sit below the hotspot line. */
export function hotspotCount(tree: TreeNode[]) {
  return leafFiles(tree).filter((file) => file.health_score < HOTSPOT_HEALTH)
    .length
}
