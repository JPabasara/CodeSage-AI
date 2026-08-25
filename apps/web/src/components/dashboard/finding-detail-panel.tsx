"use client";

import { X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { Finding } from "@/lib/types";
import { severityColor } from "@/lib/utils";

/**
 * CR-001 D-CR7: this used to be a `Sheet` that slid over a blurred dashboard.
 * It is now an ordinary card that `DashboardView` swaps into the main region —
 * the component's insides are unchanged, only its container. Triage means
 * reading many findings in a row, and a slide-over made the file tree unusable
 * and cost a close-and-reopen per finding.
 *
 * Still view-only in v1.0: no accept / resolve / false-positive (those are
 * [v1.1]), and the code snippet region is built but not filled.
 */
export type FindingDetailPanelProps = {
  finding: Finding | null;
  /** Leaves detail mode. The container decides what "closed" means (URL, state). */
  onClose: () => void;
};

export function FindingDetailPanel({ finding, onClose }: Readonly<FindingDetailPanelProps>) {
  // No finding selected means the dashboard is not in detail mode at all, so
  // there is nothing to render — the container shows the health cards instead.
  if (!finding) return null;

  return (
    <Card aria-label="Finding detail" className="gap-0">
      <CardHeader className="gap-0">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              style={{ borderColor: severityColor(finding.severity), color: severityColor(finding.severity) }}
            >
              {finding.severity}
            </Badge>
            <Badge variant="secondary">{finding.category}</Badge>
            <Badge variant="secondary">{finding.source}</Badge>
          </div>
          <Button variant="ghost" size="icon" aria-label="Close finding detail" onClick={onClose}>
            <X />
          </Button>
        </div>
        <h2 className="mt-2 font-mono text-sm font-semibold">
          {finding.file}:{finding.line}
        </h2>
        {finding.symbol ? (
          <p className="text-muted-foreground text-sm">{finding.symbol}</p>
        ) : null}
      </CardHeader>

      <CardContent className="space-y-4 pt-4 text-sm">
        <section>
          <h3 className="text-muted-foreground mb-1 text-xs font-medium uppercase">Why this matters</h3>
          <p>{finding.reason}</p>
        </section>

        {finding.metric_value !== undefined && finding.threshold !== undefined ? (
          <section>
            <h3 className="text-muted-foreground mb-1 text-xs font-medium uppercase">Evidence</h3>
            <p>
              Measured <span className="font-semibold">{finding.metric_value}</span> · limit{" "}
              <span className="font-semibold">{finding.threshold}</span>
              {finding.rule_id ? <span className="text-muted-foreground"> · rule {finding.rule_id}</span> : null}
            </p>
          </section>
        ) : null}

        {/* v1.1: the offending code snippet is loaded on demand here. D-CR7 exists
            partly to give it room — the slide-over was too narrow to render it. */}
      </CardContent>
    </Card>
  );
}
