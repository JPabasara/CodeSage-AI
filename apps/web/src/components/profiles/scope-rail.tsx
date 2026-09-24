"use client"

import { useEffect, useRef } from "react"
import Link from "next/link"
import { Building2, FolderGit2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/empty-state"
import { useProjectProfile } from "@/hooks/use-profiles"
import { cn } from "@/lib/utils"
import type { ProjectProfile, Repo, ScoreProfile } from "@/lib/types"

/** One selectable scope card. The whole card is the button: it holds no other control. */
function ScopeButton({
  selected,
  onSelect,
  icon,
  title,
  children,
}: Readonly<{
  selected: boolean
  onSelect: () => void
  icon: React.ReactNode
  title: React.ReactNode
  children: React.ReactNode
}>) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "flex w-full min-w-0 items-start gap-2.5 rounded-lg border bg-card p-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
        selected
          ? "border-primary ring-1 ring-primary"
          : "hover:border-foreground/20",
      )}
    >
      <span
        className={cn(
          "mt-0.5 shrink-0 [&_svg]:size-4",
          selected ? "text-primary" : "text-muted-foreground",
        )}
        aria-hidden="true"
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1 space-y-1">
        <span className="block truncate text-sm">{title}</span>
        <span className="flex min-h-5 min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          {children}
        </span>
      </span>
    </button>
  )
}

/**
 * One connected project, and the profile in force for it.
 *
 * It reads its own project profile — the same query the editor uses for the
 * project being configured — so every card is right on its own. `current` is the
 * editor's copy for the selected project, which a write updates first; `version`
 * moves after any write that can change what a project is scored with, and each
 * card then re-reads quietly.
 */
function ProjectScopeCard({
  repo,
  selected,
  current,
  version,
  onSelect,
}: Readonly<{
  repo: Repo
  selected: boolean
  current?: ProjectProfile
  version: number
  onSelect: () => void
}>) {
  const { data: fetched, error, reload } = useProjectProfile(repo.id)
  const data = current ?? fetched

  const seenVersion = useRef(version)
  useEffect(() => {
    if (version === seenVersion.current) return
    seenVersion.current = version
    reload()
  }, [version, reload])

  return (
    <ScopeButton
      selected={selected}
      onSelect={onSelect}
      icon={<FolderGit2 />}
      title={
        <span title={`${repo.owner}/${repo.name}`}>
          <span className="text-muted-foreground">{repo.owner}/</span>
          <span className="font-semibold">{repo.name}</span>
        </span>
      }
    >
      {data ? (
        <>
          <span className="truncate text-foreground">
            {data.effective.name}
          </span>
          {data.inherited ? (
            <span className="shrink-0">· Inherited</span>
          ) : (
            <Badge variant="secondary" className="shrink-0">
              Own profile
            </Badge>
          )}
        </>
      ) : error ? (
        <span>Couldn’t read its profile</span>
      ) : (
        <Skeleton className="h-3 w-24" />
      )}
    </ScopeButton>
  )
}

/**
 * What the profile being configured applies to: the workspace default, or one
 * project's own choice. Selecting a card here is how the page changes scope.
 */
export function ScopeRail({
  repos,
  reposError,
  onRetryRepos,
  workspaceDefault,
  selectedProjectId,
  current,
  version,
  onSelect,
  className,
}: Readonly<{
  repos?: Repo[]
  reposError?: Error
  onRetryRepos: () => void
  workspaceDefault?: ScoreProfile
  /** Undefined while the workspace default is being configured. */
  selectedProjectId?: string
  /** The editor's copy of the selected project's profile. */
  current?: ProjectProfile
  version: number
  onSelect: (projectId: string | undefined) => void
  className?: string
}>) {
  return (
    <section aria-labelledby="apply-to-heading" className={className}>
      <div className="mb-3 space-y-0.5">
        <h2 id="apply-to-heading" className="text-[15px] font-semibold">
          Apply to
        </h2>
        <p className="text-xs text-muted-foreground">
          Projects use the workspace default unless they have their own.
        </p>
      </div>

      {/* A row that scrolls sideways on a phone, a column in the rail. The
          padding keeps the selected ring clear of the scroll edge. */}
      <ul className="-m-1 flex gap-2 overflow-x-auto p-1 lg:flex-col lg:overflow-x-visible">
        <li className="w-60 shrink-0 lg:w-auto">
          <ScopeButton
            selected={!selectedProjectId}
            onSelect={() => onSelect(undefined)}
            icon={<Building2 />}
            title={<span className="font-semibold">Workspace default</span>}
          >
            {workspaceDefault ? (
              <span
                className="truncate text-foreground"
                data-testid="workspace-default-name"
              >
                {workspaceDefault.name}
              </span>
            ) : (
              <Skeleton className="h-3 w-20" />
            )}
          </ScopeButton>
        </li>

        {repos
          ? repos.map((repo) => (
              <li key={repo.id} className="w-60 shrink-0 lg:w-auto">
                <ProjectScopeCard
                  repo={repo}
                  selected={repo.id === selectedProjectId}
                  current={repo.id === selectedProjectId ? current : undefined}
                  version={version}
                  onSelect={() => onSelect(repo.id)}
                />
              </li>
            ))
          : reposError
            ? null
            : [0, 1].map((i) => (
                <li key={i} className="w-60 shrink-0 lg:w-auto">
                  <Skeleton className="h-17.5 w-full rounded-lg" />
                </li>
              ))}
      </ul>

      {reposError ? (
        <div
          className="mt-3 space-y-2 text-xs text-muted-foreground"
          role="alert"
        >
          <p>Couldn’t load your projects.</p>
          <Button variant="outline" size="sm" onClick={onRetryRepos}>
            Retry
          </Button>
        </div>
      ) : repos && repos.length === 0 ? (
        <EmptyState
          className="mt-3 px-4 py-6"
          icon={<FolderGit2 />}
          title="No projects yet"
          description="Connect a repository to give it its own profile."
          action={
            <Button asChild variant="outline" size="sm">
              <Link href="/projects">Open Projects</Link>
            </Button>
          }
        />
      ) : null}
    </section>
  )
}
