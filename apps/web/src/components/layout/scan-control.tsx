"use client";

import { Play, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { ScanPhase } from "@/lib/types";

export type ScanControlProps = {
  phase: ScanPhase;
  progress: number; // 0–100
  onScan?: () => void;
  onStop?: () => void;
};

export function ScanControl({ phase, progress, onScan, onStop }: Readonly<ScanControlProps>) {
  const running = phase === "running" || phase === "queued";

  if (running) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm tabular-nums">Scanning… {progress}%</span>
        <Progress value={progress} className="w-24" />
        <Button size="sm" variant="outline" onClick={onStop}>
          <Square className="size-3.5" /> Stop
        </Button>
      </div>
    );
  }

  return (
    <Button size="sm" onClick={onScan}>
      <Play className="size-3.5" /> Scan
    </Button>
  );
}
