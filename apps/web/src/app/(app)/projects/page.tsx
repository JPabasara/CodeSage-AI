"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { ApiRequestError, connectRepo, removeProject } from "@/lib/api/client"
import {
  connectFailureMessage,
  INVALID_REPOSITORY_URL_MESSAGE,
  isGitHubRepositoryUrl,
} from "@/lib/guardrail-messages"
import type { Repo } from "@/lib/types"
import { SourceScopeSettings } from "@/components/dashboard/source-scope-settings"
import { ConnectRepo } from "@/components/projects/connect-repo"
import {
  JavaOnlyDialog,
  javaOnlyAckKey,
  readJavaOnlyAck,
  repositoryLabel,
  type ConnectMode,
} from "@/components/projects/java-only-dialog"
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
import { startScan } from "@/hooks/use-scan-center"
import { useSelectedProject } from "@/hooks/use-selected-project"
import { useSession } from "@/hooks/use-session"
import { useActiveWorkspace, useWorkspaces } from "@/hooks/use-workspace"
import { useActiveWorkspaceId } from "@/hooks/use-workspace-scope"
import { cancelProjectPrefetch, prefetchProject } from "@/lib/prefetch-project"
import { PAGE_CONTAINER } from "@/components/layout/page-container"
import { cn } from "@/lib/utils"

const REMOVE_LOCKED_REASON =
  "Only org-admins and managers can remove repositories"
const SCAN_LOCKED_REASON = "Viewers can't start scans"

export default function ProjectsPage() {
  const router = useRouter()
  const { data: repos, loading, error, refetch } = useProjects()
  const { data: session } = useSession()
  const { data: workspaces } = useWorkspaces()
  const activeWorkspace = useActiveWorkspace(workspaces)
  const workspaceId = useActiveWorkspaceId()
  const permissions = session?.permissions ?? []
  const canConnect = permissions.includes("repository:connect")
  const canDisconnect = permissions.includes("repository:disconnect")
  const canScan = permissions.includes("scan:start")
  const canConfigure = permissions.includes("profile:update")
  const [configureRepo, setConfigureRepo] = useState<Repo>()
  const [scanAfterConfiguration, setScanAfterConfiguration] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [connectError, setConnectError] = useState<string>()
  // The URL waiting on the Java-only dialog, and the form's promise for it.
  const [pendingUrl, setPendingUrl] = useState<string>()
  const settlePending = useRef<((connected: boolean) => void) | undefined>(
    undefined,
  )
  const [pendingRemoval, setPendingRemoval] = useState<Repo>()
  const [removingRepoId, setRemovingRepoId] = useState<string>()
  const { selectedProjectId, selectProject, clearProject } = useSelectedProject(
    {
      availableRepoIds: repos?.map((repo) => repo.id),
      // This screen has an intentional "None" state after the active repository is removed.
      fallbackToFirstAvailable: false,
    },
  )
  const projectCount = repos?.length ?? 0
  const scannedCount = repos?.filter((repo) => repo.latest_health).length ?? 0
  const ackKey =
    session?.user_id && workspaceId
      ? javaOnlyAckKey(session.user_id, workspaceId)
      : undefined

  const openDashboard = (repo: Repo) => {
    selectProject(repo.id)
    router.push(`/dashboard/${repo.id}`)
  }

  /** The first scan runs while the dashboard shows its progress. */
  const scanAndOpen = (repo: Repo, quiet = false) => {
    if (workspaceId) {
      void startScan(
        {
          workspaceId,
          repoId: repo.id,
          branch: repo.default_branch,
          repoName: repo.name,
        },
        // Connect and scan already said "scan queued" in its own toast.
        { quiet },
      )
    }
    openDashboard(repo)
  }

  function finishConfiguration() {
    if (!configureRepo) return
    const repo = configureRepo
    setConfigureRepo(undefined)
    if (scanAfterConfiguration) {
      toast.success(
        `Connected ${repo.owner}/${repo.name} · scan queued on ${repo.default_branch}`,
      )
      scanAndOpen(repo, true)
    }
    setScanAfterConfiguration(false)
  }

  async function connect(url: string, mode: ConnectMode): Promise<boolean> {
    setConnecting(true)
    setConnectError(undefined)
    try {
      const repo = await connectRepo(url)
      publishProjectConnected(repo)
      selectProject(repo.id)
      const label = `${repo.owner}/${repo.name}`
      if (canConfigure) {
        setConfigureRepo(repo)
        setScanAfterConfiguration(mode === "scan" && Boolean(workspaceId))
        toast.success(`Connected ${label}`)
      } else if (mode === "scan" && workspaceId) {
        toast.success(
          `Connected ${label} · scan queued on ${repo.default_branch}`,
        )
        scanAndOpen(repo, true)
      } else {
        toast.success(`Connected ${label}`)
      }
      return true
    } catch (err) {
      const message = connectFailureMessage(err)
      setConnectError(message)
      toast.error(message)
      return false
    } finally {
      setConnecting(false)
    }
  }

  /** Resolves false when refused or cancelled, so the form keeps the URL. */
  async function onConnect(url: string): Promise<boolean> {
    if (!isGitHubRepositoryUrl(url)) {
      setConnectError(INVALID_REPOSITORY_URL_MESSAGE)
      toast.error(INVALID_REPOSITORY_URL_MESSAGE)
      return false
    }
    setConnectError(undefined)
    const remembered = readJavaOnlyAck(ackKey)
    if (remembered) return connect(url, remembered)
    return new Promise<boolean>((resolve) => {
      settlePending.current = resolve
      setPendingUrl(url)
    })
  }

  // The dialog closes first, so a refusal lands under the URL field.
  function takePending() {
    const url = pendingUrl
    const settle = settlePending.current
    settlePending.current = undefined
    setPendingUrl(undefined)
    return { url, settle }
  }

  async function onConfirmConnect(mode: ConnectMode) {
    const { url, settle } = takePending()
    if (!url) return
    settle?.(await connect(url, mode))
  }

  function onCancelConnect() {
    takePending().settle?.(false)
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
    <div className={cn(PAGE_CONTAINER, "gap-5")}>
      <PageHeader
        title="Projects"
        description={
          <>
            Repositories connected to{" "}
            <span className="text-foreground">
              {activeWorkspace?.name ?? "this workspace"}
            </span>
            . Open one to see its dashboard.
          </>
        }
        aside={
          repos ? (
            <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
              <span>
                <span className="font-semibold text-foreground-strong tabular-nums">
                  {projectCount}
                </span>{" "}
                connected
              </span>
              <span aria-hidden="true">·</span>
              <span>
                <span className="font-semibold text-foreground-strong tabular-nums">
                  {scannedCount}
                </span>{" "}
                scanned
              </span>
            </p>
          ) : loading ? (
            <Skeleton className="h-5 w-40" />
          ) : null
        }
      />

      <ConnectRepo
        onConnect={onConnect}
        busy={connecting}
        error={connectError}
        onErrorClear={() => setConnectError(undefined)}
        lockedReason={canConnect ? undefined : CONNECT_LOCKED_REASON}
      />

      <section
        aria-labelledby="connected-repositories-heading"
        className="flex flex-col gap-3"
        data-tour="project-list"
      >
        <div>
          <h2
            id="connected-repositories-heading"
            className="text-base font-semibold text-foreground-strong"
          >
            Connected repositories
          </h2>
          {repos?.length !== 0 ? (
            <p className="text-xs text-muted-foreground">
              Click a row to open its dashboard. The highlighted row is the
              project the rail and top bar point at.
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
            onSelect={(repo) => selectProject(repo.id)}
            onOpen={openDashboard}
            onHistory={(repo) => selectProject(repo.id)}
            onFirstScan={scanAndOpen}
            scanLockedReason={canScan ? undefined : SCAN_LOCKED_REASON}
            onRemove={canDisconnect ? setPendingRemoval : undefined}
            removeLockedReason={
              canDisconnect ? undefined : REMOVE_LOCKED_REASON
            }
            onIntent={(repo) =>
              repo
                ? prefetchProject(repo, router.prefetch)
                : cancelProjectPrefetch()
            }
            removingRepoId={removingRepoId}
          />
        )}
      </section>

      {configureRepo ? (
        <SourceScopeSettings
          key={configureRepo.id}
          repoId={configureRepo.id}
          canEdit={canConfigure}
          initialOpen
          saveLabel={
            scanAfterConfiguration ? "Save and scan" : "Save configuration"
          }
          onSaved={finishConfiguration}
          onSkip={scanAfterConfiguration ? finishConfiguration : undefined}
          onClose={() => {
            setConfigureRepo(undefined)
            setScanAfterConfiguration(false)
          }}
        />
      ) : null}

      <JavaOnlyDialog
        repository={pendingUrl ? repositoryLabel(pendingUrl) : undefined}
        ackKey={ackKey}
        onConfirm={(mode) => void onConfirmConnect(mode)}
        onCancel={onCancelConnect}
      />

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
