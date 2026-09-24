"use client"

import { useState } from "react"
import { toast } from "sonner"

import { ApiRequestError, connectRepo, removeProject } from "@/lib/api/client"
import type { ErrorCode, Repo } from "@/lib/types"
import { ConnectRepo } from "@/components/projects/connect-repo"
import { ErrorState } from "@/components/error-state"
import { PageHeader } from "@/components/layout/page-header"
import { CONNECT_LOCKED_REASON } from "@/components/projects/no-project-state"
import {
  ProjectList,
  ProjectListSkeleton,
} from "@/components/projects/project-list"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import {
  publishProjectConnected,
  publishProjectRemoved,
  useProjects,
} from "@/hooks/use-projects"
import { useSelectedProject } from "@/hooks/use-selected-project"
import { useSession } from "@/hooks/use-session"
import { useActiveWorkspace, useWorkspaces } from "@/hooks/use-workspace"

// Each code is a different thing for the user to do about it, which is why they
// are separate rather than one 400; a bare "400 Bad Request" leaves someone who
// pasted a repository with no idea what went wrong.
const CONNECT_MESSAGE: Partial<Record<ErrorCode, string>> = {
  INVALID_REPOSITORY_URL: "That does not look like a repository URL.",
  REPOSITORY_NOT_PUBLIC:
    "Only public repositories can be connected in this release.",
  REPOSITORY_UNREACHABLE:
    "That repository could not be reached. Check the URL and try again.",
  ALREADY_CONNECTED: "That repository is already connected.",
}

export default function ProjectsPage() {
  // Project writes update every mounted consumer through useProjects; `refetch`
  // remains the loud Retry path that returns this screen to its skeletons.
  const { data: repos, loading, error, refetch } = useProjects()
  const { data: session } = useSession()
  const { data: workspaces } = useWorkspaces()
  const activeWorkspace = useActiveWorkspace(workspaces)
  // Which controls to offer. Hiding one the API would refuse is a courtesy; the
  // API re-checks every request either way.
  const canConnect =
    session?.permissions?.includes("repository:connect") ?? false
  const canDisconnect =
    session?.permissions?.includes("repository:disconnect") ?? false
  const [connecting, setConnecting] = useState(false)
  const [pendingRemoval, setPendingRemoval] = useState<Repo>()
  const [removingRepoId, setRemovingRepoId] = useState<string>()
  const { selectedProjectId, selectProject, clearProject } = useSelectedProject(
    {
      availableRepoIds: repos?.map((repo) => repo.id),
      // This screen has an intentional "None" state after the active repository
      // is removed. Re-selecting the first stale list item would write the deleted
      // repository straight back to localStorage before reload() finishes.
      fallbackToFirstAvailable: false,
    },
  )
  const projectCount = repos?.length ?? 0
  const scannedCount = repos?.filter((repo) => repo.latest_health).length ?? 0
  const activeProject = repos?.find((repo) => repo.id === selectedProjectId)

  async function onConnect(url: string) {
    setConnecting(true)
    try {
      const repo = await connectRepo(url)
      publishProjectConnected(repo)
      selectProject(repo.id)
      toast.success(`Connected ${repo.owner}/${repo.name}`)
    } catch (err) {
      const code = err instanceof ApiRequestError ? err.code : undefined
      toast.error(
        (code && CONNECT_MESSAGE[code]) ??
          (err instanceof Error
            ? err.message
            : "Couldn't connect that repository."),
      )
    } finally {
      setConnecting(false)
    }
  }

  async function onRemove() {
    if (!pendingRemoval) return
    setRemovingRepoId(pendingRemoval.id)
    try {
      await removeProject(pendingRemoval.id)
      const remainingRepos = (repos ?? []).filter(
        (repo) => repo.id !== pendingRemoval.id,
      )
      publishProjectRemoved(pendingRemoval.id, remainingRepos)
      if (selectedProjectId === pendingRemoval.id) {
        const nextProject = remainingRepos[0]
        if (nextProject) selectProject(nextProject.id)
        else clearProject()
      }
      toast.success(`Removed ${pendingRemoval.owner}/${pendingRemoval.name}`)
      setPendingRemoval(undefined)
    } catch (err) {
      const message =
        err instanceof ApiRequestError && err.code === "REPOSITORY_SCAN_RUNNING"
          ? "Stop or wait for the queued or running scan before removing this repository."
          : err instanceof Error
            ? err.message
            : "Couldn't remove that repository."
      toast.error(message)
    } finally {
      setRemovingRepoId(undefined)
    }
  }

  const workspaceName = activeWorkspace?.name ?? "This workspace"

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 p-4 sm:p-6">
      <PageHeader
        title="Projects"
        // The workspace name, not the word "Workspace": the same three
        // repositories mean something different depending on which one you
        // are standing in.
        context={
          <span className="truncate">
            {activeWorkspace?.name ?? "Workspace"}
          </span>
        }
        description="Connect repositories and open their dashboard or scan history."
        aside={
          repos ? (
            <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              <span>
                <span className="font-medium text-foreground tabular-nums">
                  {projectCount}
                </span>{" "}
                connected
              </span>
              <span aria-hidden="true">·</span>
              <span>
                <span className="font-medium text-foreground tabular-nums">
                  {scannedCount}
                </span>{" "}
                scanned
              </span>
              <span aria-hidden="true">·</span>
              {activeProject ? (
                <span className="inline-flex min-w-0 items-center gap-1">
                  Active
                  <span className="max-w-48 truncate font-medium text-foreground">
                    {activeProject.name}
                  </span>
                </span>
              ) : (
                <span>No project selected</span>
              )}
            </p>
          ) : loading ? (
            <Skeleton className="h-5 w-64" />
          ) : null
        }
      />

      {/* One form for every role, so the page reads the same for all of them;
          a role without repository:connect gets it disabled, with the reason
          on the button. The API re-checks every request either way. */}
      <ConnectRepo
        className="mx-auto w-full max-w-2xl"
        onConnect={onConnect}
        busy={connecting}
        lockedReason={canConnect ? undefined : CONNECT_LOCKED_REASON}
      />

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="text-[15px] font-semibold">Connected repositories</h2>
          {/* Hidden only once the list is known to be empty — the empty state
              says what to do instead — so loading does not shift the header. */}
          {repos?.length !== 0 ? (
            <p className="text-sm text-muted-foreground">
              Open the dashboard or scan history for the repository you want to
              review.
            </p>
          ) : null}
        </div>

        {error ? (
          <ErrorState
            title="Could not load projects"
            detail={error.message}
            onRetry={refetch}
          />
        ) : loading ? (
          <ProjectListSkeleton data-testid="projects-loading" />
        ) : (
          <ProjectList
            repos={repos ?? []}
            activeRepoId={selectedProjectId}
            emptyDescription={
              canConnect
                ? `${workspaceName} is empty. Connect a public repository above and it becomes this workspace's first project.`
                : `${workspaceName} has no repositories yet.`
            }
            onSelect={(repo) => {
              selectProject(repo.id)
            }}
            onHistory={(repo) => {
              selectProject(repo.id)
            }}
            onRemove={canDisconnect ? setPendingRemoval : undefined}
            removingRepoId={removingRepoId}
          />
        )}
      </section>

      <Dialog
        open={Boolean(pendingRemoval)}
        onOpenChange={(open) => !open && setPendingRemoval(undefined)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove connected repository?</DialogTitle>
            <DialogDescription>
              This permanently removes {pendingRemoval?.owner}/
              {pendingRemoval?.name} and all of its scans, findings, and scores
              from this workspace.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              variant="destructive"
              disabled={Boolean(removingRepoId)}
              onClick={onRemove}
            >
              {removingRepoId ? "Removing…" : "Remove repository"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
