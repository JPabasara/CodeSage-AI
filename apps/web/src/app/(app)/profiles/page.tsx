"use client"

import { useEffect, useState } from "react"
import { Info, Layers, Plus, Sparkles } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ErrorState } from "@/components/error-state"
import { CreateProfileDialog } from "@/components/profiles/create-profile-dialog"
import { ProfileCard } from "@/components/profiles/profile-card"
import {
  ProfileValueEditor,
  sameValues,
  valuesOf,
  WEIGHT_ROWS,
  type ProfileValues,
} from "@/components/profiles/profile-values"
import {
  ApiRequestError,
  clearProjectProfile,
  createProfile,
  deleteProfile,
  setDefaultProfile,
  setProjectProfile,
  updateProfile,
} from "@/lib/api/client"
import { useProfilePool, useProjectProfile } from "@/hooks/use-profiles"
import { useProjects } from "@/hooks/use-projects"
import { useSelectedProject } from "@/hooks/use-selected-project"
import { useSession } from "@/hooks/use-session"
import {
  MAX_CUSTOM_PROFILES,
  type CategoryWeights,
  type ScoreProfile,
  type UpdateProfileRequest,
} from "@/lib/types"

/**
 * The permission the API checks for every write on this screen. Hiding a control
 * the caller lacks it for is a courtesy — the API re-checks on every request, and
 * a 403 is still handled below.
 */
const PROFILE_UPDATE = "profile:update"

const PERMISSION_DETAIL =
  "Your role can read profiles but not change them. An org-admin or a manager can make this change."

/**
 * A refusal, as a sentence. Each code is a different thing for the user to do
 * about it, which is the whole reason the contract gives them separate codes —
 * "409 Conflict" would leave all four looking like the same dead end.
 */
function messageFor(error: unknown, fallback: string): string {
  if (!(error instanceof ApiRequestError)) {
    return error instanceof Error ? error.message : fallback
  }
  if (error.status === 403) return PERMISSION_DETAIL
  switch (error.code) {
    case "PROFILE_LIMIT_REACHED":
      return `This workspace already holds ${MAX_CUSTOM_PROFILES} custom profiles. Delete one before creating another.`
    case "PROFILE_NAME_CONFLICT":
      return "Another profile in this workspace already uses that name."
    case "PROFILE_BUILT_IN":
      return "Built-in profiles cannot be changed or deleted. Duplicate one instead."
    case "PROFILE_IN_USE":
      return "This profile is the workspace default or is assigned to a project. Change those selections first."
    case "NOT_FOUND":
      return "That profile is no longer in this workspace."
    default:
      return error.detail || fallback
  }
}

/** Only what the user actually changed, which is what PATCH is for. */
function patchFor(
  profile: ScoreProfile,
  name: string,
  values: ProfileValues,
): UpdateProfileRequest {
  const patch: UpdateProfileRequest = {}
  if (name.trim() !== profile.name) patch.name = name.trim()
  if (Math.abs(values.trust_s - profile.trust_s) > 1e-9) {
    patch.trust_s = values.trust_s
  }
  const weights: Partial<CategoryWeights> = {}
  for (const { key } of WEIGHT_ROWS) {
    if (Math.abs(values.weights[key] - profile.weights[key]) > 1e-9) {
      weights[key] = values.weights[key]
    }
  }
  if (Object.keys(weights).length > 0) patch.weights = weights
  return patch
}

/** The draft edits to one profile, before Save sends them. */
interface Draft {
  profileId: string
  name: string
  values: ProfileValues
}

type Mode = "workspace" | "project"

export default function ProfilesPage() {
  const { data: session } = useSession()
  const {
    data: pool,
    loading: loadingPool,
    error: poolError,
    refetch: refetchPool,
    reload: reloadPool,
    update: updatePool,
  } = useProfilePool()
  const { data: repos } = useProjects()

  // The project this page opens on is the one the rest of the app is on, but
  // choosing another here is a local act: someone comparing overrides should not
  // find the dashboard has moved under them.
  const { selectedProjectId } = useSelectedProject({
    availableRepoIds: repos?.map((repo) => repo.id),
  })
  const [pickedProjectId, setPickedProjectId] = useState<string>()
  const projectId =
    pickedProjectId && repos?.some((repo) => repo.id === pickedProjectId)
      ? pickedProjectId
      : selectedProjectId
  const {
    data: projectProfile,
    loading: loadingProjectProfile,
    reload: reloadProjectProfile,
    update: updateProjectProfile,
  } = useProjectProfile(projectId)

  const [mode, setMode] = useState<Mode>("workspace")
  // Which card is selected, once the user has touched one. Until then it is
  // derived from the context below, so the page opens on the profile actually in
  // force rather than on a client-side guess that could disagree with it.
  const [touchedId, setTouchedId] = useState<string>()
  const [draft, setDraft] = useState<Draft>()

  const [saving, setSaving] = useState(false)
  const [choosing, setChoosing] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [creating, setCreating] = useState(false)
  const [deletingId, setDeletingId] = useState<string>()

  const [createSeed, setCreateSeed] = useState<{
    name: string
    values: ProfileValues
  }>()
  const [createError, setCreateError] = useState<string>()
  const [pendingDelete, setPendingDelete] = useState<ScoreProfile>()
  const [deleteError, setDeleteError] = useState<string>()
  const [discardTo, setDiscardTo] = useState<string>()
  const [permissionNotice, setPermissionNotice] = useState<string>()

  const canManage = session?.permissions?.includes(PROFILE_UPDATE) ?? false
  const profiles = pool ?? []
  const customProfiles = profiles.filter((profile) => !profile.is_preset)
  const atLimit = customProfiles.length >= MAX_CUSTOM_PROFILES
  const workspaceDefault = profiles.find((profile) => profile.is_active)
  const effective =
    mode === "project" && projectProfile
      ? projectProfile.effective
      : workspaceDefault
  const selected =
    profiles.find((profile) => profile.id === touchedId) ?? effective
  const editable = Boolean(selected && !selected.is_preset && canManage)

  const values =
    draft && selected && draft.profileId === selected.id
      ? draft.values
      : selected
        ? valuesOf(selected)
        : undefined
  const name =
    draft && selected && draft.profileId === selected.id
      ? draft.name
      : (selected?.name ?? "")
  const dirty = Boolean(
    selected &&
    draft &&
    draft.profileId === selected.id &&
    (draft.name.trim() !== selected.name ||
      !sameValues(draft.values, valuesOf(selected))),
  )

  // The browser's own warning, which is the only one that survives a tab close.
  // Nothing global is intercepted: in-app navigation away from an edit that has
  // not been sent loses a draft, not stored data.
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [dirty])

  function editDraft(next: Partial<Omit<Draft, "profileId">>) {
    if (!selected || !values) return
    setDraft({
      profileId: selected.id,
      name: next.name ?? name,
      values: next.values ?? values,
    })
  }

  /** Move the selection, asking first when it would drop unsent edits. */
  function selectProfile(profileId: string) {
    if (profileId === selected?.id) return
    if (dirty) {
      setDiscardTo(profileId)
      return
    }
    setTouchedId(profileId)
    setDraft(undefined)
  }

  /** One profile has changed on the server: show it, then reconcile the rest. */
  function adopt(saved: ScoreProfile) {
    updatePool((current) =>
      (current ?? []).map((profile) =>
        profile.id === saved.id ? saved : profile,
      ),
    )
    // `usage_count`, and which row carries the default, are facts about the pool
    // that only the server can recompute.
    reloadPool()
  }

  function refuse(error: unknown, fallback: string) {
    const detail = messageFor(error, fallback)
    if (error instanceof ApiRequestError && error.status === 403) {
      setPermissionNotice(detail)
    }
    toast.error(detail)
  }

  async function onSaveEdits() {
    if (!selected || !values || !dirty) return
    const patch = patchFor(selected, name, values)
    setSaving(true)
    try {
      const saved = await updateProfile(selected.id, patch)
      // The server clamps rather than rejecting, so the draft is replaced by
      // what was really stored instead of by what we sent.
      adopt(saved)
      setDraft(undefined)
      setPermissionNotice(undefined)
      toast.success(`Saved ${saved.name}`)
      if (projectId) reloadProjectProfile()
    } catch (error) {
      refuse(error, "Couldn't save that profile.")
    } finally {
      setSaving(false)
    }
  }

  async function onSetDefault() {
    if (!selected) return
    setChoosing(true)
    try {
      const saved = await setDefaultProfile(selected.id)
      adopt(saved)
      setPermissionNotice(undefined)
      toast.success(`${saved.name} is now the workspace default`)
      if (projectId) reloadProjectProfile()
    } catch (error) {
      refuse(error, "Couldn't change the workspace default.")
    } finally {
      setChoosing(false)
    }
  }

  async function onAssign() {
    if (!selected || !projectId) return
    setChoosing(true)
    try {
      const saved = await setProjectProfile(projectId, selected.id)
      updateProjectProfile(() => saved)
      reloadPool()
      setPermissionNotice(undefined)
      toast.success(`This project now uses ${saved.effective.name}`)
    } catch (error) {
      refuse(error, "Couldn't set this project's profile.")
    } finally {
      setChoosing(false)
    }
  }

  async function onClearOverride() {
    if (!projectId) return
    setClearing(true)
    try {
      const saved = await clearProjectProfile(projectId)
      updateProjectProfile(() => saved)
      setTouchedId(undefined)
      setDraft(undefined)
      reloadPool()
      setPermissionNotice(undefined)
      toast.success(`Back to the workspace default, ${saved.effective.name}`)
    } catch (error) {
      refuse(error, "Couldn't clear this project's override.")
    } finally {
      setClearing(false)
    }
  }

  async function onCreate(newName: string, newValues: ProfileValues) {
    setCreating(true)
    setCreateError(undefined)
    try {
      const created = await createProfile({
        name: newName,
        weights: newValues.weights,
        trust_s: newValues.trust_s,
      })
      updatePool((current) => [...(current ?? []), created])
      reloadPool()
      setTouchedId(created.id)
      setDraft(undefined)
      setCreateSeed(undefined)
      setPermissionNotice(undefined)
      toast.success(`Created ${created.name}`)
    } catch (error) {
      // Kept in the dialog rather than a toast: the name that clashed is still
      // on screen and is what has to change.
      setCreateError(messageFor(error, "Couldn't create that profile."))
    } finally {
      setCreating(false)
    }
  }

  async function onDelete() {
    if (!pendingDelete) return
    setDeletingId(pendingDelete.id)
    setDeleteError(undefined)
    try {
      await deleteProfile(pendingDelete.id)
      updatePool((current) =>
        (current ?? []).filter((profile) => profile.id !== pendingDelete.id),
      )
      reloadPool()
      if (touchedId === pendingDelete.id) setTouchedId(undefined)
      if (draft?.profileId === pendingDelete.id) setDraft(undefined)
      toast.success(`Deleted ${pendingDelete.name}`)
      setPendingDelete(undefined)
    } catch (error) {
      // The dialog stays open: an in-use profile is still there, and the next
      // step is to move the references, not to press Delete again.
      setDeleteError(messageFor(error, "Couldn't delete that profile."))
      if (error instanceof ApiRequestError && error.status === 403) {
        setPermissionNotice(PERMISSION_DETAIL)
      }
    } finally {
      setDeletingId(undefined)
    }
  }

  function openCreate(seed?: ScoreProfile) {
    setCreateError(undefined)
    setCreateSeed({
      name: seed ? `${seed.name} copy` : "",
      values: seed
        ? valuesOf(seed)
        : (values ?? { weights: DEFAULT_WEIGHTS, trust_s: 0.5 }),
    })
  }

  if (poolError) {
    return (
      <div className="p-6">
        <ErrorState
          title="Couldn’t load the profile pool"
          detail={poolError.message}
          onRetry={refetchPool}
        />
      </div>
    )
  }

  if (loadingPool || !selected || !values) {
    return (
      <div className="mx-auto max-w-5xl space-y-4 p-6">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  const selectedProject = repos?.find((repo) => repo.id === projectId)
  const overridden = Boolean(projectProfile && !projectProfile.inherited)
  const isDefault = selected.is_active
  const isProjectChoice = projectProfile?.override?.id === selected.id

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6 pb-28">
      <header className="flex flex-col gap-4 rounded-lg border bg-card p-5 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-primary">
            Workspace
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Profiles</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            A profile is six numbers: how much each kind of debt counts, and how
            far to trust the rules over the model. Every project is scored with
            the workspace default unless you give it one of its own. Nothing
            here starts a scan — scores are re-derived from snapshots you
            already have.
          </p>
        </div>

        <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-3 lg:min-w-[24rem]">
          <span className="inline-flex items-center gap-2 rounded-md border bg-background px-3 py-2">
            <Layers className="size-4 text-primary" aria-hidden="true" />
            <span>
              <strong className="block text-sm text-foreground">
                {profiles.length}
              </strong>
              In the pool
            </span>
          </span>
          <span className="inline-flex items-center gap-2 rounded-md border bg-background px-3 py-2">
            <Sparkles className="size-4 text-primary" aria-hidden="true" />
            <span>
              <strong
                className="block text-sm text-foreground"
                data-testid="custom-count"
              >
                {customProfiles.length} of {MAX_CUSTOM_PROFILES}
              </strong>
              Custom
            </span>
          </span>
          <span className="inline-flex min-w-0 items-center gap-2 rounded-md border bg-background px-3 py-2">
            <Info className="size-4 text-primary" aria-hidden="true" />
            <span className="min-w-0">
              <strong
                className="block truncate text-sm text-foreground"
                data-testid="workspace-default-name"
              >
                {workspaceDefault?.name ?? "—"}
              </strong>
              Default
            </span>
          </span>
        </div>
      </header>

      {!canManage ? (
        <p
          role="status"
          className="rounded-md border border-dashed px-4 py-3 text-sm text-muted-foreground"
        >
          You can read every profile in this workspace. Changing them needs the
          manager or org-admin role.
        </p>
      ) : null}

      <Tabs
        value={mode}
        onValueChange={(next) => {
          setMode(next as Mode)
          // The selection is context-dependent: carrying it across would leave
          // the editor showing a profile neither context is actually using.
          setTouchedId(undefined)
          setDraft(undefined)
        }}
      >
        <TabsList aria-label="What this change applies to">
          <TabsTrigger value="workspace">Workspace default</TabsTrigger>
          <TabsTrigger value="project">Project profile</TabsTrigger>
        </TabsList>

        <TabsContent value="workspace" className="pt-4">
          <p className="text-sm text-muted-foreground">
            The workspace default is in force for every project that has no
            profile of its own. It is currently{" "}
            <strong className="text-foreground">
              {workspaceDefault?.name ?? "—"}
            </strong>
            .
          </p>
        </TabsContent>

        <TabsContent value="project" className="space-y-3 pt-4">
          {/* The selector waits for the project list rather than rendering
              empty and filling in: a <Select> that starts with no value and
              acquires one has switched from uncontrolled to controlled, which
              React warns about and which loses a keyboard selection made in
              between. */}
          {!repos ? (
            <Skeleton className="h-9 w-64" />
          ) : repos.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Connect a repository first — a project override needs a project.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <label
                  htmlFor="profile-project"
                  className="text-sm font-medium"
                >
                  Project
                </label>
                <Select
                  value={projectId ?? ""}
                  onValueChange={(next) => {
                    setPickedProjectId(next)
                    setTouchedId(undefined)
                    setDraft(undefined)
                  }}
                >
                  <SelectTrigger
                    id="profile-project"
                    className="w-64"
                    aria-label="Project"
                  >
                    <SelectValue placeholder="Choose a project" />
                  </SelectTrigger>
                  <SelectContent>
                    {(repos ?? []).map((repo) => (
                      <SelectItem key={repo.id} value={repo.id}>
                        {repo.owner}/{repo.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* The effective-profile summary: what this project is scored
                  with, and whether that is inherited or its own choice. */}
              <p
                className="text-sm text-muted-foreground"
                data-testid="effective-summary"
              >
                {loadingProjectProfile || !projectProfile ? (
                  "Reading this project’s profile…"
                ) : (
                  <>
                    <strong className="text-foreground">
                      {selectedProject
                        ? `${selectedProject.owner}/${selectedProject.name}`
                        : "This project"}
                    </strong>{" "}
                    is scored with{" "}
                    <strong className="text-foreground">
                      {projectProfile.effective.name}
                    </strong>
                    {projectProfile.inherited
                      ? ", inherited from the workspace default."
                      : ", an override for this project alone."}
                  </>
                )}
              </p>

              {overridden && canManage ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onClearOverride}
                  disabled={clearing}
                >
                  {clearing ? "Clearing…" : "Clear override"}
                </Button>
              ) : null}
            </>
          )}
        </TabsContent>
      </Tabs>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold">Workspace profile pool</h2>
            <p className="text-sm text-muted-foreground">
              Three built-ins, plus up to {MAX_CUSTOM_PROFILES} profiles of your
              own. Built-ins do not count toward that limit.
            </p>
          </div>
          {canManage ? (
            <Button
              size="sm"
              onClick={() => openCreate()}
              disabled={atLimit}
              title={
                atLimit
                  ? `This workspace already holds ${MAX_CUSTOM_PROFILES} custom profiles.`
                  : undefined
              }
            >
              <Plus aria-hidden="true" />
              New profile
            </Button>
          ) : null}
        </div>

        {atLimit && canManage ? (
          <p role="status" className="text-sm text-muted-foreground">
            {customProfiles.length} of {MAX_CUSTOM_PROFILES} custom profiles
            used. Delete one before creating another.
          </p>
        ) : null}

        <ul
          aria-label="Workspace profile pool"
          className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
        >
          {profiles.map((profile) => (
            <ProfileCard
              key={profile.id}
              profile={profile}
              selected={profile.id === selected.id}
              onSelect={() => selectProfile(profile.id)}
              onDuplicate={
                canManage && !atLimit ? () => openCreate(profile) : undefined
              }
              onEdit={
                canManage && !profile.is_preset
                  ? () => selectProfile(profile.id)
                  : undefined
              }
              onDelete={
                canManage && !profile.is_preset
                  ? () => {
                      setDeleteError(undefined)
                      setPendingDelete(profile)
                    }
                  : undefined
              }
              busy={deletingId === profile.id}
            />
          ))}
        </ul>

        {customProfiles.length === 0 ? (
          <p className="rounded-md border border-dashed px-4 py-3 text-sm text-muted-foreground">
            No custom profiles yet.{" "}
            {canManage
              ? "Duplicate a built-in, move its sliders, and give it a name — it joins the pool without becoming the default."
              : "A manager or org-admin can add up to five for this workspace."}
          </p>
        ) : null}
      </section>

      <section className="space-y-4 rounded-lg border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">
              {selected.name}
              {isDefault ? (
                <Badge className="ml-2 align-middle">Workspace default</Badge>
              ) : null}
            </h2>
            <p className="text-sm text-muted-foreground">
              {selected.is_preset
                ? "Built-in profiles are read-only. Duplicate this one to change its numbers."
                : editable
                  ? "Editing these numbers re-scores every project that uses this profile."
                  : "Read-only for your role."}
            </p>
          </div>
          {dirty ? (
            <Badge variant="destructive" data-testid="unsaved-badge">
              Unsaved changes
            </Badge>
          ) : null}
        </div>

        {editable ? (
          <div className="max-w-sm space-y-2">
            <label htmlFor="profile-name" className="text-sm font-medium">
              Name
            </label>
            <Input
              id="profile-name"
              value={name}
              maxLength={200}
              autoComplete="off"
              onChange={(event) => editDraft({ name: event.target.value })}
            />
          </div>
        ) : null}

        <ProfileValueEditor
          values={values}
          disabled={!editable}
          onChange={(next) => editDraft({ values: next })}
        />
      </section>

      {permissionNotice ? (
        <p role="alert" className="text-sm text-destructive">
          {permissionNotice}
        </p>
      ) : null}

      {/* The action area stays reachable: this page is taller than a screen once
          six sliders and a pool of cards are on it. */}
      <div className="sticky bottom-0 -mx-6 flex flex-wrap items-center gap-2 border-t bg-background/95 px-6 py-3 backdrop-blur">
        <span className="mr-auto min-w-0 text-xs text-muted-foreground">
          {dirty
            ? "Unsaved changes to this profile."
            : mode === "workspace"
              ? isDefault
                ? `${selected.name} is the workspace default.`
                : `${selected.name} is selected.`
              : isProjectChoice
                ? `${selected.name} is this project’s profile.`
                : `${selected.name} is selected.`}
        </span>

        {editable ? (
          <>
            <Button
              variant="outline"
              onClick={() => setDraft(undefined)}
              disabled={!dirty || saving}
            >
              Discard
            </Button>
            <Button onClick={onSaveEdits} disabled={!dirty || saving}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </>
        ) : null}

        {canManage && mode === "workspace" ? (
          <Button
            variant={dirty ? "outline" : "default"}
            onClick={onSetDefault}
            disabled={isDefault || choosing}
          >
            {choosing ? "Applying…" : "Set as workspace default"}
          </Button>
        ) : null}

        {canManage && mode === "project" && projectId ? (
          <Button
            variant={dirty ? "outline" : "default"}
            onClick={onAssign}
            disabled={isProjectChoice || choosing}
          >
            {choosing ? "Applying…" : "Use for this project"}
          </Button>
        ) : null}
      </div>

      {createSeed ? (
        <CreateProfileDialog
          open
          onOpenChange={(next) => {
            if (!next) setCreateSeed(undefined)
          }}
          seedName={createSeed.name}
          seedValues={createSeed.values}
          customCount={customProfiles.length}
          busy={creating}
          error={createError}
          onCreate={onCreate}
        />
      ) : null}

      <Dialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDelete(undefined)
            setDeleteError(undefined)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {pendingDelete?.name}?</DialogTitle>
            <DialogDescription>
              This removes {pendingDelete?.name} from the workspace pool. Only a
              profile no project uses, and that is not the workspace default,
              can be deleted.
              {pendingDelete && pendingDelete.usage_count > 0
                ? ` ${pendingDelete.usage_count} ${
                    pendingDelete.usage_count === 1 ? "project" : "projects"
                  } currently use it.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          {deleteError ? (
            <p role="alert" className="text-sm text-destructive">
              {deleteError}
            </p>
          ) : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              variant="destructive"
              disabled={Boolean(deletingId)}
              onClick={onDelete}
            >
              {deletingId ? "Deleting…" : "Delete profile"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(discardTo)}
        onOpenChange={(open) => !open && setDiscardTo(undefined)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard unsaved changes?</DialogTitle>
            <DialogDescription>
              Your edits to {selected.name} have not been saved. Selecting
              another profile loses them.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Keep editing</Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                setDraft(undefined)
                setTouchedId(discardTo)
                setDiscardTo(undefined)
              }}
            >
              Discard changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** Only reached before the pool has loaded, which the skeleton covers. */
const DEFAULT_WEIGHTS: CategoryWeights = {
  security: 1,
  code_design: 1,
  requirement: 1,
  documentation: 1,
  test: 1,
}
