"use client"

import { useId, useState } from "react"
import { Trash2 } from "lucide-react"
import { toast } from "sonner"

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
import { ApiRequestError, deleteWorkspace } from "@/lib/api/client"

function deletionError(caught: unknown): string {
  if (!(caught instanceof ApiRequestError)) {
    return "Couldn't delete this workspace. Try again."
  }
  if (caught.code === "WORKSPACE_SCAN_RUNNING" || caught.status === 409) {
    return "Stop or wait for every queued or running scan, then try again."
  }
  if (caught.status === 403) {
    return "Only an org-admin can delete this workspace."
  }
  if (caught.status === 404) {
    return "This workspace no longer exists or is no longer active."
  }
  if (caught.code === "VALIDATION_FAILED") {
    return "The confirmation name did not match the workspace."
  }
  return caught.detail
}

export function DeleteWorkspaceSection({
  workspaceId,
  workspaceName,
  onDeleted,
}: Readonly<{
  workspaceId: string
  workspaceName: string
  onDeleted: () => void
}>) {
  const inputId = useId()
  const errorId = useId()
  const [open, setOpen] = useState(false)
  const [confirmation, setConfirmation] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const matches = confirmation === workspaceName

  function reset() {
    setConfirmation("")
    setError(undefined)
  }

  async function confirmDelete() {
    if (!matches || busy) return
    setBusy(true)
    setError(undefined)
    try {
      await deleteWorkspace(workspaceId, {
        confirmation_name: confirmation,
      })
      toast.success(`${workspaceName} was permanently deleted`)
      setOpen(false)
      reset()
      onDeleted()
    } catch (caught) {
      setError(deletionError(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="danger-zone-heading" className="space-y-3">
      <div className="space-y-0.5">
        <h2
          id="danger-zone-heading"
          className="text-base font-semibold text-destructive"
        >
          Danger zone
        </h2>
        <p className="text-sm text-muted-foreground">
          Permanently delete this workspace and everything it owns.
        </p>
      </div>
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4">
        <p className="text-sm leading-6 text-muted-foreground">
          Projects, scans, findings, profiles, invitations and memberships will
          be deleted. Member accounts and their other workspaces are unchanged.
        </p>
        <Button
          className="mt-4"
          variant="destructive"
          onClick={() => setOpen(true)}
        >
          <Trash2 aria-hidden="true" />
          Delete workspace
        </Button>
      </div>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (busy) return
          setOpen(next)
          if (!next) reset()
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete {workspaceName} permanently?</DialogTitle>
            <DialogDescription>
              This cannot be undone. Everyone will lose access to this
              workspace, but their accounts and other workspaces will remain.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <label htmlFor={inputId} className="text-sm font-medium">
              Type <span className="font-semibold">{workspaceName}</span> to
              confirm
            </label>
            <Input
              id={inputId}
              value={confirmation}
              onChange={(event) => {
                setConfirmation(event.target.value)
                setError(undefined)
              }}
              autoComplete="off"
              disabled={busy}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
            />
            {error ? (
              <p id={errorId} role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={!matches || busy}
            >
              {busy ? "Deleting…" : "Delete workspace permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
