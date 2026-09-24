"use client"

import { useId, useState } from "react"
import { Send, UserMinus, X } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
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
import { ErrorState } from "@/components/error-state"
import {
  ApiRequestError,
  changeMemberRole,
  createInvitation,
  deactivateMember,
  revokeInvitation,
} from "@/lib/api/client"
import { publishWorkspacesChanged } from "@/hooks/use-workspace"
import { ROLE_LABEL, ROLES } from "@/lib/roles"
import { cn } from "@/lib/utils"
import type { Invitation, Member, MemberList, Role } from "@/lib/types"
import type { MutableQueryState } from "@/hooks/use-query"

/**
 * Roles an invitation may carry. Org-admin is deliberately left out: admin
 * rights go to someone who has already joined and is known, by promotion — not
 * to whoever ends up holding an emailed link.
 */
const INVITE_ROLES: Role[] = ["manager", "developer", "viewer"]

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** A provider may share neither a name nor an email; the row still needs a label. */
export const displayName = (m: Pick<Member, "name" | "email">) =>
  m.name?.trim() || m.email || "Unnamed member"

const initials = (label: string) =>
  label
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "?"

const STATUS_LABEL: Record<Member["status"], string> = {
  active: "Active",
  inactive: "Deactivated",
  invited: "Invited",
}

/**
 * The member and invitation lists share one set of columns — who, role, and
 * (for an org-admin) an action — so the two read as one table. The columns
 * follow the width of the panel, not the window: at a narrow width the row
 * stacks, and the role and action move under the name.
 */
const COLUMNS = {
  manage:
    "grid-cols-[minmax(0,1fr)_auto] @md:grid-cols-[minmax(0,1fr)_9rem_6.5rem]",
  read: "grid-cols-[minmax(0,1fr)_auto] @md:grid-cols-[minmax(0,1fr)_9rem]",
} as const

const HEADER_COLUMNS = {
  manage: "@md:grid-cols-[minmax(0,1fr)_9rem_6.5rem]",
  read: "@md:grid-cols-[minmax(0,1fr)_9rem]",
} as const

/** A failed member write, in words — 403 and 409 each say what to do next. */
function memberError(caught: unknown, target: string): string {
  if (!(caught instanceof ApiRequestError)) return "Something went wrong."
  if (caught.status === 403) return "Only an org-admin can manage members."
  if (caught.status === 404) return `${target} is no longer in this workspace.`
  if (caught.status === 409) {
    return `${target} is the only active org-admin. Make someone else an org-admin first.`
  }
  return caught.detail
}

function inviteError(caught: unknown): { message: string; delivery: boolean } {
  if (!(caught instanceof ApiRequestError)) {
    return { message: "Couldn't send that invitation.", delivery: false }
  }
  if (caught.code === "UPSTREAM_UNAVAILABLE" || caught.status === 503) {
    return {
      message:
        "The invitation email couldn't be sent, so no invitation was created. Try again in a moment.",
      delivery: true,
    }
  }
  if (caught.status === 409) {
    return {
      message: "That address is already a member or already has an invitation.",
      delivery: false,
    }
  }
  if (caught.status === 403) {
    return { message: "Only an org-admin can invite members.", delivery: false }
  }
  if (caught.code === "VALIDATION_FAILED") {
    return { message: "Enter a valid email address.", delivery: false }
  }
  return { message: caught.detail, delivery: false }
}

/**
 * Who is in the workspace, and — for an org-admin — the controls to change it.
 *
 * Everyone can read the list. Only `member:manage` renders the invite form, the
 * role pickers, Deactivate and Revoke; the API refuses them anyway, so hiding
 * them is about not offering what cannot work.
 *
 * Your own row is always read-only. The API would let one of two org-admins
 * demote themselves, but doing it from here would pull the page out from under
 * the person using it — another org-admin changes your role.
 */
export function TeamPanel({
  query,
  canManage,
  currentUserId,
}: Readonly<{
  query: MutableQueryState<MemberList>
  canManage: boolean
  currentUserId?: string
}>) {
  const { data, loading, error, reload, refetch } = query
  const [busyId, setBusyId] = useState<string>()
  const [confirming, setConfirming] = useState<Member>()

  function afterWrite() {
    reload()
    // The member count on the header and the switcher come from the summary.
    publishWorkspacesChanged()
  }

  async function onRoleChange(member: Member, role: Role) {
    if (role === member.role) return
    setBusyId(member.membership_id)
    try {
      await changeMemberRole(member.membership_id, role)
      toast.success(`${displayName(member)} is now ${ROLE_LABEL[role]}`)
      afterWrite()
    } catch (caught) {
      toast.error(memberError(caught, displayName(member)))
      reload()
    } finally {
      setBusyId(undefined)
    }
  }

  async function onDeactivate(member: Member) {
    setBusyId(member.membership_id)
    try {
      await deactivateMember(member.membership_id)
      toast.success(`${displayName(member)} was deactivated`)
      setConfirming(undefined)
      afterWrite()
    } catch (caught) {
      toast.error(memberError(caught, displayName(member)))
      setConfirming(undefined)
      reload()
    } finally {
      setBusyId(undefined)
    }
  }

  async function onRevoke(invitationId: string, email: string) {
    setBusyId(invitationId)
    try {
      await revokeInvitation(invitationId)
      toast.success(`Invitation to ${email} revoked`)
      afterWrite()
    } catch (caught) {
      toast.error(
        caught instanceof ApiRequestError && caught.status === 404
          ? "That invitation was already accepted, revoked or expired."
          : memberError(caught, email),
      )
      reload()
    } finally {
      setBusyId(undefined)
    }
  }

  if (error) {
    return (
      <ErrorState
        title="Couldn’t load the team"
        detail={error.message}
        onRetry={refetch}
      />
    )
  }

  if (loading || !data) {
    return <TeamPanelSkeleton canManage={canManage} />
  }

  const members = [...data.members].sort(
    (a, b) =>
      Number(b.user_id === currentUserId) -
        Number(a.user_id === currentUserId) ||
      Number(a.status !== "active") - Number(b.status !== "active"),
  )
  const mode = canManage ? "manage" : "read"

  return (
    <div className="@container flex flex-col gap-8">
      {canManage ? <InviteForm onInvited={afterWrite} /> : null}

      <section aria-labelledby="team-members-heading" className="space-y-3">
        <div className="space-y-0.5">
          <h2 id="team-members-heading" className="text-[15px] font-semibold">
            Members
          </h2>
          <p className="text-sm text-muted-foreground">
            {canManage
              ? "Change a role or deactivate someone. Another org-admin manages your own row."
              : "Only org-admins can change members."}
          </p>
        </div>

        <div className="overflow-hidden rounded-lg border bg-card">
          <ColumnHeader mode={mode} first="Member" />
          <ul className="divide-y" data-testid="member-list">
            {members.map((member) => {
              const label = displayName(member)
              const isSelf = member.user_id === currentUserId
              const editable =
                canManage && !isSelf && member.status === "active"
              return (
                <li
                  key={member.membership_id}
                  className={cn(
                    "grid items-center gap-x-4 gap-y-2 px-4 py-3",
                    COLUMNS[mode],
                  )}
                  data-testid="member-row"
                >
                  <div
                    className={cn(
                      "flex min-w-0 items-center gap-3",
                      editable && "col-span-2 @md:col-span-1",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
                    >
                      {initials(label)}
                    </span>
                    <div className="min-w-0">
                      <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
                        <span className="truncate" title={label}>
                          {label}
                        </span>
                        {isSelf ? <Badge variant="outline">You</Badge> : null}
                        {member.status !== "active" ? (
                          <Badge variant="secondary">
                            {STATUS_LABEL[member.status]}
                          </Badge>
                        ) : null}
                      </p>
                      <p
                        className="truncate text-xs text-muted-foreground"
                        title={member.email ?? undefined}
                      >
                        {member.email ?? "No email shared"}
                      </p>
                    </div>
                  </div>

                  {editable ? (
                    <>
                      <Select
                        value={member.role}
                        onValueChange={(role) =>
                          onRoleChange(member, role as Role)
                        }
                        disabled={busyId === member.membership_id}
                      >
                        <SelectTrigger
                          className="w-36"
                          aria-label={`Role for ${label}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ROLES.map((role) => (
                            <SelectItem key={role} value={role}>
                              {ROLE_LABEL[role]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <div className="flex justify-end">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setConfirming(member)}
                          disabled={busyId === member.membership_id}
                          aria-label={`Deactivate ${label}`}
                        >
                          <UserMinus aria-hidden="true" />
                          Deactivate
                        </Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <span className="justify-self-end text-sm text-muted-foreground @md:justify-self-auto">
                        {ROLE_LABEL[member.role] ?? member.role}
                      </span>
                      {canManage ? (
                        <span aria-hidden="true" className="hidden @md:block" />
                      ) : null}
                    </>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      </section>

      <section aria-labelledby="team-invitations-heading" className="space-y-3">
        <h2 id="team-invitations-heading" className="text-[15px] font-semibold">
          Pending invitations
        </h2>
        <div className="overflow-hidden rounded-lg border bg-card">
          {data.pending_invitations.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">
              No one is waiting to join.
            </p>
          ) : (
            <>
              <ColumnHeader mode={mode} first="Email" />
              <ul className="divide-y" data-testid="invitation-list">
                {data.pending_invitations.map((invitation) => (
                  <InvitationRow
                    key={invitation.invitation_id}
                    invitation={invitation}
                    mode={mode}
                    busy={busyId === invitation.invitation_id}
                    onRevoke={
                      canManage
                        ? () =>
                            onRevoke(invitation.invitation_id, invitation.email)
                        : undefined
                    }
                  />
                ))}
              </ul>
            </>
          )}
        </div>
      </section>

      <Dialog
        open={Boolean(confirming)}
        onOpenChange={(open) => {
          if (!open) setConfirming(undefined)
        }}
      >
        <DialogContent className="sm:max-w-md">
          {confirming ? (
            <>
              <DialogHeader>
                <DialogTitle>Deactivate {displayName(confirming)}?</DialogTitle>
                <DialogDescription>
                  They lose access to this workspace straight away. Their past
                  scans stay. An org-admin can invite them again later.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setConfirming(undefined)}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => onDeactivate(confirming)}
                  disabled={busyId === confirming.membership_id}
                >
                  Deactivate {displayName(confirming)}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}

/**
 * The column labels over a list. Only drawn once the panel is wide enough for
 * columns; each row already says what its cells are to a screen reader, so the
 * labels are visual only.
 */
function ColumnHeader({
  mode,
  first,
}: Readonly<{ mode: keyof typeof COLUMNS; first: string }>) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "hidden gap-x-4 border-b bg-muted/40 px-4 py-2 text-xs text-muted-foreground @md:grid",
        HEADER_COLUMNS[mode],
      )}
    >
      <span>{first}</span>
      <span>Role</span>
      {mode === "manage" ? <span /> : null}
    </div>
  )
}

function InvitationRow({
  invitation,
  mode,
  busy,
  onRevoke,
}: Readonly<{
  invitation: Invitation
  mode: keyof typeof COLUMNS
  busy: boolean
  /** Absent for a role that may not revoke. */
  onRevoke?: () => void
}>) {
  const role = ROLE_LABEL[invitation.role] ?? invitation.role
  const expires = new Date(invitation.expires_at)
  return (
    <li
      className={cn(
        "grid items-center gap-x-4 gap-y-1 px-4 py-3",
        COLUMNS[mode],
      )}
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-medium" title={invitation.email}>
          {invitation.email}
        </p>
        <p className="text-xs text-muted-foreground">
          {/* Narrow: the role has no column of its own, so it rides here. */}
          <span className="@md:hidden">{role} · </span>
          Expires{" "}
          <time
            dateTime={invitation.expires_at}
            title={expires.toLocaleString(undefined, {
              dateStyle: "long",
              timeStyle: "short",
            })}
            className="tabular-nums"
          >
            {expires.toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })}
          </time>
        </p>
      </div>
      <span className="hidden text-sm text-muted-foreground @md:block">
        {role}
      </span>
      {onRevoke ? (
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={onRevoke}
            disabled={busy}
            aria-label={`Revoke invitation to ${invitation.email}`}
          >
            <X aria-hidden="true" />
            Revoke
          </Button>
        </div>
      ) : null}
    </li>
  )
}

/** The panel's shape while the member list loads, so nothing jumps. */
export function TeamPanelSkeleton({
  canManage,
}: Readonly<{ canManage: boolean }>) {
  return (
    <div className="flex flex-col gap-8" aria-busy="true">
      {canManage ? (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Skeleton className="h-5 w-36" />
            <Skeleton className="h-4 w-72 max-w-full" />
          </div>
          <Skeleton className="h-18 w-full rounded-lg" />
        </div>
      ) : null}
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-4 w-64 max-w-full" />
        </div>
        <div className="divide-y rounded-lg border bg-card">
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex items-center gap-3 px-4 py-3">
              <Skeleton className="size-8 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-4 w-40 max-w-full" />
                <Skeleton className="h-3 w-56 max-w-full" />
              </div>
              <Skeleton className="hidden h-7 w-24 sm:block" />
            </div>
          ))}
        </div>
      </div>
      <div className="space-y-3">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-12 w-full rounded-lg" />
      </div>
    </div>
  )
}

function InviteForm({ onInvited }: Readonly<{ onInvited: () => void }>) {
  const emailId = useId()
  const errorId = useId()
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<Role>("developer")
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<{
    message: string
    delivery: boolean
  }>()

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    const trimmed = email.trim()
    if (!EMAIL.test(trimmed)) {
      setProblem({ message: "Enter a valid email address.", delivery: false })
      return
    }
    setBusy(true)
    setProblem(undefined)
    try {
      const created = await createInvitation({
        email: trimmed,
        role,
        expires_in_hours: 72,
      })
      setEmail("")
      toast.success(`Invitation sent to ${created.email}`, {
        action: {
          label: "Copy link",
          onClick: () => {
            void navigator.clipboard?.writeText(created.invitation_url)
          },
        },
      })
      onInvited()
    } catch (caught) {
      setProblem(inviteError(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="team-invite-heading" className="space-y-3">
      <div className="space-y-0.5">
        <h2 id="team-invite-heading" className="text-[15px] font-semibold">
          Invite a teammate
        </h2>
        <p className="text-sm text-muted-foreground">
          They get an email with a one-time link. To make someone an org-admin,
          invite them, then change their role once they join.
        </p>
      </div>
      <form
        noValidate
        onSubmit={onSubmit}
        className="flex flex-col gap-3 rounded-lg border bg-card p-4 @md:flex-row @md:items-end @md:gap-2"
      >
        <div className="min-w-0 flex-1 space-y-1.5">
          <label htmlFor={emailId} className="text-sm font-medium">
            Email
          </label>
          <Input
            id={emailId}
            type="email"
            autoComplete="off"
            placeholder="name@company.com"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value)
              setProblem(undefined)
            }}
            aria-invalid={problem && !problem.delivery ? true : undefined}
            aria-describedby={problem ? errorId : undefined}
          />
        </div>
        <Select value={role} onValueChange={(next) => setRole(next as Role)}>
          <SelectTrigger
            className="w-full @md:w-36"
            aria-label="Invite as role"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {INVITE_ROLES.map((option) => (
              <SelectItem key={option} value={option}>
                {ROLE_LABEL[option]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="submit" disabled={busy}>
          <Send aria-hidden="true" />
          {busy ? "Sending…" : "Send invite"}
        </Button>
      </form>
      {problem ? (
        <p
          id={errorId}
          role="alert"
          data-kind={problem.delivery ? "delivery" : "validation"}
          className={
            problem.delivery
              ? "rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300"
              : "text-sm text-destructive"
          }
        >
          {problem.message}
        </p>
      ) : null}
    </section>
  )
}
