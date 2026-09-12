"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import type { Repo } from "@/lib/types"
import { gradeColor } from "@/lib/utils"

export type ProjectListProps = {
  repos: Repo[]
  onSelect?: (repo: Repo) => void
  activeRepoId?: string
}

export function ProjectList({
  repos,
  onSelect,
  activeRepoId,
}: Readonly<ProjectListProps>) {
  if (repos.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No repositories yet — connect one to see its health.
      </p>
    )
  }

  return (
    // Named, because this is not the only list on the page. The toast surface is
    // an <ol> of <li>s too, so "the repository rows" has to be something a
    // reader — human or test — can actually ask for.
    <ul className="space-y-2" aria-label="Connected repositories">
      {repos.map((repo) => (
        <li key={repo.id}>
          <Card
            className={repo.id === activeRepoId ? "border-primary" : undefined}
          >
            <CardContent className="flex items-center justify-between gap-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">
                    {repo.owner}/{repo.name}
                  </span>
                  <Badge variant="secondary">{repo.visibility}</Badge>
                </div>
                {repo.latest_health ? (
                  <p className="text-muted-foreground text-sm">
                    <span
                      style={{ color: gradeColor(repo.latest_health.grade) }}
                    >
                      {repo.latest_health.grade}
                    </span>{" "}
                    · {repo.latest_health.score}/100 ·{" "}
                    {repo.latest_health.delta >= 0
                      ? `+${repo.latest_health.delta}`
                      : repo.latest_health.delta}
                  </p>
                ) : (
                  <p className="text-muted-foreground text-sm">
                    Not scanned yet
                  </p>
                )}
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => onSelect?.(repo)}
              >
                Select
              </Button>
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  )
}
