"use client"

import Link from "next/link"
import {
  ExternalLink,
  FolderGit2,
  GitBranch,
  History,
  LayoutDashboard,
  Loader2,
  LockKeyhole,
  MoreHorizontal,
  Play,
  Trash2,
  UnlockKeyhole,
} from "lucide-react"

import { DeltaText, GradeBadge } from "@/components/dashboard/kpi-card"
import { EmptyState } from "@/components/empty-state"
import { useRunningScan } from "@/components/layout/running-scan"
import { LockedAction } from "@/components/locked-action"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import type { ActiveScan, LatestHealth, Repo } from "@/lib/types"
import { cn, gradeColor } from "@/lib/utils"

export type ProjectListProps = {
  repos: Repo[]
  /** A link to the dashboard or history is followed; the link itself navigates. */
  onSelect?: (repo: Repo) => void
  /** The row itself is clicked: select it and open its dashboard. */
  onOpen?: (repo: Repo) => void
  onHistory?: (repo: Repo) => void
  /** Starts the first scan of a repository that has none; without it the row offers its dashboard. */
  onFirstScan?: (repo: Repo) => void
  /** Why this role cannot start a scan; Run first scan is then shown locked. */
  scanLockedReason?: string
  onRemove?: (repo: Repo) => void
  /** Why this role cannot remove a repository; the ⋯ menu is then shown locked. */
  removeLockedReason?: string
  /** The pointer or focus rests on a way to the dashboard; `undefined` when it leaves. */
  onIntent?: (repo: Repo | undefined) => void
  removingRepoId?: string
  activeRepoId?: string
  /** Scans running in the workspace, so a row started elsewhere shows it too. */
  activity?: ActiveScan[]
  /** What the empty list says under its title; the page names the workspace. */
  emptyDescription?: React.ReactNode
}

const COLUMNS =
  "@5xl:grid-cols-[minmax(0,1fr)_10rem_8rem_7.5rem_20rem] @5xl:items-center @5xl:gap-x-4"

const shortDate = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  year: "numeric",
})

const fullDate = new Intl.DateTimeFormat("en", {
  dateStyle: "full",
  timeStyle: "short",
})

function HealthCell({ health }: Readonly<{ health?: LatestHealth | null }>) {
  if (!health) {
    return <span className="text-muted-foreground">Not scanned yet</span>
  }
  return (
    <span className="inline-flex items-center gap-2 tabular-nums">
      {/* The same colour rule as the dashboard and history, from one helper. */}
      <GradeBadge
        grade={health.grade}
        color={gradeColor(health.grade)}
        size="sm"
      />
      <span>
        <span className="font-semibold text-foreground-strong">
          {Math.round(health.score)}
        </span>
        <span className="text-muted-foreground">/100</span>
      </span>
      <span className="text-xs" title="Change since the previous scan">
        <DeltaText value={health.delta} />
      </span>
    </span>
  )
}

/**
 * The row's main action: while its scan is queued, running or stopping, a way to
 * watch it; otherwise what the row offers (Run first scan or Open dashboard).
 */
function ScanAwareAction({
  repo,
  repoLabel,
  activity,
  onSelect,
  children,
}: Readonly<{
  repo: Repo
  repoLabel: string
  activity: ActiveScan[] | undefined
  onSelect?: (repo: Repo) => void
  children: React.ReactNode
}>) {
  const running = useRunningScan(repo, activity)
  if (!running) return <>{children}</>
  const percent =
    running.bar === undefined ? undefined : Math.floor(running.bar)
  return (
    <Button
      asChild
      variant="outline"
      size="sm"
      className={cn(
        "h-8 gap-1.5 px-3 tabular-nums",
        running.label === "Stopping" &&
          "border-destructive/40 text-destructive",
      )}
    >
      <Link
        href={`/dashboard/${repo.id}`}
        aria-label={`${running.label} ${repoLabel}: view progress`}
        onClick={() => onSelect?.(repo)}
      >
        <Loader2 className="motion-safe:animate-spin" aria-hidden="true" />
        {running.label}
        {percent !== undefined ? ` ${percent}%` : "…"}
      </Link>
    </Button>
  )
}

/** A small label for a cell, shown only while the list is stacked. */
function CellLabel({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <span className="text-xs text-muted-foreground @5xl:sr-only">
      {children}
    </span>
  )
}

function MoreActions({
  repo,
  repoLabel,
  onRemove,
  lockedReason,
  removing,
}: Readonly<{
  repo: Repo
  repoLabel: string
  onRemove?: (repo: Repo) => void
  lockedReason?: string
  removing: boolean
}>) {
  const label = `More actions for ${repoLabel}`
  if (!onRemove) {
    if (!lockedReason) return null
    return (
      <LockedAction reason={lockedReason}>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label={label}
          disabled
        >
          <MoreHorizontal />
        </Button>
      </LockedAction>
    )
  }
  return (
    // Not modal, so the remove dialog it opens can take the focus.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label={label}
          title="More actions"
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-48">
        <DropdownMenuItem
          variant="destructive"
          className="text-sm"
          disabled={removing}
          onSelect={() => onRemove(repo)}
        >
          <Trash2 aria-hidden="true" />
          Remove repository…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function ProjectList({
  repos,
  onSelect,
  onOpen,
  onHistory,
  onFirstScan,
  scanLockedReason,
  onRemove,
  removeLockedReason,
  onIntent,
  removingRepoId,
  activeRepoId,
  activity,
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
    <div className="@container overflow-hidden rounded-md border bg-card">
      <div
        aria-hidden="true"
        className={cn(
          "hidden border-b bg-muted/50 px-4 py-2.5 text-xs font-medium text-muted-foreground @5xl:grid",
          COLUMNS,
        )}
      >
        <span>Repository</span>
        <span>Latest health</span>
        <span>Default branch</span>
        <span>Connected</span>
        <span />
      </div>

      {/* Named, because this is not the only list on the page. */}
      <ul className="divide-y" aria-label="Connected repositories">
        {repos.map((repo) => {
          const isActive = repo.id === activeRepoId
          const VisibilityIcon =
            repo.visibility === "private" ? LockKeyhole : UnlockKeyhole
          const connected = new Date(repo.connected_at)
          const repoLabel = `${repo.owner}/${repo.name}`
          const dashboardHref = `/dashboard/${repo.id}`
          const intent = {
            onFocus: () => onIntent?.(repo),
            onBlur: () => onIntent?.(undefined),
          }

          const firstScan =
            !repo.latest_health && onFirstScan ? (
              <Button
                type="button"
                size="sm"
                className="h-8 gap-1.5 px-3"
                aria-label={`Run first scan of ${repoLabel}`}
                disabled={Boolean(scanLockedReason)}
                onClick={() => onFirstScan(repo)}
              >
                <Play aria-hidden="true" />
                Run first scan
              </Button>
            ) : null

          return (
            <li
              key={repo.id}
              aria-current={isActive ? "true" : undefined}
              className={cn(
                "relative grid cursor-pointer gap-3 px-4 py-3 text-sm transition-colors hover:bg-muted/50",
                COLUMNS,
                isActive &&
                  "before:absolute before:inset-y-0 before:left-0 before:w-0.75 before:bg-primary",
              )}
              // The whole row opens the dashboard; the links and buttons inside keep their own jobs.
              onClick={() => onOpen?.(repo)}
              onPointerEnter={() => onIntent?.(repo)}
              onPointerLeave={() => onIntent?.(undefined)}
            >
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <Link
                    href={dashboardHref}
                    aria-label={`Go to dashboard for ${repoLabel}`}
                    className="min-w-0 truncate rounded-sm font-semibold text-foreground-strong outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={(event) => {
                      event.stopPropagation()
                      onSelect?.(repo)
                    }}
                    {...intent}
                  >
                    {repo.name}
                  </Link>
                  {isActive ? (
                    <span className="inline-flex h-5 shrink-0 items-center rounded-sm bg-accent px-1.5 text-xs font-medium text-accent-foreground">
                      Current
                    </span>
                  ) : null}
                </div>
                <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="truncate">{repo.owner}</span>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex shrink-0 items-center gap-1">
                    <VisibilityIcon className="size-3" aria-hidden="true" />
                    <span>{repo.visibility}</span>
                  </span>
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-x-6 gap-y-1 @5xl:contents">
                <div className="flex items-center gap-2">
                  <CellLabel>Latest health</CellLabel>
                  <HealthCell health={repo.latest_health} />
                </div>
                <div className="flex items-center gap-2">
                  <CellLabel>Default branch</CellLabel>
                  <span
                    className="inline-flex min-w-0 items-center gap-1 font-mono text-xs text-foreground"
                    data-testid="project-health-branch"
                  >
                    <GitBranch
                      className="size-3 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <span className="truncate">{repo.default_branch}</span>
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <CellLabel>Connected</CellLabel>
                  <time
                    dateTime={repo.connected_at}
                    title={fullDate.format(connected)}
                    className="text-muted-foreground tabular-nums"
                  >
                    {shortDate.format(connected)}
                  </time>
                </div>
              </div>

              {/* Clicks in here are the buttons' own, not the row's. */}
              <div
                className="relative flex flex-wrap items-center gap-1.5 @5xl:flex-nowrap @5xl:justify-end"
                onClick={(event) => event.stopPropagation()}
              >
                <ScanAwareAction
                  repo={repo}
                  repoLabel={repoLabel}
                  activity={activity}
                  onSelect={onSelect}
                >
                  {firstScan ? (
                    scanLockedReason ? (
                      <LockedAction reason={scanLockedReason}>
                        {firstScan}
                      </LockedAction>
                    ) : (
                      firstScan
                    )
                  ) : (
                    <Button
                      asChild
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1.5 px-3"
                    >
                      <Link
                        href={dashboardHref}
                        aria-label={`Open dashboard for ${repoLabel}`}
                        onClick={() => onSelect?.(repo)}
                        {...intent}
                      >
                        <LayoutDashboard aria-hidden="true" />
                        Open dashboard
                      </Link>
                    </Button>
                  )}
                </ScanAwareAction>
                <Button
                  asChild
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 px-3"
                >
                  <Link
                    href={`/dashboard/${repo.id}/history`}
                    aria-label={`Open scan history for ${repoLabel}`}
                    onClick={() => (onHistory ?? onSelect)?.(repo)}
                  >
                    <History aria-hidden="true" />
                    History
                  </Link>
                </Button>
                <Button asChild variant="ghost" size="icon" className="size-8">
                  <a
                    href={repo.url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Open ${repoLabel} on GitHub`}
                    title="Open on GitHub"
                  >
                    <ExternalLink aria-hidden="true" />
                  </a>
                </Button>
                <MoreActions
                  repo={repo}
                  repoLabel={repoLabel}
                  onRemove={onRemove}
                  lockedReason={removeLockedReason}
                  removing={removingRepoId === repo.id}
                />
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
      className="@container overflow-hidden rounded-md border bg-card"
      {...props}
    >
      <div
        className={cn(
          "hidden border-b bg-muted/50 px-4 py-2.5 @5xl:grid",
          COLUMNS,
        )}
      >
        <Skeleton className="h-4 w-20" />
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
              <Skeleton className="h-3 w-24" />
            </div>
            <div className="flex gap-6 @5xl:contents">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-24" />
            </div>
            <Skeleton className="h-8 w-full max-w-sm @5xl:w-72 @5xl:justify-self-end" />
          </div>
        ))}
      </div>
    </div>
  )
}
