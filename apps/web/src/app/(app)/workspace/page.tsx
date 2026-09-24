"use client"

import { Suspense, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Building2, FolderGit2, Mail, Plus, Users } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ErrorState } from "@/components/error-state"
import {
  WorkspaceForm,
  workspaceBody,
  type WorkspaceFields,
} from "@/components/workspace/workspace-form"
import { TeamPanel } from "@/components/workspace/team-panel"
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

type WorkspaceTab = "settings" | "team"

export default function WorkspacePage() {
  // useSearchParams() needs a Suspense boundary, or the build bails out of
  // prerendering the whole route.
  return (
    <Suspense fallback={<Skeleton className="m-6 h-64" />}>
      <WorkspaceView />
    </Suspense>
  )
}

function WorkspaceView() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const tab: WorkspaceTab =
    searchParams.get("tab") === "team" ? "team" : "settings"
  const members = useMembers()
  const { data: session } = useSession()
  const { data: workspaces, loading, error, refetch, reload } = useWorkspaces()
  const active = useActiveWorkspace(workspaces)

  const [draft, setDraft] = useState<WorkspaceFields>()
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string>()

  const [creatingNew, setCreatingNew] = useState(false)

  // Settings and Team share one page but not one panel: membership is a
  // different permission from workspace settings, so each tab shows only the
  // controls that tab's permission grants. `?tab=team` makes Team linkable.
  const canEdit = session?.permissions?.includes("workspace:update") ?? false
  const canManageMembers =
    session?.permissions?.includes("member:manage") ?? false

  function onTabChange(next: string) {
    router.replace(next === "team" ? "/workspace?tab=team" : "/workspace", {
      scroll: false,
    })
  }
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
      // And every other consumer — the rail's switcher names this workspace too.
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
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-6">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-4 rounded-lg border bg-card p-5 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-primary">
            Workspace
          </p>
          <h1 className="truncate text-2xl font-semibold tracking-tight">
            {active.name}
          </h1>
          <p className="text-sm text-muted-foreground">
            You are{" "}
            <Badge variant="secondary" className="align-middle">
              {ROLE_LABEL[active.role] ?? active.role}
            </Badge>{" "}
            here. Projects, profiles and teammates all belong to this workspace.
          </p>
        </div>

        <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-3 lg:min-w-[22rem]">
          <span className="inline-flex items-center gap-2 rounded-md border bg-background px-3 py-2">
            <FolderGit2 className="size-4 text-primary" aria-hidden="true" />
            <span>
              <strong
                className="block text-sm text-foreground"
                data-testid="workspace-project-count"
              >
                {active.project_count ?? 0}
              </strong>
              Projects
            </span>
          </span>
          <span className="inline-flex items-center gap-2 rounded-md border bg-background px-3 py-2">
            <Users className="size-4 text-primary" aria-hidden="true" />
            <span>
              <strong className="block text-sm text-foreground">
                {active.member_count ?? 0}
              </strong>
              Members
            </span>
          </span>
          <span className="inline-flex items-center gap-2 rounded-md border bg-background px-3 py-2">
            <Mail className="size-4 text-primary" aria-hidden="true" />
            <span>
              <strong
                className="block text-sm text-foreground"
                data-testid="workspace-invitation-count"
              >
                {members.data?.pending_invitations.length ?? "–"}
              </strong>
              Invited
            </span>
          </span>
        </div>
      </header>

      <Tabs value={tab} onValueChange={onTabChange} className="gap-6">
        <TabsList>
          <TabsTrigger value="settings">Settings</TabsTrigger>
          <TabsTrigger value="team">Team</TabsTrigger>
        </TabsList>

        <TabsContent value="team">
          <TeamPanel
            query={members}
            canManage={canManageMembers}
            currentUserId={session?.user_id}
          />
        </TabsContent>

        <TabsContent value="settings" className="flex flex-col gap-6">
          <section className="space-y-4 rounded-lg border bg-card p-5 shadow-sm">
            <div>
              <h2 className="text-base font-semibold">Settings</h2>
              <p className="text-sm text-muted-foreground">
                {canEdit
                  ? "Everyone in this workspace sees this name."
                  : "Only an org-admin can change these. You can read them."}
              </p>
            </div>

            <WorkspaceForm
              values={values}
              onChange={setDraft}
              onSubmit={onSave}
              busy={saving}
              error={saveError}
              disabled={!canEdit}
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
          </section>

          {canEdit ? (
            <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed p-5">
              <div className="min-w-0">
                <h2 className="text-base font-semibold">Another workspace</h2>
                <p className="text-sm text-muted-foreground">
                  A separate set of projects, profiles and members. You become
                  its org-admin, and it starts empty.
                </p>
              </div>
              <Button onClick={() => setCreatingNew(true)}>
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

          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Building2 className="size-3.5" aria-hidden="true" />
            Switch workspace from the selector at the top of the navigation
            rail.
          </p>
        </TabsContent>
      </Tabs>
    </div>
  )
}
