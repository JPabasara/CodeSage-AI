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

// An icon per built-in, so the three read apart at a glance.
const BUILT_IN_ICON: Record<string, LucideIcon> = {
  Balanced: Scale,
  "Security-first": ShieldCheck,
  "Delivery-speed": Rocket,
}

// One small icon action on a card.
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
  inUse?: boolean
  onSelect: () => void
  onDuplicate?: () => void
  /** Omitted for built-ins, and when this role may not change profiles. */
  onEdit?: () => void
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
        "relative flex min-w-0 flex-col gap-2 rounded-md border bg-card px-3.5 py-3 transition-colors",
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
        className="flex min-w-0 items-center gap-2 text-left outline-none after:absolute after:inset-0 after:rounded-md focus-visible:after:ring-2 focus-visible:after:ring-ring"
      >
        <Icon
          className={cn(
            "size-4 shrink-0",
            selected ? "text-primary" : "text-muted-foreground",
          )}
          aria-hidden="true"
        />
        <span className="truncate text-sm font-semibold text-foreground-strong">
          {profile.name}
        </span>
      </button>

      <div className="flex min-h-6 flex-wrap items-center gap-x-1 gap-y-1.5">
        <span className="flex min-w-0 flex-wrap gap-1">
          <Badge variant="outline" className="bg-card dark:bg-card">
            {profile.is_preset ? "Built-in" : "Custom"}
          </Badge>
          {profile.is_active ? (
            <Badge variant="secondary">Default</Badge>
          ) : null}
          {inUse ? (
            <Badge className="bg-accent text-accent-foreground">In use</Badge>
          ) : null}
        </span>

        {/* Above the stretched selection area, so these take their own clicks. */}
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
