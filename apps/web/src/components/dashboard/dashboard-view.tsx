"use client";

import { useState } from "react";

import { DashboardTopNav } from "@/components/layout/dashboard-topnav";
import { OverallHealthCard } from "@/components/dashboard/overall-health-card";
import { HealthGraphCard } from "@/components/dashboard/health-graph-card";
import { RefactorFirstList } from "@/components/dashboard/refactor-first-list";
import { FindingDetailPanel } from "@/components/dashboard/finding-detail-panel";
import { FileTree } from "@/components/dashboard/file-tree/file-tree";
import { mockBranches, mockHealthReport } from "@/lib/mocks/fixtures";
import type { Finding, TreeNode } from "@/lib/types";
import { healthColor } from "@/lib/utils";

export function DashboardView({ repoId }: Readonly<{ repoId: string }>) {
  // Phase 8 swaps this static import for useHealthReport(repoId, branch).
  const report = mockHealthReport;

  const [activeBranch, setActiveBranch] = useState(report.branch);
  const [selectedFinding, setSelectedFinding] = useState<Finding | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  // hovered node is captured now; Card B re-scopes to it later (v2). Only the setter is needed today.
  const [, setHoveredNode] = useState<TreeNode | null>(null);

  const openFinding = (finding: Finding) => {
    setSelectedFinding(finding);
    setDetailOpen(true);
  };

  return (
    <div className="flex h-full flex-col">
      <DashboardTopNav
        repoName={repoId}
        branches={mockBranches}
        activeBranch={activeBranch}
        onBranchChange={setActiveBranch}
        lastCommitSha={report.commitSha}
        scannedAt={report.scannedAt}
        scan={{ phase: "idle", progress: 0 }}
      />

      <div className="grid flex-1 gap-4 p-4 lg:grid-cols-2">
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <OverallHealthCard
              score={report.healthScore}
              grade={report.grade}
              delta={report.delta}
              redIssueCount={report.redIssueCount}
              categoryBreakdown={report.categoryBreakdown}
            />
            <HealthGraphCard history={report.history} />
          </div>
          <RefactorFirstList
            findings={report.findings}
            onSelect={openFinding}
            selectedFingerprint={selectedFinding?.fingerprint}
          />
        </div>

        <div className="rounded-lg border p-2">
          <FileTree
            nodes={report.tree}
            colorFor={(node) => healthColor(node.healthScore)}
            onHoverNode={setHoveredNode}
            onSelectNode={(node) => {
              const match = report.findings.find((f) => f.file === node.path);
              if (match) openFinding(match);
            }}
          />
        </div>
      </div>

      <FindingDetailPanel finding={selectedFinding} open={detailOpen} onOpenChange={setDetailOpen} />
    </div>
  );
}
