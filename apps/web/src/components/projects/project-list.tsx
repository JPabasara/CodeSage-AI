"use client"

import Link from "next/link"
import {
  CheckCircle2,
  ExternalLink,
  FolderGit2,
  GitBranch,
  History,
  LayoutDashboard,
  LockKeyhole,
  UnlockKeyhole,
} from "lucide-react"

import { EmptyState } from "@/components/empty-state"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import type { LatestHealth, Repo } from "@/lib/types"
import { cn, gradeColor } from "@/lib/utils"

export type ProjectListProps = {
  repos: Repo[]
  onSelect?: (repo: Repo) => void
  onHistory?: (repo: Repo) => void
  onRemove?: (repo: Repo) => void
  removingRepoId?: string
  activeRepoId?: string
  /** What the empty list says under its title; the page names the workspace. */
  emptyDescription?: React.ReactNode
}

/*
 * One grid template for the header and every row, so the columns line up.
 * Container queries rather than viewport ones: the app rail takes a variable
 * share of the viewport, and what matters is the width this list actually has.
 * Under @4xl the row stacks: repository, then health and date, then actions.
 * The actions column has a fixed width, not `auto`: each row is its own grid,
 * so `auto` sized the header's empty cell and every row's buttons differently
 * and the health and date columns drifted out from under their headings.
 */
const COLUMNS =
  "@4xl:grid-cols-[minmax(0,1fr)_8.5rem_7rem_25rem] @4xl:items-center @4xl:gap-x-4"

const shortDate = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  year: "numeric",
})

const fullDate = new Intl.DateTimeFormat("en", {
  dateStyle: "full",
  timeStyle: "short",
})

/** "+3", "−2" (a real minus sign), "±0" — rounded, like every other screen. */
function formatDelta(value: number) {
  const delta = Math.round(value)
  if (delta === 0) return "±0"
  return delta > 0 ? `+${delta}` : `−${Math.abs(delta)}`
}

function HealthCell({ health }: Readonly<{ health?: LatestHealth | null }>) {
  if (!health) {
    return <span className="text-muted-foreground">Not scanned yet</span>
  }
  return (
    <span className="inline-flex items-baseline gap-2 tabular-nums">
      {/* The same colour rule as the dashboard and history, from one helper. */}
      <span
        className="font-semibold"
        style={{ color: gradeColor(health.grade) }}
      >
        {health.grade}
      </span>
      <span>
        {Math.round(health.score)}
        <span className="text-muted-foreground">/100</span>
      </span>
      <span
        className="text-xs text-muted-foreground"
        title="Change since the previous scan"
      >
        {formatDelta(health.delta)}
      </span>
    </span>
  )
}

export function ProjectList({
  repos,
  onSelect,
  onHistory,
  onRemove,
  removingRepoId,
  activeRepoId,
  emptyDescription = "Connect a public repository to start building a project health history.",
}: Readonly<ProjectListProps>) {
  if (repos.length === 0) {
    return (
      <EmptyState
        icon={<FolderGit2 />}
        title="No repositories connected"
        description={emptyDescription}
      />
    )
  }

  return (
    <div className="@container overflow-hidden rounded-lg border bg-card">
      {/* Visual column labels only. Each cell carries its own label for
          assistive technology, which also serves the stacked layout. */}
      <div
        aria-hidden="true"
        className={cn(
          "hidden border-b bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground @4xl:grid",
          COLUMNS,
        )}
      >
        <span>Repository</span>
        <span>Latest health</span>
        <span>Connected</span>
        <span />
      </div>

      {/* Named, because this is not the only list on the page. The toast
          surface is an <ol> of <li>s too, so "the repository rows" has to be
          something a reader, human or test, can actually ask for. */}
      <ul className="divide-y" aria-label="Connected repositories">
        {repos.map((repo) => {
          const isActive = repo.id === activeRepoId
          const VisibilityIcon =
            repo.visibility === "private" ? LockKeyhole : UnlockKeyhole
          const connected = new Date(repo.connected_at)
          const repoLabel = `${repo.owner}/${repo.name}`

          return (
            <li
              key={repo.id}
              aria-current={isActive ? "true" : undefined}
              className={cn(
                "relative grid gap-3 px-4 py-3 text-sm transition-colors",
                COLUMNS,
                isActive &&
                  "bg-accent/50 before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-primary",
              )}
            >
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <p className="min-w-0 truncate font-semibold">{repo.name}</p>
                  <Badge variant="outline" className="gap-1 rounded-sm">
                    <VisibilityIcon aria-hidden="true" />
                    {repo.visibility}
                  </Badge>
                  {isActive ? (
                    <Badge className="rounded-sm">Active</Badge>
                  ) : null}
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {repo.owner}
                </p>
              </div>

              <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 @4xl:contents">
                <div className="flex items-baseline gap-2">
                  <span className="text-xs text-muted-foreground @4xl:sr-only">
                    Latest health
                  </span>
                  {/* The hint is always the default branch's latest scan, so
                      it says which branch that is. */}
                  <span className="flex flex-col gap-0.5">
                    <HealthCell health={repo.latest_health} />
                    <span
                      className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground"
                      data-testid="project-health-branch"
                    >
                      <GitBranch className="size-3" aria-hidden="true" />
                      <span className="sr-only">on branch </span>
                      {repo.default_branch}
                    </span>
                  </span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-xs text-muted-foreground @4xl:sr-only">
                    Connected
                  </span>
                  <time
                    dateTime={repo.connected_at}
                    title={fullDate.format(connected)}
                    className="text-muted-foreground tabular-nums"
                  >
                    {shortDate.format(connected)}
                  </time>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 @4xl:flex-nowrap @4xl:justify-end">
                <Button
                  type="button"
                  variant={isActive ? "secondary" : "outline"}
                  disabled={isActive}
                  aria-label={`${isActive ? "Selected" : "Select"} ${repoLabel}`}
                  onClick={() => onSelect?.(repo)}
                >
                  {isActive ? <CheckCircle2 aria-hidden="true" /> : null}
                  {isActive ? "Selected" : "Select"}
                </Button>
                <Button asChild>
                  <Link
                    href={`/dashboard/${repo.id}`}
                    aria-label={`Go to dashboard for ${repoLabel}`}
                    onClick={() => onSelect?.(repo)}
                  >
                    <LayoutDashboard aria-hidden="true" />
                    Go to dashboard
                  </Link>
                </Button>
                <Button asChild variant="outline">
                  <Link
                    href={`/dashboard/${repo.id}/history`}
                    aria-label={`Open scan history for ${repoLabel}`}
                    onClick={() => (onHistory ?? onSelect)?.(repo)}
                  >
                    <History aria-hidden="true" />
                    History
                  </Link>
                </Button>
                <Button asChild size="icon" variant="ghost">
                  <a
                    href={repo.url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Open ${repoLabel} repository`}
                    title={`Open ${repoLabel} repository`}
                  >
                    <ExternalLink aria-hidden="true" />
                  </a>
                </Button>
                {/* Omitted, not disabled, for a role without
                    repository:disconnect: a control that exists only to be
                    refused teaches nothing. The API re-checks regardless. */}
                {onRemove ? (
                  <Button
                    type="button"
                    variant="destructive"
                    aria-label={`Delete ${repoLabel} repository`}
                    disabled={removingRepoId === repo.id}
                    onClick={() => onRemove(repo)}
                  >
                    Delete
                  </Button>
                ) : null}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** Same frame, header and row height as the list, so nothing jumps on load. */
export function ProjectListSkeleton({
  rows = 3,
  ...props
}: Readonly<{ rows?: number } & React.ComponentProps<"div">>) {
  return (
    <div
      className="@container overflow-hidden rounded-lg border bg-card"
      {...props}
    >
      <div
        className={cn(
          "hidden border-b bg-muted/40 px-4 py-2 @4xl:grid",
          COLUMNS,
        )}
      >
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-16" />
        <span />
      </div>
      <div className="divide-y">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className={cn("grid gap-3 px-4 py-3", COLUMNS)}>
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-20" />
            </div>
            <div className="flex gap-6 @4xl:contents">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-24" />
            </div>
            <Skeleton className="h-7 w-full max-w-sm @4xl:w-96" />
          </div>
        ))}
      </div>
    </div>
  )
}
