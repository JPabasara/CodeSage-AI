"use client"

import { Suspense, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Building2, FolderGit2, Plus } from "lucide-react"
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
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorState } from "@/components/error-state"
import { LockedAction } from "@/components/locked-action"
import { PageHeader } from "@/components/layout/page-header"
import { CreateProfileDialog } from "@/components/profiles/create-profile-dialog"
import { ProfileCard } from "@/components/profiles/profile-card"
import {
  ProfileValueEditor,
  sameValues,
  valuesOf,
  WEIGHT_ROWS,
  type ProfileValues,
} from "@/components/profiles/profile-values"
import { ScopeRail } from "@/components/profiles/scope-rail"
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
import { useSession } from "@/hooks/use-session"
import {
  MAX_CUSTOM_PROFILES,
  type CategoryWeights,
  type ScoreProfile,
  type UpdateProfileRequest,
} from "@/lib/types"

/**
 * The permission the API checks for every write on this screen. Disabling a
 * control the caller lacks it for is a courtesy — the API re-checks on every
 * request, and a 403 is still handled below.
 */
const PROFILE_UPDATE = "profile:update"

const PERMISSION_DETAIL =
  "Your role can read profiles but not change them. An org-admin or a manager can make this change."

/** The caption on every main action this role cannot take. */
const ROLE_LOCKED_REASON = "Only org-admins and managers can change profiles"

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

/** A selection change that would drop unsent edits, held until confirmed. */
type PendingSwitch =
  | { kind: "profile"; profileId: string }
  | { kind: "scope"; projectId: string | undefined }

/**
 * Two columns on a desktop, each scrolling on its own only if it must: the
 * heading and the pool with its editor on the left, the scopes in a rail on the
 * right. Below `lg` it is one column in reading order — heading, scopes, pool —
 * and the page scrolls normally.
 */
const LAYOUT =
  "grid min-w-0 grid-cols-[minmax(0,1fr)] lg:h-full lg:grid-cols-[minmax(0,1fr)_18rem] lg:grid-rows-[auto_minmax(0,1fr)] 2xl:grid-cols-[minmax(0,1fr)_20rem]"
const HEADER_AREA =
  "min-w-0 space-y-3 px-4 pt-5 sm:px-6 lg:col-start-1 lg:row-start-1"
const RAIL_AREA =
  "min-w-0 px-4 py-4 sm:px-6 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:min-h-0 lg:overflow-y-auto lg:border-l lg:px-4 lg:py-5"
const MAIN_AREA =
  "flex min-w-0 flex-col gap-5 px-4 pb-6 sm:px-6 lg:col-start-1 lg:row-start-2 lg:min-h-0 lg:overflow-y-auto lg:py-5"
const POOL_GRID = "grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-4"

export default function ProfilesPage() {
  // useSearchParams() needs a Suspense boundary, or the build bails out of
  // prerendering the whole route.
  return (
    <Suspense fallback={<ProfilesSkeleton />}>
      <ProfilesView />
    </Suspense>
  )
}

/** The same two columns as the page, so nothing moves when it arrives. */
function ProfilesSkeleton() {
  return (
    <div className={LAYOUT} aria-busy="true">
      <div className={HEADER_AREA}>
        <div className="space-y-1">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-5 w-full max-w-md" />
        </div>
        <Skeleton className="h-7 w-72 max-w-full" />
      </div>
      <div className={RAIL_AREA}>
        <Skeleton className="mb-3 h-9 w-40" />
        <div className="flex gap-2 overflow-hidden lg:flex-col">
          {[0, 1, 2].map((i) => (
            <Skeleton
              key={i}
              className="h-17.5 w-60 shrink-0 rounded-lg lg:w-full"
            />
          ))}
        </div>
      </div>
      <div className={MAIN_AREA}>
        <div className="space-y-3">
          <Skeleton className="h-7 w-48" />
          <div className={POOL_GRID}>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-20 rounded-lg" />
            ))}
          </div>
        </div>
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    </div>
  )
}

function ProfilesView() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { data: session } = useSession()
  const {
    data: pool,
    loading: loadingPool,
    error: poolError,
    refetch: refetchPool,
    reload: reloadPool,
    update: updatePool,
  } = useProfilePool()
  const {
    data: repos,
    error: reposError,
    refetch: refetchRepos,
  } = useProjects()

  // Which scope is being configured: the workspace default, or one project's
  // own profile. It belongs to this page alone — the app bar's project is the
  // dashboard's, and here any project can be configured independently. The URL
  // carries it (`?project=<id>`) so a scope can be linked to and survives a
  // reload; a change made elsewhere to the URL, such as the rail's Profiles
  // link, is followed.
  const urlProjectId = searchParams.get("project") ?? undefined
  const [scopeId, setScopeId] = useState(urlProjectId)
  const [seenUrlProjectId, setSeenUrlProjectId] = useState(urlProjectId)
  if (seenUrlProjectId !== urlProjectId) {
    setSeenUrlProjectId(urlProjectId)
    setScopeId(urlProjectId)
  }
  // Only a connected project is a scope. Anything else — a stale link, a
  // project since removed — is the workspace default.
  const projectId =
    scopeId && repos?.some((repo) => repo.id === scopeId) ? scopeId : undefined
  // Until the project list is in, a linked project cannot be told apart from a
  // stale one, so the page waits rather than opening on the wrong scope.
  const resolvingScope = Boolean(scopeId) && !repos && !reposError

  const {
    data: projectProfile,
    loading: loadingProjectProfile,
    reload: reloadProjectProfile,
    update: updateProjectProfile,
  } = useProjectProfile(projectId)

  // Which card is selected, once the user has touched one. Until then it is
  // derived from the scope, so the page opens on the profile actually in force
  // rather than on a client-side guess that could disagree with it.
  const [touchedId, setTouchedId] = useState<string>()

  const [draft, setDraft] = useState<Draft>()

  // A different scope starts fresh: a half-made choice for one project must not
  // carry over to the next, or to the workspace default.
  const [shownProjectId, setShownProjectId] = useState(projectId)
  if (shownProjectId !== projectId) {
    setShownProjectId(projectId)
    setTouchedId(undefined)
    setDraft(undefined)
  }

  // Moves after every write that can change what a project is scored with, so
  // each project card in the rail re-reads its own.
  const [railVersion, setRailVersion] = useState(0)
  const refreshRail = () => setRailVersion((version) => version + 1)

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
  const [pendingSwitch, setPendingSwitch] = useState<PendingSwitch>()
  const [permissionNotice, setPermissionNotice] = useState<string>()

  const canManage = session?.permissions?.includes(PROFILE_UPDATE) ?? false
  const profiles = pool ?? []
  const customProfiles = profiles.filter((profile) => !profile.is_preset)
  const atLimit = customProfiles.length >= MAX_CUSTOM_PROFILES
  const workspaceDefault = profiles.find((profile) => profile.is_active)
  const effective =
    projectId && projectProfile ? projectProfile.effective : workspaceDefault
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
      setPendingSwitch({ kind: "profile", profileId })
      return
    }
    setTouchedId(profileId)
    setDraft(undefined)
  }

  /** Select a custom profile and put the cursor where an edit starts. */
  function editProfile(profileId: string) {
    const asking = dirty && profileId !== selected?.id
    selectProfile(profileId)
    // With the discard dialog up, focus belongs to the dialog.
    if (asking) return
    requestAnimationFrame(() =>
      document.getElementById("profile-name")?.focus(),
    )
  }

  /** Configure another scope. The selection and draft reset with it (above). */
  function applyScope(next: string | undefined) {
    setScopeId(next)
    router.replace(
      next ? `/profiles?project=${encodeURIComponent(next)}` : "/profiles",
      { scroll: false },
    )
  }

  /** Change scope from the rail, asking first when it would drop unsent edits. */
  function selectScope(next: string | undefined) {
    if (next === projectId) return
    if (dirty) {
      setPendingSwitch({ kind: "scope", projectId: next })
      return
    }
    applyScope(next)
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
      refreshRail()
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
      refreshRail()
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
      refreshRail()
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
      refreshRail()
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

  if (loadingPool || resolvingScope || !selected || !values) {
    return <ProfilesSkeleton />
  }

  const selectedProject = repos?.find((repo) => repo.id === projectId)
  const projectLabel = selectedProject
    ? `${selectedProject.owner}/${selectedProject.name}`
    : "This project"
  const overridden = Boolean(projectProfile && !projectProfile.inherited)
  const isDefault = selected.is_active
  const isProjectChoice = projectProfile?.override?.id === selected.id
  // The profile in force for this project. For the workspace scope that is the
  // default, which its own badge already says.
  const inUseId = projectId ? projectProfile?.effective.id : undefined

  const status = !canManage
    ? "Read-only. Changing profiles needs the manager or org-admin role."
    : selected.is_preset
      ? "Built-in profiles can't be edited. Duplicate one to change it."
      : dirty
        ? `Saving re-scores every project that uses ${selected.name}.`
        : null

  const newProfileButton = (
    <Button
      variant="outline"
      onClick={() => openCreate()}
      disabled={!canManage || atLimit}
    >
      <Plus aria-hidden="true" />
      New profile
    </Button>
  )

  const scopeAction = projectId ? (
    <Button
      variant={dirty ? "outline" : "default"}
      onClick={onAssign}
      disabled={!canManage || isProjectChoice || choosing}
    >
      {choosing ? "Applying…" : "Use for this project"}
    </Button>
  ) : (
    <Button
      variant={dirty ? "outline" : "default"}
      onClick={onSetDefault}
      disabled={!canManage || isDefault || choosing}
    >
      {choosing ? "Applying…" : "Set as workspace default"}
    </Button>
  )

  // Where a held scope change would go, for the discard dialog to name it.
  const switchRepo =
    pendingSwitch?.kind === "scope" && pendingSwitch.projectId
      ? repos?.find((repo) => repo.id === pendingSwitch.projectId)
      : undefined
  const switchTarget =
    pendingSwitch?.kind !== "scope"
      ? undefined
      : !pendingSwitch.projectId
        ? "the workspace default"
        : switchRepo
          ? `${switchRepo.owner}/${switchRepo.name}`
          : "another project"

  return (
    <div className={LAYOUT}>
      <div className={HEADER_AREA}>
        <PageHeader
          title="Profiles"
          description="Decide how much each kind of debt counts toward the health score."
        />

        {/* What is being configured, in one line. */}
        <div className="flex min-h-7 flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
          {projectId ? (
            <>
              <FolderGit2 className="size-4 shrink-0" aria-hidden="true" />
              <p data-testid="effective-summary" className="min-w-0">
                {loadingProjectProfile || !projectProfile ? (
                  "Reading this project’s profile…"
                ) : (
                  <>
                    <strong className="font-semibold text-foreground">
                      {projectLabel}
                    </strong>{" "}
                    is scored with{" "}
                    <strong className="font-semibold text-foreground">
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
          ) : (
            <>
              <Building2 className="size-4 shrink-0" aria-hidden="true" />
              <p className="min-w-0">
                The workspace default is{" "}
                <strong className="font-semibold text-foreground">
                  {workspaceDefault?.name ?? "—"}
                </strong>
                .
              </p>
            </>
          )}
        </div>
      </div>

      <ScopeRail
        className={RAIL_AREA}
        repos={repos}
        reposError={reposError}
        onRetryRepos={refetchRepos}
        workspaceDefault={workspaceDefault}
        selectedProjectId={projectId}
        current={projectProfile}
        version={railVersion}
        onSelect={selectScope}
      />

      <div className={MAIN_AREA}>
        <section aria-labelledby="pool-heading" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
              <h2 id="pool-heading" className="text-[15px] font-semibold">
                Profile pool
              </h2>
              <p className="text-xs text-muted-foreground">
                <span data-testid="custom-count" className="tabular-nums">
                  {customProfiles.length} of {MAX_CUSTOM_PROFILES}
                </span>{" "}
                custom
                {atLimit && canManage
                  ? ". Delete one before creating another."
                  : null}
              </p>
            </div>
            {!canManage ? (
              <LockedAction reason={ROLE_LOCKED_REASON}>
                {newProfileButton}
              </LockedAction>
            ) : atLimit ? (
              <LockedAction
                reason={`This workspace already has ${MAX_CUSTOM_PROFILES} custom profiles`}
              >
                {newProfileButton}
              </LockedAction>
            ) : (
              newProfileButton
            )}
          </div>

          <ul aria-label="Workspace profile pool" className={POOL_GRID}>
            {profiles.map((profile) => (
              <ProfileCard
                key={profile.id}
                profile={profile}
                selected={profile.id === selected.id}
                inUse={profile.id === inUseId}
                onSelect={() => selectProfile(profile.id)}
                onDuplicate={
                  canManage && !atLimit ? () => openCreate(profile) : undefined
                }
                onEdit={
                  canManage && !profile.is_preset
                    ? () => editProfile(profile.id)
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
        </section>

        <section
          aria-labelledby="editor-heading"
          className="rounded-lg border bg-card"
        >
          <div className="space-y-5 p-4">
            <div className="flex min-h-8 min-w-0 flex-wrap items-center gap-2">
              {editable ? (
                <>
                  <h2 id="editor-heading" className="sr-only">
                    {selected.name}
                  </h2>
                  <label htmlFor="profile-name" className="sr-only">
                    Profile name
                  </label>
                  <Input
                    id="profile-name"
                    value={name}
                    maxLength={200}
                    autoComplete="off"
                    onChange={(event) =>
                      editDraft({ name: event.target.value })
                    }
                    className="h-8 max-w-xs text-[15px] font-semibold md:text-[15px]"
                  />
                </>
              ) : (
                <h2
                  id="editor-heading"
                  className="min-w-0 truncate text-[15px] font-semibold"
                >
                  {selected.name}
                </h2>
              )}
              {dirty ? (
                <Badge variant="destructive" data-testid="unsaved-badge">
                  Unsaved changes
                </Badge>
              ) : null}
            </div>

            <ProfileValueEditor
              compact
              values={values}
              disabled={!editable}
              onChange={(next) => editDraft({ values: next })}
            />
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 border-t px-4 py-3">
            {permissionNotice ? (
              <p
                role="alert"
                className="mr-auto min-w-0 text-xs text-destructive"
              >
                {permissionNotice}
              </p>
            ) : status ? (
              <p className="mr-auto min-w-0 text-xs text-muted-foreground">
                {status}
              </p>
            ) : null}

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

            {canManage ? (
              scopeAction
            ) : (
              <LockedAction reason={ROLE_LOCKED_REASON}>
                {scopeAction}
              </LockedAction>
            )}
          </div>
        </section>
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
        open={Boolean(pendingSwitch)}
        onOpenChange={(open) => !open && setPendingSwitch(undefined)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard unsaved changes?</DialogTitle>
            <DialogDescription>
              Your edits to {selected.name} have not been saved.{" "}
              {switchTarget
                ? `Switching to ${switchTarget} loses them.`
                : "Selecting another profile loses them."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Keep editing</Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                const next = pendingSwitch
                setPendingSwitch(undefined)
                setDraft(undefined)
                if (next?.kind === "profile") setTouchedId(next.profileId)
                else if (next?.kind === "scope") applyScope(next.projectId)
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
