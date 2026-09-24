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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { ScoreProfile } from "@/lib/types"

/**
 * An icon per built-in, so the three read apart at a glance. Keyed by name
 * because that is what the contract gives a preset — there is no preset key on
 * the wire.
 */
const BUILT_IN_ICON: Record<string, LucideIcon> = {
  Balanced: Scale,
  "Security-first": ShieldCheck,
  "Delivery-speed": Rocket,
}

/**
 * One small icon action on a card. Its name is the full sentence ("Delete
 * Release gate") for assistive technology; the tooltip is the short word for
 * everyone else.
 */
function CardAction({
  label,
  hint,
  icon,
  onClick,
  disabled,
  destructive = false,
}: Readonly<{
  label: string
  hint: string
  icon: React.ReactNode
  onClick: () => void
  disabled?: boolean
  destructive?: boolean
}>) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
          className={cn(
            "text-muted-foreground",
            destructive && "hover:text-destructive",
          )}
        >
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  )
}

/**
 * One profile in the pool: its name, what kind it is, and whether it is the
 * default or in use — nothing the editor below already shows.
 *
 * Selection and the actions are separate controls rather than one clickable
 * card, because a card that is itself a button cannot legally contain the Edit
 * and Delete buttons. The selection button's hit area is stretched over the
 * card, and the actions sit above it, so a click anywhere selects and a click on
 * an action only does that action.
 */
export function ProfileCard({
  profile,
  selected,
  inUse = false,
  onSelect,
  onDuplicate,
  onEdit,
  onDelete,
  busy = false,
}: Readonly<{
  profile: ScoreProfile
  selected: boolean
  /** The profile in force for the scope being configured. */
  inUse?: boolean
  onSelect: () => void
  /** Omitted when this role may not create profiles. */
  onDuplicate?: () => void
  /** Omitted for built-ins, and when this role may not change profiles. */
  onEdit?: () => void
  /** Omitted for built-ins, and when this role may not change profiles. */
  onDelete?: () => void
  busy?: boolean
}>) {
  const Icon = profile.is_preset
    ? (BUILT_IN_ICON[profile.name] ?? Scale)
    : SlidersHorizontal
  const hasActions = Boolean(onDuplicate || onEdit || onDelete)

  return (
    <li
      data-testid={`profile-card-${profile.id}`}
      data-selected={selected ? "true" : undefined}
      className={cn(
        "relative flex min-w-0 flex-col gap-2 rounded-lg border bg-card p-3 transition-colors",
        selected
          ? "border-primary ring-1 ring-primary"
          : "hover:border-foreground/20",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        title={profile.name}
        className="flex min-w-0 items-center gap-2 text-left outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-ring"
      >
        <Icon
          className={cn(
            "size-4 shrink-0",
            selected ? "text-primary" : "text-muted-foreground",
          )}
          aria-hidden="true"
        />
        <span className="truncate text-sm font-semibold">{profile.name}</span>
      </button>

      <div className="flex min-h-6 flex-wrap items-center gap-x-1 gap-y-1.5">
        <span className="flex min-w-0 flex-wrap gap-1">
          <Badge variant="outline">
            {profile.is_preset ? "Built-in" : "Custom"}
          </Badge>
          {profile.is_active ? (
            <Badge variant="secondary">Default</Badge>
          ) : null}
          {inUse ? <Badge>In use</Badge> : null}
        </span>

        {/* Above the stretched selection area, so these take their own
            clicks. Built-ins expose no mutation action at all: the database
            refuses them, so a disabled Edit would only invite the attempt. */}
        {hasActions ? (
          <TooltipProvider>
            <span className="relative z-10 ml-auto flex items-center gap-0.5">
              {onDuplicate ? (
                <CardAction
                  label={`Duplicate ${profile.name}`}
                  hint="Duplicate"
                  icon={<Copy aria-hidden="true" />}
                  onClick={onDuplicate}
                />
              ) : null}
              {onEdit ? (
                <CardAction
                  label={`Edit ${profile.name}`}
                  hint="Edit"
                  icon={<Pencil aria-hidden="true" />}
                  onClick={onEdit}
                />
              ) : null}
              {onDelete ? (
                <CardAction
                  label={`Delete ${profile.name}`}
                  hint={busy ? "Deleting…" : "Delete"}
                  icon={<Trash2 aria-hidden="true" />}
                  onClick={onDelete}
                  disabled={busy}
                  destructive
                />
              ) : null}
            </span>
          </TooltipProvider>
        ) : null}
      </div>
    </li>
  )
}
