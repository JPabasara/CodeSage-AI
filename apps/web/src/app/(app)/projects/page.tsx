"use client"

import { useState } from "react"
import { Activity, CheckCircle2, FolderGit2 } from "lucide-react"
import { toast } from "sonner"

import { ApiRequestError, connectRepo, removeProject } from "@/lib/api/client"
import type { ErrorCode, Repo } from "@/lib/types"
import { ConnectRepo } from "@/components/projects/connect-repo"
import { ErrorState } from "@/components/error-state"
import { ProjectList } from "@/components/projects/project-list"
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
import { useProjects } from "@/hooks/use-projects"
import { useSelectedProject } from "@/hooks/use-selected-project"

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
  // Both halves of the contract, on one screen: `reload` after a successful
  // connect keeps the list on screen, `refetch` behind Retry blanks it to
  // skeletons so the press is visibly doing something.
  const { data: repos, loading, error, reload, refetch } = useProjects()
  const [connecting, setConnecting] = useState(false)
  const [pendingRemoval, setPendingRemoval] = useState<Repo>()
  const [removingRepoId, setRemovingRepoId] = useState<string>()
  const { selectedProjectId, selectProject, clearProject } = useSelectedProject({
    availableRepoIds: repos?.map((repo) => repo.id),
  })
  const projectCount = repos?.length ?? 0
  const scannedCount = repos?.filter((repo) => repo.latest_health).length ?? 0
  const activeProject = repos?.find((repo) => repo.id === selectedProjectId)

  async function onConnect(url: string) {
    setConnecting(true)
    try {
      const repo = await connectRepo(url)
      selectProject(repo.id)
      reload() // the list is a separate read; it does not know about the write
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
      if (selectedProjectId === pendingRemoval.id) clearProject()
      toast.success(`Removed ${pendingRemoval.owner}/${pendingRemoval.name}`)
      setPendingRemoval(undefined)
      reload()
    } catch (err) {
      const message =
        err instanceof ApiRequestError && err.code === "REPOSITORY_SCAN_RUNNING"
          ? "Stop the running scan before removing this repository."
          : err instanceof Error
            ? err.message
            : "Couldn't remove that repository."
      toast.error(message)
    } finally {
      setRemovingRepoId(undefined)
    }
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-4 rounded-lg border bg-card p-5 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-primary">
            Workspace
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Connect repositories, open their refactor dashboard, and review scan
            history without losing your selected project context.
          </p>
        </div>

        <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-3 lg:min-w-[24rem]">
          <span className="inline-flex items-center gap-2 rounded-md border bg-background px-3 py-2">
            <FolderGit2 className="size-4 text-primary" aria-hidden="true" />
            <span>
              <strong className="block text-sm text-foreground">
                {projectCount}
              </strong>
              Connected
            </span>
          </span>
          <span className="inline-flex items-center gap-2 rounded-md border bg-background px-3 py-2">
            <Activity className="size-4 text-primary" aria-hidden="true" />
            <span>
              <strong className="block text-sm text-foreground">
                {scannedCount}
              </strong>
              Scanned
            </span>
          </span>
          <span className="inline-flex min-w-0 items-center gap-2 rounded-md border bg-background px-3 py-2">
            <CheckCircle2 className="size-4 text-primary" aria-hidden="true" />
            <span className="min-w-0">
              <strong className="block truncate text-sm text-foreground">
                {activeProject ? activeProject.name : "None"}
              </strong>
              Active
            </span>
          </span>
        </div>
      </header>

      <ConnectRepo onConnect={onConnect} busy={connecting} />

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold">Connected repositories</h2>
            <p className="text-sm text-muted-foreground">
              Open the dashboard or scan history for the repository you want to
              review.
            </p>
          </div>
        </div>

        {error ? (
          <ErrorState
            title="Could not load projects"
            detail={error.message}
            onRetry={refetch}
          />
        ) : loading ? (
          <div className="space-y-3" data-testid="projects-loading">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : (
          <ProjectList
            repos={repos ?? []}
            activeRepoId={selectedProjectId}
            onSelect={(repo) => {
              selectProject(repo.id)
            }}
            onHistory={(repo) => {
              selectProject(repo.id)
            }}
            onRemove={setPendingRemoval}
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
