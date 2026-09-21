"use client"

import { X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import type { Finding } from "@/lib/types"
import { severityColor } from "@/lib/utils"

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
    <Card
      aria-label="Finding detail"
      className="gap-0 border-t-2 border-t-primary/60 shadow-sm"
    >
      <CardHeader className="gap-0">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              style={{
                borderColor: severityColor(finding.severity),
                color: severityColor(finding.severity),
              }}
            >
              {finding.severity}
            </Badge>
            <Badge variant="secondary">{finding.category}</Badge>
            <Badge variant="secondary">{finding.source}</Badge>
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
        <h2 className="mt-2 break-all font-mono text-sm font-semibold">
          {finding.file}:{finding.line}
        </h2>
        {finding.symbol ? (
          <p className="text-sm text-muted-foreground">{finding.symbol}</p>
        ) : null}
      </CardHeader>

      <CardContent className="space-y-4 pt-4 text-sm">
        <section>
          <h3 className="mb-1 text-xs font-medium uppercase text-muted-foreground">
            Why this matters
          </h3>
          <p>{finding.reason}</p>
        </section>

        {finding.metric_value !== undefined &&
        finding.threshold !== undefined ? (
          <section>
            <h3 className="mb-1 text-xs font-medium uppercase text-muted-foreground">
              Evidence
            </h3>
            <p>
              Measured{" "}
              <span className="font-semibold">{finding.metric_value}</span>,
              limit <span className="font-semibold">{finding.threshold}</span>
              {finding.rule_id ? (
                <span className="text-muted-foreground">
                  {" "}
                  rule {finding.rule_id}
                </span>
              ) : null}
            </p>
          </section>
        ) : null}
      </CardContent>
    </Card>
  )
}
