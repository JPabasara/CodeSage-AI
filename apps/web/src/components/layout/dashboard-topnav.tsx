"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScanControl, type ScanControlProps } from "@/components/layout/scan-control";
import type { Branch } from "@/lib/types";
import { shortSha } from "@/lib/utils";

export type DashboardTopNavProps = {
  repoName: string;
  branches: Branch[];
  activeBranch: string;
  onBranchChange: (branch: string) => void;
  lastCommitSha: string;
  scannedAt: string;
  scan: ScanControlProps;
};

export function DashboardTopNav({
  repoName,
  branches,
  activeBranch,
  onBranchChange,
  lastCommitSha,
  scannedAt,
  scan,
}: Readonly<DashboardTopNavProps>) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="font-semibold">{repoName}</span>
        <Select value={activeBranch} onValueChange={onBranchChange}>
          <SelectTrigger className="w-40" aria-label="Branch">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {branches.map((b) => (
              <SelectItem key={b.name} value={b.name}>
                {b.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <ScanControl {...scan} />
      </div>

      <div className="text-muted-foreground text-right text-xs">
        <div>Last analyzed {new Date(scannedAt).toLocaleString()}</div>
        <div className="font-mono">#{shortSha(lastCommitSha)}</div>
      </div>
    </div>
  );
}
