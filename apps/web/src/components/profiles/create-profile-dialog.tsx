"use client"

import { useId, useState } from "react"

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
import { MAX_CUSTOM_PROFILES } from "@/lib/types"
import { ProfileValueEditor, type ProfileValues } from "./profile-values"

/**
 * Author one custom profile.
 *
 * It opens seeded — from a built-in, from another custom profile, or from the
 * numbers on the page — because starting five sliders from nothing is the slow
 * way to reach a profile that is usually a small edit of one that exists.
 *
 * Mounted only while open, and keyed by its seed, so every opening starts from
 * that seed rather than from whatever the last one was left on.
 */
export function CreateProfileDialog({
  open,
  onOpenChange,
  seedName,
  seedValues,
  customCount,
  busy = false,
  error,
  onCreate,
}: Readonly<{
  open: boolean
  onOpenChange: (open: boolean) => void
  seedName: string
  seedValues: ProfileValues
  /** How many custom profiles the workspace already holds. */
  customCount: number
  busy?: boolean
  /** A refusal from the server, already turned into a sentence. */
  error?: string
  onCreate: (name: string, values: ProfileValues) => void
}>) {
  const [name, setName] = useState(seedName)
  const [values, setValues] = useState(seedValues)
  const nameId = useId()

  const trimmed = name.trim()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New profile</DialogTitle>
          <DialogDescription>
            It joins the pool. Choosing where it applies is a separate step.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-6"
          onSubmit={(event) => {
            event.preventDefault()
            if (!trimmed || busy) return
            onCreate(trimmed, values)
          }}
        >
          <div className="space-y-2">
            <label htmlFor={nameId} className="text-sm font-semibold">
              Name
            </label>
            <Input
              id={nameId}
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={200}
              required
              autoComplete="off"
              placeholder="Release gate"
            />
            <p className="text-xs text-muted-foreground">
              <span className="tabular-nums">
                {customCount} of {MAX_CUSTOM_PROFILES}
              </span>{" "}
              custom profiles used
            </p>
          </div>

          <ProfileValueEditor
            values={values}
            onChange={setValues}
            idPrefix="new-"
          />

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy || trimmed === ""}>
              {busy ? "Creating…" : "Create profile"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
