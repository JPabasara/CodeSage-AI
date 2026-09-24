"use client"

import { useId, useState } from "react"
import { Mail, Send, UserMinus, X } from "lucide-react"
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
import type { Member, MemberList, Role } from "@/lib/types"
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
    return (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    )
  }

  const members = [...data.members].sort(
    (a, b) =>
      Number(b.user_id === currentUserId) -
        Number(a.user_id === currentUserId) ||
      Number(a.status !== "active") - Number(b.status !== "active"),
  )

  return (
    <div className="flex flex-col gap-6">
      {canManage ? <InviteForm onInvited={afterWrite} /> : null}

      <section
        aria-labelledby="team-members-heading"
        className="space-y-3 rounded-lg border bg-card p-5 shadow-sm"
      >
        <div>
          <h2 id="team-members-heading" className="text-base font-semibold">
            Members
          </h2>
          <p className="text-sm text-muted-foreground">
            {canManage
              ? "Change a role or deactivate someone. Your own row is managed by another org-admin."
              : "Only an org-admin can change members. You can see who is here."}
          </p>
        </div>

        <ul className="divide-y" data-testid="member-list">
          {members.map((member) => {
            const label = displayName(member)
            const isSelf = member.user_id === currentUserId
            const editable = canManage && !isSelf && member.status === "active"
            return (
              <li
                key={member.membership_id}
                className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center"
                data-testid="member-row"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
                  >
                    {initials(label)}
                  </span>
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
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

                <div className="flex shrink-0 items-center gap-2 sm:justify-end">
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
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setConfirming(member)}
                        disabled={busyId === member.membership_id}
                        aria-label={`Deactivate ${label}`}
                      >
                        <UserMinus aria-hidden="true" />
                        <span className="hidden sm:inline">Deactivate</span>
                      </Button>
                    </>
                  ) : (
                    <Badge variant="secondary">
                      {ROLE_LABEL[member.role] ?? member.role}
                    </Badge>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      </section>

      <section
        aria-labelledby="team-invitations-heading"
        className="space-y-3 rounded-lg border bg-card p-5 shadow-sm"
      >
        <h2 id="team-invitations-heading" className="text-base font-semibold">
          Pending invitations
        </h2>
        {data.pending_invitations.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No one is waiting to join.
          </p>
        ) : (
          <ul className="divide-y" data-testid="invitation-list">
            {data.pending_invitations.map((invitation) => (
              <li
                key={invitation.invitation_id}
                className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <Mail
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <p
                      className="truncate text-sm font-medium"
                      title={invitation.email}
                    >
                      {invitation.email}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {ROLE_LABEL[invitation.role] ?? invitation.role} · expires{" "}
                      {new Date(invitation.expires_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                {canManage ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      onRevoke(invitation.invitation_id, invitation.email)
                    }
                    disabled={busyId === invitation.invitation_id}
                    aria-label={`Revoke invitation to ${invitation.email}`}
                  >
                    <X aria-hidden="true" />
                    Revoke
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
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
    <section
      aria-labelledby="team-invite-heading"
      className="space-y-3 rounded-lg border bg-card p-5 shadow-sm"
    >
      <div>
        <h2 id="team-invite-heading" className="text-base font-semibold">
          Invite a teammate
        </h2>
        <p className="text-sm text-muted-foreground">
          They get an email with a one-time link. To make someone an org-admin,
          invite them first, then change their role once they join.
        </p>
      </div>
      <form
        noValidate
        onSubmit={onSubmit}
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
      >
        <div className="min-w-0 flex-1 space-y-1">
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
          <SelectTrigger className="w-full sm:w-36" aria-label="Invite as role">
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
