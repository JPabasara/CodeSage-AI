"use client"

import { useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { getWorkspaceRules, updateWorkspaceRules } from "@/lib/api/client"

export function DisableRuleButton({ ruleId }: Readonly<{ ruleId: string }>) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [disabled, setDisabled] = useState(false)
  const [error, setError] = useState<string>()

  async function disable() {
    if (busy) return
    setBusy(true)
    setError(undefined)
    try {
      const config = await getWorkspaceRules()
      if (!config.disabled_rule_ids.includes(ruleId)) {
        await updateWorkspaceRules([...config.disabled_rule_ids, ruleId])
      }
      setDisabled(true)
      setOpen(false)
      toast.success(
        "Rule disabled for future scans. Existing findings are unchanged.",
      )
    } catch {
      setError("Could not disable this rule. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy) {
          setOpen(value)
          setError(undefined)
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" disabled={disabled}>
          {disabled ? "Rule disabled" : "Disable this rule"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Disable this rule?</DialogTitle>
          <DialogDescription>
            Disable {ruleId} for future scans across all repositories in this
            workspace? Existing findings and scores remain unchanged.
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Re-enable it in{" "}
          <Link href="/profiles" className="underline">
            Profiles → Rules
          </Link>
          .
        </p>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <Button disabled={busy} onClick={() => void disable()}>
            {busy ? "Disabling…" : "Disable rule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
