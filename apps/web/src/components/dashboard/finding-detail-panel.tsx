"use client"

import { X } from "lucide-react"

import {
  CategoryTag,
  SeverityTag,
  SourceTag,
} from "@/components/dashboard/finding-tag"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import type { Finding } from "@/lib/types"

export type FindingDetailPanelProps = {
  finding: Finding | null
  onClose: () => void
}

export function FindingDetailPanel({
  finding,
  onClose,
}: Readonly<FindingDetailPanelProps>) {
  if (!finding) return null

  return (
    <Card aria-label="Finding detail" className="shrink-0 gap-0 border ring-0">
      <CardHeader className="gap-0">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <SeverityTag severity={finding.severity} />
            <CategoryTag category={finding.category} />
            {finding.source ? <SourceTag source={finding.source} /> : null}
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

      <CardContent className="space-y-4 pt-4 text-sm">
        <section>
          <h3 className="mb-1 text-xs font-medium text-muted-foreground">
            Why this matters
          </h3>
          <p>{finding.reason}</p>
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
      </CardContent>
    </Card>
  )
}
