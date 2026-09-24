"use client"

import { useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  WorkspaceForm,
  workspaceBody,
  type WorkspaceFields,
} from "@/components/workspace/workspace-form"
import { ApiRequestError, createWorkspace } from "@/lib/api/client"
import { adoptWorkspace } from "@/hooks/use-workspace"

const EMPTY: WorkspaceFields = { name: "", description: "", website_url: "" }

export function createWorkspaceError(caught: unknown): string {
  return caught instanceof ApiRequestError
    ? caught.code === "VALIDATION_FAILED"
      ? "Check the name and website — a website must be a full http or https URL."
      : caught.detail
    : "Couldn't create that workspace."
}

/**
 * The create-a-workspace form's state and submit, shared by the dialog and the
 * inline form on the Workspace page.
 *
 * The creator becomes its org-admin and the session switches to it. Nobody is
 * navigated anywhere: the page they were on simply fills in, because every read
 * on it was waiting for — or is re-keyed by — the new workspace.
 */
export function useCreateWorkspace(onCreated?: () => void) {
  const [values, setValues] = useState<WorkspaceFields>(EMPTY)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  function reset() {
    setValues(EMPTY)
    setError(undefined)
  }

  async function submit() {
    setBusy(true)
    setError(undefined)
    try {
      const workspace = await createWorkspace(workspaceBody(values))
      adoptWorkspace(workspace)
      toast.success(
        `${workspace.name} is ready. Connect your first repository.`,
      )
      reset()
      onCreated?.()
    } catch (caught) {
      setError(createWorkspaceError(caught))
    } finally {
      setBusy(false)
    }
  }

  return { values, setValues, busy, error, submit, reset }
}

/** Create a workspace from wherever the user is. */
export function CreateWorkspaceDialog({
  open,
  onOpenChange,
  description = "You become its org-admin. Projects, scoring profiles and teammates all belong to it.",
}: Readonly<{
  open: boolean
  onOpenChange: (open: boolean) => void
  description?: string
}>) {
  const form = useCreateWorkspace(() => onOpenChange(false))

  function close(next: boolean) {
    if (!next) form.reset()
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create a workspace</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <WorkspaceForm
          values={form.values}
          onChange={form.setValues}
          onSubmit={form.submit}
          busy={form.busy}
          error={form.error}
          submitLabel="Create workspace"
          busyLabel="Creating…"
        >
          <Button type="button" variant="outline" onClick={() => close(false)}>
            Cancel
          </Button>
        </WorkspaceForm>
      </DialogContent>
    </Dialog>
  )
}
