"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { Repo } from "@/lib/types";
import { gradeColor } from "@/lib/utils";

export type ProjectListProps = {
  repos: Repo[];
  onSelect?: (repo: Repo) => void;
  activeRepoId?: string;
};

export function ProjectList({ repos, onSelect, activeRepoId }: Readonly<ProjectListProps>) {
  if (repos.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No repositories yet — connect one to see its health.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {repos.map((repo) => (
        <li key={repo.id}>
          <Card className={repo.id === activeRepoId ? "border-primary" : undefined}>
            <CardContent className="flex items-center justify-between gap-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">
                    {repo.owner}/{repo.name}
                  </span>
                  <Badge variant="secondary">{repo.visibility}</Badge>
                </div>
                {repo.latestHealth ? (
                  <p className="text-muted-foreground text-sm">
                    <span style={{ color: gradeColor(repo.latestHealth.grade) }}>
                      {repo.latestHealth.grade}
                    </span>{" "}
                    · {repo.latestHealth.score}/100 ·{" "}
                    {repo.latestHealth.delta >= 0
                      ? `+${repo.latestHealth.delta}`
                      : repo.latestHealth.delta}
                  </p>
                ) : (
                  <p className="text-muted-foreground text-sm">Not scanned yet</p>
                )}
              </div>
              <Button size="sm" variant="secondary" onClick={() => onSelect?.(repo)}>
                Select
              </Button>
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}
