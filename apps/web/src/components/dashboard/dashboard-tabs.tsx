"use client"

import { useRef, type KeyboardEvent } from "react"
import {
  FolderTree,
  LayoutDashboard,
  List,
  type LucideIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"

export type DashboardTab = "overview" | "findings" | "code"

export const DASHBOARD_TABS: readonly DashboardTab[] = [
  "overview",
  "findings",
  "code",
]

export const DASHBOARD_VIEW_STORAGE_PREFIX = "codesage.dashboard-view.v2"
const OLD_VIEW_STORAGE_PREFIX = "codesage.dashboard-view.v1"

export function dashboardViewPreferenceKey(
  userId: string,
  workspaceId: string,
) {
  return `${DASHBOARD_VIEW_STORAGE_PREFIX}:${userId}:${workspaceId}`
}

export function isDashboardTab(
  value: string | null | undefined,
): value is DashboardTab {
  return value === "overview" || value === "findings" || value === "code"
}

/** The four old bottom-bar modes, mapped onto the three tabs. */
function fromOldMode(value: string | null): DashboardTab | undefined {
  if (value === "overview") return "overview"
  if (value === "findings" || value === "findings-detail") return "findings"
  if (value === "findings-tree") return "code"
  return undefined
}

/** The tab this person last chose in this workspace, carrying over the old setting once. */
export function readStoredDashboardTab(
  userId: string,
  workspaceId: string,
): DashboardTab | undefined {
  try {
    const key = dashboardViewPreferenceKey(userId, workspaceId)
    const stored = localStorage.getItem(key)
    if (isDashboardTab(stored)) return stored
    const old = fromOldMode(
      localStorage.getItem(
        `${OLD_VIEW_STORAGE_PREFIX}:${userId}:${workspaceId}`,
      ),
    )
    if (old) localStorage.setItem(key, old)
    return old
  } catch {
    return undefined
  }
}

export function storeDashboardTab(
  userId: string,
  workspaceId: string,
  tab: DashboardTab,
) {
  try {
    localStorage.setItem(dashboardViewPreferenceKey(userId, workspaceId), tab)
  } catch {
    // Blocked storage: the choice simply isn't remembered.
  }
}

const TABS: Record<DashboardTab, { label: string; icon: LucideIcon }> = {
  overview: { label: "Overview", icon: LayoutDashboard },
  findings: { label: "Findings", icon: List },
  code: { label: "Code map", icon: FolderTree },
}

export function dashboardTabId(tab: DashboardTab) {
  return `dashboard-tab-${tab}`
}

export function dashboardPanelId(tab: DashboardTab) {
  return `dashboard-panel-${tab}`
}

/** The dashboard's views, at the top of the page where they are seen. */
export function DashboardTabs({
  value,
  onChange,
  counts,
}: Readonly<{
  value: DashboardTab
  onChange: (tab: DashboardTab) => void
  counts: Partial<Record<DashboardTab, string>>
}>) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = DASHBOARD_TABS.indexOf(value)
    let next: number | undefined
    if (event.key === "ArrowRight") next = (index + 1) % DASHBOARD_TABS.length
    if (event.key === "ArrowLeft")
      next = (index - 1 + DASHBOARD_TABS.length) % DASHBOARD_TABS.length
    if (event.key === "Home") next = 0
    if (event.key === "End") next = DASHBOARD_TABS.length - 1
    if (next === undefined) return
    event.preventDefault()
    const tab = DASHBOARD_TABS[next]
    onChange(tab)
    refs.current[tab]?.focus()
  }

  return (
    <div
      role="tablist"
      aria-label="Dashboard view"
      data-tour="dashboard-views"
      onKeyDown={onKeyDown}
      className="flex gap-0.5 overflow-x-auto border-b"
    >
      {DASHBOARD_TABS.map((tab) => {
        const { label, icon: Icon } = TABS[tab]
        const selected = tab === value
        return (
          <button
            key={tab}
            ref={(node) => {
              refs.current[tab] = node
            }}
            type="button"
            role="tab"
            id={dashboardTabId(tab)}
            aria-controls={dashboardPanelId(tab)}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab)}
            className={cn(
              "-mb-px inline-flex h-11 shrink-0 items-center gap-2 border-b-2 border-transparent px-3.5 text-[0.9375rem] font-medium whitespace-nowrap text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
              selected && "border-primary font-semibold text-foreground-strong",
            )}
          >
            <Icon className="size-4" aria-hidden="true" />
            {label}
            {counts[tab] ? (
              <span
                className={cn(
                  "rounded-full px-2 py-px text-xs font-semibold tabular-nums",
                  selected
                    ? "bg-accent text-accent-foreground"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {counts[tab]}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
