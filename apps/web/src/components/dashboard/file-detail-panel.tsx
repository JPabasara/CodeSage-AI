"use client"

import { FileCode2 } from "lucide-react"

import { GradeBadge } from "@/components/dashboard/kpi-card"
import { byPriority } from "@/lib/dashboard-summary"
import type { Finding, TreeNode } from "@/lib/types"
import { gradeColor, severityColor } from "@/lib/utils"

/** One file from the code map: how healthy it is, and what is wrong in it. */
export function FileDetailPanel({
  node,
  findings,
  onOpenFinding,
}: Readonly<{
  node: TreeNode | null
  findings: Finding[]
  onOpenFinding: (finding: Finding) => void
}>) {
  if (!node || node.type !== "file") {
    return (
      <section
        aria-label="File detail"
        className="flex h-full min-h-64 flex-col items-center justify-center gap-2 rounded-md border bg-card p-6 text-center"
      >
        <FileCode2
          className="size-6 text-muted-foreground"
          aria-hidden="true"
        />
        <p className="text-sm font-medium text-foreground-strong">
          Select a file
        </p>
        <p className="max-w-xs text-xs text-muted-foreground">
          Choose a file in the code map to see its health and the findings in
          it.
        </p>
      </section>
    )
  }

  const inFile = findings
    .filter((finding) => finding.file === node.path)
    .sort(byPriority)
  const folder = node.path.slice(0, -node.name.length - 1)
  const risk = node.risk_score

  return (
    <section
      aria-label="File detail"
      className="min-w-0 rounded-md border bg-card"
    >
      <header className="flex items-start justify-between gap-3 border-b px-4.5 py-4">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-foreground-strong">
            {node.name}
          </h2>
          <p className="truncate font-mono text-xs text-muted-foreground">
            {folder || "/"}
          </p>
        </div>
        <GradeBadge grade={node.grade} color={gradeColor(node.grade)} />
      </header>
      <dl className="grid grid-cols-3 gap-3 border-b px-4.5 py-4">
        <div>
          <dt className="text-xs text-muted-foreground">Health</dt>
          <dd className="text-xl font-semibold text-foreground-strong tabular-nums">
            {Math.round(node.health_score)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Bug risk</dt>
          <dd className="text-xl font-semibold text-foreground-strong tabular-nums">
            {risk === null || risk === undefined ? "—" : risk.toFixed(2)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Findings</dt>
          <dd className="text-xl font-semibold text-foreground-strong tabular-nums">
            {inFile.length}
          </dd>
        </div>
      </dl>
      {inFile.length === 0 ? (
        <p className="px-4.5 py-5 text-sm text-muted-foreground">
          No findings in this file in this snapshot.
        </p>
      ) : (
        <ul
          className="max-h-[28rem] overflow-y-auto p-2"
          aria-label="Findings in this file"
        >
          {inFile.map((finding) => (
            <li key={finding.fingerprint}>
              <button
                type="button"
                onClick={() => onOpenFinding(finding)}
                className="flex w-full items-start gap-3 rounded-md px-2.5 py-2 text-left outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span
                  aria-hidden="true"
                  className="mt-1.5 size-2 shrink-0 rounded-[2px]"
                  style={{ backgroundColor: severityColor(finding.severity) }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-foreground-strong">
                    {finding.reason}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    <span className="capitalize">{finding.severity}</span> ·
                    line <span className="tabular-nums">{finding.line}</span>
                    {finding.status === "done" ? " · done" : ""}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
