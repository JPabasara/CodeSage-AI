"use client"

import Link from "next/link"
import {
  Activity,
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  GitBranch,
  History,
  LayoutDashboard,
  LockKeyhole,
  UnlockKeyhole,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import type { Repo } from "@/lib/types"
import { cn, gradeColor } from "@/lib/utils"

export type ProjectListProps = {
  repos: Repo[]
  onSelect?: (repo: Repo) => void
  onHistory?: (repo: Repo) => void
  activeRepoId?: string
}

export function ProjectList({
  repos,
  onSelect,
  onHistory,
  activeRepoId,
}: Readonly<ProjectListProps>) {
  if (repos.length === 0) {
    return (
      <div className="rounded-lg border border-dashed bg-card/70 p-8 text-center">
        <p className="text-sm font-medium">No repositories connected</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
          Connect a public repository to start building a project health
          history.
        </p>
      </div>
    )
  }

  return (
    // Named, because this is not the only list on the page. The toast surface is
    // an <ol> of <li>s too, so "the repository rows" has to be something a
    // reader, human or test, can actually ask for.
    <ul className="grid gap-3" aria-label="Connected repositories">
      {repos.map((repo) => {
        const isActive = repo.id === activeRepoId
        const HealthIcon = repo.latest_health ? Activity : GitBranch
        const VisibilityIcon =
          repo.visibility === "private" ? LockKeyhole : UnlockKeyhole
        const connectedAt = new Intl.DateTimeFormat("en", {
          month: "short",
          day: "numeric",
          year: "numeric",
        }).format(new Date(repo.connected_at))
        const repoLabel = `${repo.owner}/${repo.name}`

        return (
          <li key={repo.id} aria-current={isActive ? "true" : undefined}>
            <Card
              className={cn(
                "overflow-hidden border bg-card shadow-sm transition hover:border-primary/45 hover:shadow-md",
                isActive &&
                  "border-primary bg-accent/20 ring-1 ring-primary/20",
              )}
            >
              <CardContent className="p-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="grid size-9 shrink-0 place-items-center rounded-md border bg-background text-primary">
                        <GitBranch className="size-4" aria-hidden="true" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-base font-semibold leading-5">
                          {repo.name}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {repo.owner}
                        </p>
                      </div>
                      <Badge variant="secondary" className="gap-1">
                        <VisibilityIcon className="size-3" aria-hidden="true" />
                        {repo.visibility}
                      </Badge>
                      {isActive ? <Badge>Active</Badge> : null}
                    </div>

                    <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                      <span className="inline-flex min-w-0 items-center gap-1.5 rounded-md border bg-background px-2 py-1">
                        <HealthIcon
                          className="size-3.5 shrink-0"
                          aria-hidden="true"
                        />
                        {repo.latest_health ? (
                          <span className="min-w-0 truncate">
                            Latest health{" "}
                            <strong
                              className="font-semibold"
                              style={{
                                color: gradeColor(repo.latest_health.grade),
                              }}
                            >
                              {repo.latest_health.grade}
                            </strong>{" "}
                            {repo.latest_health.score}/100{" "}
                            <span className="tabular-nums">
                              {repo.latest_health.delta >= 0
                                ? `+${repo.latest_health.delta}`
                                : repo.latest_health.delta}
                            </span>
                          </span>
                        ) : (
                          <span>Not scanned yet</span>
                        )}
                      </span>
                      <span className="inline-flex min-w-0 items-center gap-1.5 rounded-md border bg-background px-2 py-1">
                        <CalendarClock
                          className="size-3.5 shrink-0"
                          aria-hidden="true"
                        />
                        <span className="truncate">
                          Connected {connectedAt}
                        </span>
                      </span>
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="lg"
                      variant={isActive ? "secondary" : "outline"}
                      disabled={isActive}
                      aria-label={`${isActive ? "Selected" : "Select"} ${repoLabel}`}
                      onClick={() => onSelect?.(repo)}
                    >
                      <CheckCircle2 className="size-4" />
                      {isActive ? "Selected" : "Select"}
                    </Button>
                    <Button asChild size="lg">
                      <Link
                        href={`/dashboard/${repo.id}`}
                        aria-label={`Go to dashboard for ${repoLabel}`}
                        onClick={() => onSelect?.(repo)}
                      >
                        <LayoutDashboard className="size-4" />
                        Go to Dashboard
                      </Link>
                    </Button>
                    <Button asChild size="lg" variant="secondary">
                      <Link
                        href={`/dashboard/${repo.id}/history`}
                        aria-label={`Open scan history for ${repoLabel}`}
                        onClick={() => (onHistory ?? onSelect)?.(repo)}
                      >
                        <History className="size-4" />
                        History
                      </Link>
                    </Button>
                    <Button asChild size="icon-lg" variant="outline">
                      <a
                        href={repo.url}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Open ${repoLabel} repository`}
                        title={`Open ${repoLabel} repository`}
                      >
                        <ExternalLink className="size-4" />
                      </a>
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </li>
        )
      })}
    </ul>
  )
}
