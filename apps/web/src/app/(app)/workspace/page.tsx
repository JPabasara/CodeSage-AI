"use client"

import { useState } from "react"
import { Plus } from "lucide-react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorState } from "@/components/error-state"
import { PageHeader } from "@/components/layout/page-header"
import {
  WorkspaceForm,
  workspaceBody,
  type WorkspaceFields,
} from "@/components/workspace/workspace-form"
import { TeamPanel, TeamPanelSkeleton } from "@/components/workspace/team-panel"
import { CreateWorkspaceDialog } from "@/components/workspace/create-workspace-dialog"
import { DeleteWorkspaceSection } from "@/components/workspace/delete-workspace-section"
import { ApiRequestError, updateWorkspace } from "@/lib/api/client"
import {
  publishWorkspacesChanged,
  leaveDeletedWorkspace,
  useActiveWorkspace,
  useWorkspaces,
} from "@/hooks/use-workspace"
import { useMembers } from "@/hooks/use-members"
import { useSession } from "@/hooks/use-session"
import { ROLE_LABEL } from "@/lib/roles"
import type { UpdateWorkspaceRequest, Workspace } from "@/lib/types"
import { PAGE_CONTAINER } from "@/components/layout/page-container"
import { cn } from "@/lib/utils"

const fieldsOf = (workspace: Workspace): WorkspaceFields => ({
  name: workspace.name,
  description: workspace.description ?? "",
  website_url: workspace.website_url ?? "",
})

/** Only what changed. `null` clears a field; omitted leaves it alone. */
function patchFor(
  workspace: Workspace,
  values: WorkspaceFields,
): UpdateWorkspaceRequest {
  const body = workspaceBody(values)
  const patch: UpdateWorkspaceRequest = {}
  if (body.name !== workspace.name) patch.name = body.name
  if (body.description !== (workspace.description ?? null)) {
    patch.description = body.description
  }
  if (body.website_url !== (workspace.website_url ?? null)) {
    patch.website_url = body.website_url
  }
  return patch
}

/**
 * One column of cards, read top to bottom: the workspace itself, its team,
 * then the rarer and riskier actions. Never side by side.
 */
const LAYOUT = {
  page: PAGE_CONTAINER,
  stack: "flex w-full max-w-4xl flex-col gap-6",
  team: "min-w-0 scroll-mt-6",
  card: "rounded-md border bg-card",
  cardHead: "px-4.5 pt-4 pb-3",
  cardTitle: "text-base font-semibold text-foreground-strong",
  cardDesc: "text-xs text-muted-foreground",
} as const

// One page for "this workspace": who is in it, and what it is called.
export default function WorkspacePage() {
  const router = useRouter()
  const members = useMembers()
  const { data: session } = useSession()
  const { data: workspaces, loading, error, refetch, reload } = useWorkspaces()
  const active = useActiveWorkspace(workspaces)

  const [draft, setDraft] = useState<WorkspaceFields>()
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string>()

  const [creatingNew, setCreatingNew] = useState(false)

  const canEdit = session?.permissions?.includes("workspace:update") ?? false
  const canManageMembers =
    session?.permissions?.includes("member:manage") ?? false
  const canDelete = session?.permissions?.includes("workspace:delete") ?? false

  const values = draft ?? (active ? fieldsOf(active) : undefined)

  async function onSave() {
    if (!active || !values) return
    const patch = patchFor(active, values)
    setSaving(true)
    setSaveError(undefined)
    try {
      if (Object.keys(patch).length > 0) {
        await updateWorkspace(active.workspace_id, patch)
      }
      reload()
      // And every other consumer — the top bar's switcher names it too.
      publishWorkspacesChanged()
      setDraft(undefined)
      toast.success("Workspace updated")
    } catch (caught) {
      setSaveError(
        caught instanceof ApiRequestError
          ? caught.status === 403
            ? "Only an org-admin can change workspace settings."
            : caught.code === "VALIDATION_FAILED"
              ? "Check the name and website — a website must be a full http or https URL."
              : caught.detail
          : "Couldn't save those changes.",
      )
    } finally {
      setSaving(false)
    }
  }

  if (error) {
    return (
      <div className={LAYOUT.page}>
        <ErrorState
          title="Couldn’t load this workspace"
          detail={error.message}
          onRetry={refetch}
        />
      </div>
    )
  }

  if (loading || !active || !values) {
    return <WorkspaceSkeleton canManage={canManageMembers} />
  }

  const invited = members.data?.pending_invitations.length

  return (
    <div className={LAYOUT.page}>
      <PageHeader
        title={<span className="wrap-anywhere">{active.name}</span>}
        context={
          <Badge variant="secondary">
            {ROLE_LABEL[active.role] ?? active.role}
          </Badge>
        }
        description="Projects, profiles and teammates in this workspace."
        aside={
          <WorkspaceFigures
            projects={active.project_count ?? 0}
            members={active.member_count ?? 0}
            invited={invited}
          />
        }
      />

      <div className={LAYOUT.stack}>
        <section
          aria-labelledby="workspace-settings-heading"
          data-tour="workspace-settings"
          className={LAYOUT.card}
        >
          <div className={LAYOUT.cardHead}>
            <h2 id="workspace-settings-heading" className={LAYOUT.cardTitle}>
              Workspace settings
            </h2>
            <p className={LAYOUT.cardDesc}>
              Everyone in this workspace sees these.
            </p>
          </div>
          <div className="max-w-xl px-4.5 pt-1 pb-4.5">
            <WorkspaceForm
              values={values}
              onChange={setDraft}
              onSubmit={onSave}
              busy={saving}
              error={saveError}
              disabled={!canEdit}
              lockedReason="Only org-admins can change workspace settings"
              submitLabel="Save changes"
              busyLabel="Saving…"
            >
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setDraft(undefined)
                  setSaveError(undefined)
                }}
                disabled={!draft || saving}
              >
                Discard
              </Button>
            </WorkspaceForm>
          </div>
        </section>

        <div id="team" className={LAYOUT.team}>
          <TeamPanel
            query={members}
            canManage={canManageMembers}
            currentUserId={session?.user_id}
            workspaceName={active.name}
          />
        </div>

        {canEdit ? (
          <section
            aria-labelledby="new-workspace-heading"
            className={cn(
              LAYOUT.card,
              "flex flex-col gap-3 px-4.5 py-4 sm:flex-row sm:items-center sm:justify-between",
            )}
          >
            <div className="max-w-xl">
              <h2 id="new-workspace-heading" className={LAYOUT.cardTitle}>
                Another workspace
              </h2>
              <p className={LAYOUT.cardDesc}>
                Its own projects, profiles and members. It starts empty, and you
                become its org-admin.
              </p>
            </div>
            <Button
              variant="outline"
              className="shrink-0 self-start sm:self-auto"
              onClick={() => setCreatingNew(true)}
            >
              <Plus aria-hidden="true" />
              New workspace
            </Button>
          </section>
        ) : null}

        <CreateWorkspaceDialog
          open={creatingNew}
          onOpenChange={setCreatingNew}
          description={`Creating it also switches you to it. Nothing from ${active.name} comes with you.`}
        />

        {canDelete ? (
          <DeleteWorkspaceSection
            workspaceId={active.workspace_id}
            workspaceName={active.name}
            onDeleted={() => {
              leaveDeletedWorkspace(active.workspace_id)
              router.replace("/workspace")
            }}
          />
        ) : null}
      </div>
    </div>
  )
}

/** The three counts beside the heading: quiet text, not tiles. */
function WorkspaceFigures({
  projects,
  members,
  invited,
}: Readonly<{ projects: number; members: number; invited?: number }>) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm text-muted-foreground">
      <span>
        <span
          className="font-semibold text-foreground-strong tabular-nums"
          data-testid="workspace-project-count"
        >
          {projects}
        </span>{" "}
        {projects === 1 ? "project" : "projects"}
      </span>
      <span>
        <span className="font-semibold text-foreground-strong tabular-nums">
          {members}
        </span>{" "}
        {members === 1 ? "member" : "members"}
      </span>
      <span>
        <span
          className="font-semibold text-foreground-strong tabular-nums"
          data-testid="workspace-invitation-count"
        >
          {invited ?? "–"}
        </span>{" "}
        invited
      </span>
    </p>
  )
}

/** Same shape as the page, so nothing moves when the workspace arrives. */
function WorkspaceSkeleton({ canManage }: Readonly<{ canManage: boolean }>) {
  return (
    <div className={LAYOUT.page} aria-busy="true">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="space-y-2">
          <Skeleton className="h-7 w-56 max-w-full" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <Skeleton className="h-5 w-64 max-w-full" />
      </div>
      <div className={LAYOUT.stack}>
        <div className={cn(LAYOUT.card, "space-y-4 px-4.5 py-4")}>
          <div className="space-y-1.5">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-3.5 w-56 max-w-full" />
          </div>
          <Skeleton className="h-64 w-full max-w-xl" />
        </div>
        <div className={LAYOUT.team}>
          <TeamPanelSkeleton canManage={canManage} />
        </div>
      </div>
    </div>
  )
}
