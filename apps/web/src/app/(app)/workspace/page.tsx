"use client"

import { useState } from "react"
import { Plus } from "lucide-react"
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
import { ApiRequestError, updateWorkspace } from "@/lib/api/client"
import {
  publishWorkspacesChanged,
  useActiveWorkspace,
  useWorkspaces,
} from "@/hooks/use-workspace"
import { useMembers } from "@/hooks/use-members"
import { useSession } from "@/hooks/use-session"
import { ROLE_LABEL } from "@/lib/roles"
import type { UpdateWorkspaceRequest, Workspace } from "@/lib/types"

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

/** The page's two columns: the team in the middle, settings on the right. */
const LAYOUT = {
  page: "mx-auto flex max-w-6xl flex-col gap-8 p-6",
  columns: "flex flex-col gap-10 lg:flex-row lg:items-start lg:gap-8",
  team: "min-w-0 flex-1 scroll-mt-6",
  settings: "flex w-full shrink-0 flex-col gap-8 lg:w-80 xl:w-96",
} as const

/**
 * One page for "this workspace": who is in it, and what it is called.
 *
 * Membership and settings are different permissions (`member:manage` and
 * `workspace:update`), so each column shows only the controls its own
 * permission grants. The old `?tab=team` address still lands here — the team is
 * the first column, so there is nothing left to switch to.
 */
export default function WorkspacePage() {
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
      <div className="p-6">
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

      <div className={LAYOUT.columns}>
        <div id="team" className={LAYOUT.team}>
          <TeamPanel
            query={members}
            canManage={canManageMembers}
            currentUserId={session?.user_id}
          />
        </div>

        <div className={LAYOUT.settings}>
          <section
            aria-labelledby="workspace-settings-heading"
            className="space-y-3"
          >
            <div className="space-y-0.5">
              <h2
                id="workspace-settings-heading"
                className="text-[15px] font-semibold"
              >
                Workspace settings
              </h2>
              <p className="text-sm text-muted-foreground">
                Everyone in this workspace sees these.
              </p>
            </div>
            <div className="rounded-lg border bg-card p-4">
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

          {canEdit ? (
            <section
              aria-labelledby="new-workspace-heading"
              className="space-y-3"
            >
              <div className="space-y-0.5">
                <h2
                  id="new-workspace-heading"
                  className="text-[15px] font-semibold"
                >
                  Another workspace
                </h2>
                <p className="text-sm text-muted-foreground">
                  Its own projects, profiles and members. It starts empty, and
                  you become its org-admin.
                </p>
              </div>
              <Button variant="outline" onClick={() => setCreatingNew(true)}>
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
        </div>
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
          className="font-semibold text-foreground tabular-nums"
          data-testid="workspace-project-count"
        >
          {projects}
        </span>{" "}
        {projects === 1 ? "project" : "projects"}
      </span>
      <span>
        <span className="font-semibold text-foreground tabular-nums">
          {members}
        </span>{" "}
        {members === 1 ? "member" : "members"}
      </span>
      <span>
        <span
          className="font-semibold text-foreground tabular-nums"
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
      <div className={LAYOUT.columns}>
        <div className={LAYOUT.team}>
          <TeamPanelSkeleton canManage={canManage} />
        </div>
        <div className={LAYOUT.settings}>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-56 max-w-full" />
            </div>
            <Skeleton className="h-80 w-full rounded-lg" />
          </div>
        </div>
      </div>
    </div>
  )
}
