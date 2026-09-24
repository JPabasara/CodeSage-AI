"use client"

import { useId, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export interface WorkspaceFields {
  name: string
  description: string
  website_url: string
}

/**
 * The three fields a workspace has, in the one form that edits them.
 *
 * Shared by onboarding, the Workspace settings page and "create another", so a
 * field cannot be validated one way on the way in and another way afterwards.
 *
 * Empty text is sent as `null`, not as `""`: the contract distinguishes "leave
 * it alone" from "clear it", and an empty string is neither.
 */
export function WorkspaceForm({
  values,
  onChange,
  onSubmit,
  busy = false,
  error,
  submitLabel,
  busyLabel,
  disabled = false,
  children,
}: Readonly<{
  values: WorkspaceFields
  onChange: (next: WorkspaceFields) => void
  onSubmit: () => void
  busy?: boolean
  error?: string
  submitLabel: string
  busyLabel: string
  /** Read-only for a role that may look but not change. */
  disabled?: boolean
  /** Extra controls beside the submit button. */
  children?: React.ReactNode
}>) {
  const nameId = useId()
  const descriptionId = useId()
  const websiteId = useId()
  const [touched, setTouched] = useState(false)

  const nameMissing = touched && values.name.trim() === ""

  return (
    <form
      className="space-y-4"
      // The browser's own validation is turned off so this form can say what is
      // wrong in its own words, in the page, where a screen reader reads it —
      // rather than in a native bubble that vanishes on the next keystroke and
      // that the server's 422 would contradict anyway.
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        setTouched(true)
        if (values.name.trim() === "" || busy || disabled) return
        onSubmit()
      }}
    >
      <div className="space-y-2">
        <label htmlFor={nameId} className="text-sm font-medium">
          Workspace name
        </label>
        <Input
          id={nameId}
          value={values.name}
          maxLength={255}
          required
          autoComplete="organization"
          disabled={disabled}
          aria-invalid={nameMissing || undefined}
          aria-describedby={nameMissing ? `${nameId}-error` : undefined}
          onChange={(event) =>
            onChange({ ...values, name: event.target.value })
          }
        />
        {nameMissing ? (
          <p id={`${nameId}-error`} className="text-sm text-destructive">
            A workspace needs a name.
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <label htmlFor={descriptionId} className="text-sm font-medium">
          Description
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            Optional
          </span>
        </label>
        <textarea
          id={descriptionId}
          value={values.description}
          maxLength={1000}
          rows={3}
          disabled={disabled}
          className="flex w-full rounded-md border border-input bg-input/20 px-3 py-2 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50"
          onChange={(event) =>
            onChange({ ...values, description: event.target.value })
          }
        />
      </div>

      <div className="space-y-2">
        <label htmlFor={websiteId} className="text-sm font-medium">
          Website
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            Optional
          </span>
        </label>
        <Input
          id={websiteId}
          type="url"
          inputMode="url"
          value={values.website_url}
          maxLength={1000}
          placeholder="https://example.com"
          autoComplete="url"
          disabled={disabled}
          onChange={(event) =>
            onChange({ ...values, website_url: event.target.value })
          }
        />
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {disabled ? null : (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={busy}>
            {busy ? busyLabel : submitLabel}
          </Button>
          {children}
        </div>
      )}
    </form>
  )
}

/** The wire shape, with empty text turned back into the absence it means. */
export function workspaceBody(values: WorkspaceFields) {
  return {
    name: values.name.trim(),
    description: values.description.trim() || null,
    website_url: values.website_url.trim() || null,
  }
}
