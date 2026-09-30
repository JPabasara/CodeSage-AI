"use client"

import { LearnMore } from "@/components/support/learn-more"

import { CheckCircle2, Loader2, RotateCcw, X } from "lucide-react"

import {
  CategoryTag,
  SeverityTag,
  SourceTag,
} from "@/components/dashboard/finding-tag"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import type { Finding, FindingStatus } from "@/lib/types"

export type FindingDetailPanelProps = {
  finding: Finding | null
  hasFindings?: boolean
  onClose: () => void
  canTriage?: boolean
  statusBusy?: boolean
  onStatusChange?: (finding: Finding, status: FindingStatus) => void
}

export function FindingDetailPanel({
  finding,
  hasFindings = false,
  onClose,
  canTriage = false,
  statusBusy = false,
  onStatusChange,
}: Readonly<FindingDetailPanelProps>) {
  if (!finding) {
    return (
      <Card
        aria-label="Finding detail"
        className="h-full min-h-0 gap-0 border ring-0"
      >
        <CardHeader className="flex-row items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">
              {hasFindings ? "Select a finding" : "No findings to show"}
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {hasFindings
                ? "Choose a finding from the list to open its details here."
                : "There are no findings in this snapshot. Try another scan or choose a different branch."}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close finding detail"
            onClick={onClose}
          >
            <X />
          </Button>
        </CardHeader>
      </Card>
    )
  }

  return (
    <Card
      aria-label="Finding detail"
      className="h-full min-h-0 gap-0 border ring-0"
    >
      <CardHeader className="gap-0">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <SeverityTag severity={finding.severity} />
            <CategoryTag category={finding.category} />
            {finding.source ? <SourceTag source={finding.source} /> : null}
            <Badge variant="outline">
              {finding.status === "done" ? "Done" : "Open"}
            </Badge>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close finding detail"
            onClick={onClose}
          >
            <X />
          </Button>
        </div>
        <h2 className="mt-2 font-mono text-sm font-semibold break-all tabular-nums">
          {finding.file}:{finding.line}
        </h2>
        {finding.symbol ? (
          <p className="text-sm text-muted-foreground">{finding.symbol}</p>
        ) : null}
      </CardHeader>

      <CardContent className="min-h-0 flex-1 space-y-4 overflow-y-auto pt-4 text-sm">
        <section>
          <h3 className="mb-1 text-xs font-medium text-muted-foreground">
            Why this matters
          </h3>
          <p>{finding.reason}</p>
          <LearnMore
            article={
              finding.source === "satd" ? "satd-detection" : "debt-detection"
            }
            about="how this finding was detected"
          />
        </section>

        {finding.metric_value !== undefined &&
        finding.metric_value !== null &&
        finding.threshold !== undefined &&
        finding.threshold !== null ? (
          <section>
            <h3 className="mb-1 text-xs font-medium text-muted-foreground">
              Evidence
            </h3>
            <p>
              Measured{" "}
              <span className="font-semibold tabular-nums">
                {finding.metric_value}
              </span>
              , limit{" "}
              <span className="font-semibold tabular-nums">
                {finding.threshold}
              </span>
              {finding.rule_id ? (
                <span className="text-muted-foreground">
                  {" "}
                  · rule {finding.rule_id}
                </span>
              ) : null}
            </p>
          </section>
        ) : null}

        {canTriage ? (
          <div className="border-t pt-4">
            <Button
              type="button"
              variant={finding.status === "done" ? "outline" : "default"}
              size="sm"
              disabled={statusBusy}
              onClick={() =>
                onStatusChange?.(
                  finding,
                  finding.status === "done" ? "open" : "done",
                )
              }
            >
              {statusBusy ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : finding.status === "done" ? (
                <RotateCcw aria-hidden="true" />
              ) : (
                <CheckCircle2 aria-hidden="true" />
              )}
              {finding.status === "done" ? "Reopen" : "Mark as done"}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
