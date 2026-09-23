"use client"

import {
  Copy,
  Pencil,
  Rocket,
  Scale,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  type LucideIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { ScoreProfile } from "@/lib/types"
import { WEIGHT_ROWS } from "./profile-values"

/**
 * What each built-in is for, in the words someone choosing between them needs.
 * Keyed by name because that is what the contract gives a preset — there is no
 * preset key on the wire.
 */
const BUILT_IN: Record<string, { icon: LucideIcon; blurb: string }> = {
  Balanced: {
    icon: Scale,
    blurb: "Every category counts the same. The starting point for a new team.",
  },
  "Security-first": {
    icon: ShieldCheck,
    blurb: "Security outranks everything else; docs and tests step back.",
  },
  "Delivery-speed": {
    icon: Rocket,
    blurb: "Favours shipping: design and security still count, docs least.",
  },
}

/** How many projects have chosen this profile by name, said in one line. */
function usageLine(profile: ScoreProfile) {
  if (profile.is_active) {
    return profile.usage_count > 0
      ? `Workspace default, and chosen by ${profile.usage_count} ${
          profile.usage_count === 1 ? "project" : "projects"
        }`
      : "In force for every project without an override"
  }
  if (profile.usage_count === 0) return "Not used by any project"
  return `Chosen by ${profile.usage_count} ${
    profile.usage_count === 1 ? "project" : "projects"
  }`
}

/**
 * One profile in the pool: what it is, whether it is the default, who uses it,
 * and the actions this role is allowed to take on it.
 *
 * Selection and the row of actions are separate controls rather than one
 * clickable card, because a card that is itself a button cannot legally contain
 * the Edit and Delete buttons — and stretching an invisible overlay over the
 * card to fake it would swallow their clicks.
 */
export function ProfileCard({
  profile,
  selected,
  onSelect,
  onDuplicate,
  onEdit,
  onDelete,
  busy = false,
}: Readonly<{
  profile: ScoreProfile
  selected: boolean
  onSelect: () => void
  /** Omitted when this role may not create profiles. */
  onDuplicate?: () => void
  /** Omitted for built-ins, and when this role may not change profiles. */
  onEdit?: () => void
  /** Omitted for built-ins, and when this role may not change profiles. */
  onDelete?: () => void
  busy?: boolean
}>) {
  const preset = BUILT_IN[profile.name]
  const Icon = profile.is_preset ? (preset?.icon ?? Scale) : SlidersHorizontal

  return (
    <li
      data-testid={`profile-card-${profile.id}`}
      data-selected={selected ? "true" : undefined}
      className={cn(
        "flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-sm transition-colors",
        selected
          ? "border-primary ring-1 ring-primary"
          : "hover:border-primary/40",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className="flex min-w-0 flex-col gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex min-w-0 items-start gap-2">
          <span className="grid size-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
            <Icon className="size-4" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">
              {profile.name}
            </span>
            <span className="mt-1 flex flex-wrap gap-1">
              <Badge variant={profile.is_preset ? "outline" : "secondary"}>
                {profile.is_preset ? "Built-in" : "Custom"}
              </Badge>
              {profile.is_active ? <Badge>Workspace default</Badge> : null}
            </span>
          </span>
        </span>
        <span className="text-xs text-muted-foreground">
          {preset?.blurb ??
            "A profile this workspace authored. Editing it re-scores every project that uses it."}
        </span>
      </button>

      <dl className="flex flex-wrap gap-1 text-[0.625rem]">
        {WEIGHT_ROWS.map(({ key, label }) => (
          <div
            key={key}
            className="flex items-center gap-1 rounded-md border bg-background px-1.5 py-0.5"
          >
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="tabular-nums">{profile.weights[key].toFixed(1)}</dd>
          </div>
        ))}
        <div className="flex items-center gap-1 rounded-md border bg-background px-1.5 py-0.5">
          <dt className="text-muted-foreground">Trust</dt>
          <dd className="tabular-nums">{profile.trust_s.toFixed(2)}</dd>
        </div>
      </dl>

      <p className="text-xs text-muted-foreground">{usageLine(profile)}</p>

      <div className="flex flex-wrap gap-2">
        {onDuplicate ? (
          <Button
            variant="outline"
            size="sm"
            onClick={onDuplicate}
            aria-label={`Duplicate ${profile.name}`}
          >
            <Copy aria-hidden="true" />
            Duplicate
          </Button>
        ) : null}
        {/* Built-ins expose no mutation action at all: the database refuses
            them, so offering a disabled Edit would only invite the attempt. */}
        {onEdit ? (
          <Button
            variant="outline"
            size="sm"
            onClick={onEdit}
            aria-label={`Edit ${profile.name}`}
          >
            <Pencil aria-hidden="true" />
            Edit
          </Button>
        ) : null}
        {onDelete ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            disabled={busy}
            aria-label={`Delete ${profile.name}`}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 aria-hidden="true" />
            {busy ? "Deleting…" : "Delete"}
          </Button>
        ) : null}
      </div>
    </li>
  )
}
