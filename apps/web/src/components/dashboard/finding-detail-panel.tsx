"use client";

import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { Finding } from "@/lib/types";
import { severityColor } from "@/lib/utils";

export type FindingDetailPanelProps = {
  finding: Finding | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function FindingDetailPanel({
  finding,
  open,
  onOpenChange,
}: Readonly<FindingDetailPanelProps>) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 sm:max-w-md">
        {finding ? (
          <>
            <SheetHeader>
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  style={{ borderColor: severityColor(finding.severity), color: severityColor(finding.severity) }}
                >
                  {finding.severity}
                </Badge>
                <Badge variant="secondary">{finding.category}</Badge>
                <Badge variant="secondary">{finding.source}</Badge>
              </div>
              <SheetTitle className="mt-2 font-mono text-sm">
                {finding.file}:{finding.line}
              </SheetTitle>
              <SheetDescription>{finding.symbol}</SheetDescription>
            </SheetHeader>

            <div className="space-y-4 px-4 pb-4 text-sm">
              <section>
                <h3 className="text-muted-foreground mb-1 text-xs font-medium uppercase">Why this matters</h3>
                <p>{finding.reason}</p>
              </section>

              {finding.metricValue !== undefined && finding.threshold !== undefined ? (
                <section>
                  <h3 className="text-muted-foreground mb-1 text-xs font-medium uppercase">Evidence</h3>
                  <p>
                    Measured <span className="font-semibold">{finding.metricValue}</span> · limit{" "}
                    <span className="font-semibold">{finding.threshold}</span>
                    {finding.ruleId ? <span className="text-muted-foreground"> · rule {finding.ruleId}</span> : null}
                  </p>
                </section>
              ) : null}

              {/* v1.1: the offending code snippet is loaded on demand here. */}
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
