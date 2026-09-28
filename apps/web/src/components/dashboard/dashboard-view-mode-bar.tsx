"use client"

import { Columns3, FolderTree, LayoutDashboard, List } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

export type DashboardViewMode =
  "overview" | "findings" | "findings-tree" | "findings-detail"

export const DASHBOARD_VIEW_STORAGE_PREFIX = "codesage.dashboard-view.v1"

export function dashboardViewPreferenceKey(
  userId: string,
  workspaceId: string,
) {
  return `${DASHBOARD_VIEW_STORAGE_PREFIX}:${userId}:${workspaceId}`
}

export function isDashboardViewMode(
  value: string | null,
): value is DashboardViewMode {
  return (
    value === "overview" ||
    value === "findings" ||
    value === "findings-tree" ||
    value === "findings-detail"
  )
}

const MODES: {
  value: DashboardViewMode
  label: string
  description: string
  icon: typeof LayoutDashboard
}[] = [
  {
    value: "overview",
    label: "Overview",
    description: "Health, trend, findings and file tree",
    icon: LayoutDashboard,
  },
  {
    value: "findings",
    label: "Findings",
    description: "Expand the findings panel",
    icon: List,
  },
  {
    value: "findings-tree",
    label: "Findings + files",
    description: "Show findings beside the file tree",
    icon: FolderTree,
  },
  {
    value: "findings-detail",
    label: "Findings + detail",
    description: "Show findings beside the selected finding",
    icon: Columns3,
  },
]

export function DashboardViewModeBar({
  value,
  onChange,
  canShowDetail = true,
}: Readonly<{
  value: DashboardViewMode
  onChange: (mode: DashboardViewMode) => void
  canShowDetail?: boolean
}>) {
  return (
    <TooltipProvider>
      <div
        role="toolbar"
        aria-label="Dashboard view"
        className="flex h-10 shrink-0 items-center justify-center gap-1 border-t bg-card/95 px-2 backdrop-blur"
      >
        {MODES.map((mode) => {
          const selected = value === mode.value
          const disabled = mode.value === "findings-detail" && !canShowDetail
          const Icon = mode.icon
          return (
            <Tooltip key={mode.value}>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={mode.label}
                  aria-pressed={selected}
                  disabled={disabled}
                  onClick={() => onChange(mode.value)}
                  className={cn(
                    "h-7 gap-1.5 px-2 text-xs",
                    selected && "bg-accent text-accent-foreground",
                  )}
                >
                  <Icon className="size-3.5" aria-hidden="true" />
                  <span className="hidden sm:inline">{mode.label}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">{mode.description}</TooltipContent>
            </Tooltip>
          )
        })}
      </div>
    </TooltipProvider>
  )
}
