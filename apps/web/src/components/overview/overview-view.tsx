"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  ArrowRight,
  Check,
  Clock,
  FolderGit2,
  Loader2,
  Play,
  Plus,
  SlidersHorizontal,
  TrendingDown,
  TriangleAlert,
} from "lucide-react"

import { DeltaText, GradeBadge, KpiCard } from "@/components/dashboard/kpi-card"
import { PageContainer } from "@/components/layout/page-container"
import { PageHeader } from "@/components/layout/page-header"
import { Sparkline } from "@/components/overview/sparkline"
import { EmptyState } from "@/components/empty-state"
import { ErrorState } from "@/components/error-state"
import { LockedAction } from "@/components/locked-action"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  RunningScanCell,
  useRunningScan,
} from "@/components/layout/running-scan"
import { useActivity } from "@/hooks/use-activity"
import { useProjects } from "@/hooks/use-projects"
import {
  startScan,
  useActiveScans,
  type TrackedScan,
} from "@/hooks/use-scan-center"
import { useSelectedProject } from "@/hooks/use-selected-project"
import { useSession } from "@/hooks/use-session"
import { useActiveWorkspace, useWorkspaces } from "@/hooks/use-workspace"
import { useActiveWorkspaceId } from "@/hooks/use-workspace-scope"
import { cancelProjectPrefetch, prefetchProject } from "@/lib/prefetch-project"
import type { ActiveScan, Grade, Repo } from "@/lib/types"
import {
  GRADES,
  needsAttention,
  PROJECT_SORTS,
  scannedWithinWeek,
  sortProjects,
  sumOf,
  workspaceHealth,
  type AttentionItem,
  type ProjectSort,
} from "@/lib/workspace-health"
import { cn, gradeColor, healthColor, relativeTime } from "@/lib/utils"

const numbers = new Intl.NumberFormat("en-US")

const GRADE_FILL: Record<Grade, string> = {
  A: "hsl(var(--health-good))",
  B: "hsl(var(--health-good) / 0.7)",
  C: "hsl(var(--health-mid))",
  D: "hsl(var(--severity-high))",
  E: "hsl(var(--severity-critical))",
}

const dashboardHref = (repo: Repo) => `/dashboard/${repo.id}`

function ProjectRow({
  repo,
  activity,
  canScan,
  onOpen,
  onScan,
}: Readonly<{
  repo: Repo
  activity: ActiveScan[] | undefined
  canScan: boolean
  onOpen: (repo: Repo) => void
  onScan: (repo: Repo) => void
}>) {
  const router = useRouter()
  const health = repo.latest_health
  const running = useRunningScan(repo, activity)
  const trend = health?.trend?.map((point) => point.score) ?? []
  const scan = (
    <Button
      type="button"
      variant={health ? "ghost" : "default"}
      size={health ? "icon" : "sm"}
      className={health ? "size-8" : "h-8 px-3 text-[0.8125rem]"}
      aria-label={
        health ? `Scan ${repo.name}` : `Run first scan of ${repo.name}`
      }
      title={health ? `Scan ${repo.default_branch}` : undefined}
      disabled={!canScan || Boolean(running)}
      onClick={(event) => {
        event.stopPropagation()
        onScan(repo)
      }}
    >
      {running ? <Loader2 className="animate-spin" /> : <Play />}
      {health ? null : "Run first scan"}
    </Button>
  )

  return (
    <tr
      className="cursor-pointer border-b transition-colors last:border-b-0 hover:bg-muted/50"
      onClick={() => onOpen(repo)}
      onPointerEnter={() => prefetchProject(repo, router.prefetch)}
      onPointerLeave={cancelProjectPrefetch}
    >
      <td className="px-4 py-3 align-middle">
        <Link
          href={dashboardHref(repo)}
          onClick={(event) => event.stopPropagation()}
          className="block rounded-sm font-semibold whitespace-nowrap text-foreground-strong outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          {repo.name}
        </Link>
        <span className="block text-xs whitespace-nowrap text-muted-foreground">
          {repo.owner} ·{" "}
          <span className="font-mono">{repo.default_branch}</span>
        </span>
      </td>
      {health ? (
        <>
          <td className="px-4 py-3 align-middle">
            <span className="flex items-center gap-2.5">
              <GradeBadge
                grade={health.grade}
                color={gradeColor(health.grade)}
                size="sm"
              />
              <span className="w-7 text-right font-semibold text-foreground-strong tabular-nums">
                {Math.round(health.score)}
              </span>
              <span className="hidden h-1.5 w-20 overflow-hidden rounded-full bg-muted sm:block">
                <span
                  className="block h-full rounded-full"
                  style={{
                    width: `${Math.max(2, health.score)}%`,
                    backgroundColor: healthColor(health.score),
                  }}
                />
              </span>
            </span>
          </td>
          <td className="hidden px-4 py-3 align-middle lg:table-cell">
            <Sparkline values={trend} falling={health.delta < 0} />
          </td>
          <td className="px-4 py-3 align-middle text-sm">
            <DeltaText value={health.delta} />
          </td>
          <td className="hidden px-4 py-3 align-middle font-semibold text-foreground-strong tabular-nums md:table-cell">
            {health.red_issue_count ?? "—"}
          </td>
          <td className="hidden px-4 py-3 align-middle text-sm text-muted-foreground md:table-cell">
            {running ? (
              <RunningScanCell running={running} />
            ) : (
              <span title={health.scanned_at ?? undefined}>
                {relativeTime(health.scanned_at) ?? "—"}
              </span>
            )}
          </td>
        </>
      ) : (
        <td
          colSpan={5}
          className="px-4 py-3 align-middle text-sm text-muted-foreground"
        >
          {running ? (
            <RunningScanCell running={running} />
          ) : (
            "Not scanned yet — run the first scan to see its health"
          )}
        </td>
      )}
      <td className="px-4 py-3 text-right align-middle">
        <span className="inline-flex items-center justify-end gap-1.5">
          {health ? (
            <Button
              asChild
              variant="outline"
              size="sm"
              className="h-8 px-3 text-[0.8125rem]"
            >
              <Link
                href={dashboardHref(repo)}
                onClick={(event) => event.stopPropagation()}
              >
                Open
              </Link>
            </Button>
          ) : null}
          {canScan ? (
            scan
          ) : (
            <LockedAction reason="Viewers can't start scans">
              {scan}
            </LockedAction>
          )}
        </span>
      </td>
    </tr>
  )
}

const ATTENTION_ICON = {
  dropped: TrendingDown,
  "low-grade": TriangleAlert,
  "never-scanned": Clock,
  rescoring: SlidersHorizontal,
} as const

function AttentionList({
  items,
  onAct,
}: Readonly<{ items: AttentionItem[]; onAct: (item: AttentionItem) => void }>) {
  if (items.length === 0) {
    return (
      <p className="flex items-center gap-2 px-4.5 py-5 text-sm text-muted-foreground">
        <Check className="size-4 text-trend-up" aria-hidden="true" />
        Nothing needs attention right now.
      </p>
    )
  }
  return (
    <ul className="divide-y px-4.5 pb-2">
      {items.map((item) => {
        const Icon = ATTENTION_ICON[item.kind]
        const warn = item.kind === "dropped" || item.kind === "low-grade"
        return (
          <li key={item.repo.id} className="flex gap-3 py-3.5">
            <span
              aria-hidden="true"
              className={cn(
                "grid size-8 shrink-0 place-items-center rounded-md",
                warn
                  ? "bg-[hsl(var(--health-bad)/0.12)] text-trend-down"
                  : "bg-muted text-muted-foreground",
              )}
            >
              <Icon className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground-strong">
                {item.title}
              </p>
              <p className="text-[0.84375rem] text-muted-foreground">
                {item.detail}
              </p>
              <button
                type="button"
                onClick={() => onAct(item)}
                className="mt-1 inline-flex items-center gap-1 rounded-sm text-[0.84375rem] font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              >
                {item.kind === "never-scanned"
                  ? "Run first scan"
                  : item.kind === "low-grade"
                    ? "See top findings"
                    : "Open dashboard"}
                <ArrowRight className="size-3.5" aria-hidden="true" />
              </button>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function RecentActivity({
  projects,
  activity,
  tracked,
}: Readonly<{
  projects: Repo[]
  activity: ActiveScan[] | undefined
  tracked: TrackedScan[]
}>) {
  const running = new Map<string, string>()
  for (const scan of activity ?? []) running.set(scan.repo_id, scan.repo_name)
  for (const scan of tracked) {
    if (scan.job === "scanning" && !running.has(scan.repoId)) {
      const repo = projects.find((item) => item.id === scan.repoId)
      if (repo) running.set(repo.id, `${repo.owner}/${repo.name}`)
    }
  }
  const finished = projects
    .filter((repo) => repo.latest_health?.scanned_at)
    .sort(
      (a, b) =>
        Date.parse(b.latest_health!.scanned_at!) -
        Date.parse(a.latest_health!.scanned_at!),
    )
    .slice(0, 5)

  if (running.size === 0 && finished.length === 0) {
    return (
      <p className="px-4.5 py-5 text-sm text-muted-foreground">
        No scans yet. Scans and their results appear here.
      </p>
    )
  }

  return (
    <ul className="divide-y px-4.5 pb-2">
      {[...running.entries()].map(([repoId, name]) => (
        <li key={`running-${repoId}`} className="flex gap-3 py-3">
          <span className="grid size-6.5 shrink-0 place-items-center rounded-full bg-muted text-primary">
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          </span>
          <div className="min-w-0 text-sm">
            <p className="text-foreground">
              <span className="font-semibold text-foreground-strong">
                Scanning {name.split("/").pop()}
              </span>
            </p>
            <p className="text-xs text-muted-foreground">In progress</p>
          </div>
        </li>
      ))}
      {finished.map((repo) => {
        const health = repo.latest_health!
        return (
          <li key={repo.id} className="flex gap-3 py-3">
            <span className="grid size-6.5 shrink-0 place-items-center rounded-full bg-muted text-trend-up">
              <Check className="size-3.5" aria-hidden="true" />
            </span>
            <div className="min-w-0 text-sm">
              <p className="text-foreground">
                <span className="font-semibold text-foreground-strong">
                  {repo.name}
                </span>{" "}
                scanned · health {Math.round(health.score)}{" "}
                <DeltaText value={health.delta} />
              </p>
              <p
                className="text-xs text-muted-foreground"
                title={health.scanned_at ?? undefined}
              >
                {relativeTime(health.scanned_at)} ·{" "}
                <span className="font-mono">{repo.default_branch}</span>
              </p>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function OverviewSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <p className="sr-only">Loading the overview…</p>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((key) => (
          <div
            key={key}
            className="flex flex-col gap-3 rounded-md border bg-card px-4.5 py-4"
          >
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-3 w-40" />
          </div>
        ))}
      </div>
      <Skeleton className="h-72 w-full" />
    </div>
  )
}

/** The workspace's home: every project side by side, worst first. */
export function OverviewView() {
  const router = useRouter()
  const { data: repos, loading, error, refetch } = useProjects()
  const activity = useActivity()
  const tracked = useActiveScans()
  const { data: session } = useSession()
  const { data: workspaces } = useWorkspaces()
  const workspace = useActiveWorkspace(workspaces)
  const workspaceId = useActiveWorkspaceId()
  const { selectProject } = useSelectedProject({
    availableRepoIds: repos?.map((repo) => repo.id),
  })
  const [sort, setSort] = useState<ProjectSort>("attention")

  const permissions = session?.permissions ?? []
  const canConnect = permissions.includes("repository:connect")
  const canScan = !session || permissions.includes("scan:start")

  const open = (repo: Repo) => {
    selectProject(repo.id)
    router.push(dashboardHref(repo))
  }
  const scan = (repo: Repo) => {
    if (!workspaceId) return
    void startScan({
      workspaceId,
      repoId: repo.id,
      branch: repo.default_branch,
      repoName: repo.name,
    })
  }
  const act = (item: AttentionItem) => {
    if (item.kind === "never-scanned") {
      scan(item.repo)
      return
    }
    selectProject(item.repo.id)
    router.push(
      item.kind === "low-grade"
        ? `${dashboardHref(item.repo)}?view=findings`
        : dashboardHref(item.repo),
    )
  }

  const header = (
    <PageHeader
      title="Overview"
      description={
        repos
          ? `${workspace?.name ?? "This workspace"} · ${repos.length} ${repos.length === 1 ? "repository" : "repositories"} · health of each project's default branch`
          : "Every project in this workspace, side by side."
      }
      aside={
        canConnect ? (
          <Button
            asChild
            variant="outline"
            className="h-9 gap-2 px-3.5 text-sm"
          >
            <Link href="/projects">
              <Plus aria-hidden="true" />
              Connect repository
            </Link>
          </Button>
        ) : null
      }
    />
  )

  if (error) {
    return (
      <PageContainer>
        {header}
        <ErrorState
          title="Couldn't load this workspace's projects"
          detail={error.message}
          onRetry={refetch}
        />
      </PageContainer>
    )
  }

  if (loading || !repos) {
    return (
      <PageContainer>
        {header}
        <OverviewSkeleton />
      </PageContainer>
    )
  }

  if (repos.length === 0) {
    return (
      <PageContainer>
        {header}
        <EmptyState
          icon={<FolderGit2 />}
          title="No repositories yet"
          description={
            canConnect
              ? "Connect a public Java repository and its health appears here, next to every other project in this workspace."
              : "When an org-admin or manager connects a repository, its health appears here."
          }
          action={
            canConnect ? (
              <Button asChild size="sm">
                <Link href="/projects">Connect a repository</Link>
              </Button>
            ) : null
          }
        />
      </PageContainer>
    )
  }

  const health = workspaceHealth(repos)
  const red = sumOf(repos, "red_issue_count")
  const open_findings = sumOf(repos, "finding_count")
  const worstRed = [...repos]
    .filter((repo) => typeof repo.latest_health?.red_issue_count === "number")
    .sort(
      (a, b) =>
        (b.latest_health!.red_issue_count ?? 0) -
        (a.latest_health!.red_issue_count ?? 0),
    )[0]
  const recent = scannedWithinWeek(repos)
  const runningCount = new Set([
    ...(activity?.scans ?? []).map((item) => item.repo_id),
    ...tracked
      .filter((scan) => scan.job === "scanning")
      .map((scan) => scan.repoId),
  ]).size
  const sorted = sortProjects(repos, sort)

  return (
    <PageContainer>
      {header}

      <section
        aria-label="Workspace summary"
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        <KpiCard
          testId="kpi-workspace-health"
          label="Workspace health"
          value={health ? Math.round(health.score) : "—"}
          unit={health ? "/100" : undefined}
          badge={
            health ? (
              <GradeBadge
                grade={health.grade}
                color={gradeColor(health.grade)}
              />
            ) : null
          }
        >
          {health ? (
            <>
              <span>
                <DeltaText value={health.delta} />
                {" since each project's previous scan"}
              </span>
              <span
                className="mt-1 flex h-2 gap-0.5 overflow-hidden rounded-full"
                aria-hidden="true"
              >
                {GRADES.flatMap((grade) =>
                  Array.from(
                    { length: health.distribution[grade] },
                    (_, index) => (
                      <span
                        key={`${grade}-${index}`}
                        className="h-full flex-1"
                        style={{ backgroundColor: GRADE_FILL[grade] }}
                      />
                    ),
                  ),
                )}
                {Array.from({ length: health.notScanned }, (_, index) => (
                  <span
                    key={`new-${index}`}
                    className="h-full flex-1 bg-muted"
                  />
                ))}
              </span>
              <span>
                {health.weighted ? "Weighted by size" : "Average"} ·{" "}
                {health.scannedCount} scanned
                {health.notScanned ? ` · ${health.notScanned} not scanned` : ""}
              </span>
            </>
          ) : (
            <span>Run a first scan to see health here.</span>
          )}
        </KpiCard>
        <KpiCard
          testId="kpi-workspace-red"
          label="Critical & high findings"
          value={red === undefined ? "—" : numbers.format(red)}
          unit={red === undefined ? undefined : "open"}
        >
          <span>
            {worstRed && (worstRed.latest_health?.red_issue_count ?? 0) > 0
              ? `Most in ${worstRed.name} (${worstRed.latest_health!.red_issue_count})`
              : "Across every scanned project"}
          </span>
        </KpiCard>
        <KpiCard
          testId="kpi-workspace-findings"
          label="Findings"
          value={
            open_findings === undefined ? "—" : numbers.format(open_findings)
          }
        >
          <span>In each project&apos;s latest scan</span>
        </KpiCard>
        <KpiCard
          testId="kpi-workspace-recent"
          label="Scanned this week"
          value={recent}
          unit={`of ${repos.length}`}
        >
          <span className="flex items-center gap-1.5">
            {runningCount > 0 ? (
              <>
                <span
                  aria-hidden="true"
                  className="size-2 rounded-full bg-primary motion-safe:animate-pulse"
                />
                <span className="font-medium text-foreground">
                  {runningCount} running now
                </span>
              </>
            ) : (
              "No scans running"
            )}
          </span>
        </KpiCard>
      </section>

      <section
        aria-labelledby="overview-projects"
        className="rounded-md border bg-card"
      >
        <div className="flex flex-wrap items-start justify-between gap-3 px-4.5 pt-4 pb-3">
          <div>
            <h2
              id="overview-projects"
              className="text-base font-semibold text-foreground-strong"
            >
              Projects
            </h2>
            <p className="text-xs text-muted-foreground">
              Open a project for its findings, files and history.
            </p>
          </div>
          <label className="flex items-center gap-2 text-[0.84375rem] text-muted-foreground">
            Sort
            <Select
              value={sort}
              onValueChange={(value) => setSort(value as ProjectSort)}
            >
              <SelectTrigger className="h-8 w-52" aria-label="Sort projects">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {PROJECT_SORTS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-y bg-muted/50 text-left text-xs text-muted-foreground">
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Repository
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Health
                </th>
                <th
                  scope="col"
                  className="hidden px-4 py-2.5 font-medium lg:table-cell"
                >
                  Trend · last scans
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Change
                </th>
                <th
                  scope="col"
                  className="hidden px-4 py-2.5 font-medium md:table-cell"
                >
                  Crit + high
                </th>
                <th
                  scope="col"
                  className="hidden px-4 py-2.5 font-medium md:table-cell"
                >
                  Last scan
                </th>
                <th scope="col" className="px-4 py-2.5">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((repo) => (
                <ProjectRow
                  key={repo.id}
                  repo={repo}
                  activity={activity?.scans}
                  canScan={canScan}
                  onOpen={open}
                  onScan={scan}
                />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <section
          aria-labelledby="overview-attention"
          className="rounded-md border bg-card"
        >
          <div className="px-4.5 pt-4 pb-1">
            <h2
              id="overview-attention"
              className="text-base font-semibold text-foreground-strong"
            >
              Needs attention
            </h2>
            <p className="text-xs text-muted-foreground">
              What changed, and where to look first
            </p>
          </div>
          <AttentionList items={needsAttention(repos, activity)} onAct={act} />
        </section>
        <section
          aria-labelledby="overview-activity"
          className="rounded-md border bg-card"
        >
          <div className="px-4.5 pt-4 pb-1">
            <h2
              id="overview-activity"
              className="text-base font-semibold text-foreground-strong"
            >
              Recent activity
            </h2>
            <p className="text-xs text-muted-foreground">
              Scans running now and each project&apos;s latest result
            </p>
          </div>
          <RecentActivity
            projects={repos}
            activity={activity?.scans}
            tracked={tracked}
          />
        </section>
      </div>
    </PageContainer>
  )
}
