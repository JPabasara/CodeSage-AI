"use client"

import { useRouter } from "next/navigation"
import { Building2 } from "lucide-react"
import { toast } from "sonner"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { getProjects } from "@/lib/api/client"
import { readSelectedProjectId } from "@/hooks/use-selected-project"
import { useActiveWorkspace, useWorkspaceSwitch } from "@/hooks/use-workspace"
import type { Workspace } from "@/lib/types"

const ROLE_LABEL: Record<string, string> = {
  "org-admin": "Org admin",
  manager: "Manager",
  developer: "Developer",
  viewer: "Viewer",
}

/**
 * Which workspace the app is looking at, and the way to change it.
 *
 * It sits in the rail rather than on one page because the answer changes what
 * every page shows: hiding it inside Workspace settings would mean the projects
 * on screen could belong to a workspace whose name is nowhere in view.
 */
export function WorkspaceSwitcher({
  workspaces,
  loading = false,
  onNavigate,
}: Readonly<{
  workspaces: Workspace[] | undefined
  loading?: boolean
  /** Lets the mobile rail close itself when a switch navigates. */
  onNavigate?: () => void
}>) {
  const router = useRouter()
  const active = useActiveWorkspace(workspaces)
  const { switchTo, switchingTo } = useWorkspaceSwitch()

  async function onSwitch(workspaceId: string) {
    if (workspaceId === active?.workspace_id) return
    try {
      const workspace = await switchTo(workspaceId)
      onNavigate?.()

      // Where to land. The project this workspace was last on is the friendly
      // answer, but only if it is still one of this workspace's projects — a
      // remembered id from a deleted repository would land on a 404, and an id
      // from the workspace we just left must never be opened here at all.
      const remembered = readSelectedProjectId(workspace.workspace_id)
      const projects = await getProjects().catch(() => [])
      const target = projects.find((repo) => repo.id === remembered)
      router.push(target ? `/dashboard/${target.id}` : "/projects")
      toast.success(`Switched to ${workspace.name}`)
    } catch {
      toast.error("Couldn't switch workspace.")
    }
  }

  if (loading && !workspaces) {
    return (
      <div className="px-2 group-data-[collapsible=icon]:hidden">
        <Skeleton className="h-9 w-full" />
      </div>
    )
  }

  if (!workspaces || workspaces.length === 0) return null

  return (
    <div className="px-2 group-data-[collapsible=icon]:px-0">
      <Select
        value={active?.workspace_id}
        onValueChange={onSwitch}
        disabled={Boolean(switchingTo)}
      >
        <SelectTrigger
          aria-label="Workspace"
          className="h-auto w-full items-center gap-2 py-1.5 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
        >
          <Building2
            className="size-4 shrink-0 text-sidebar-primary"
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1 text-left group-data-[collapsible=icon]:hidden">
            <SelectValue placeholder="Choose a workspace">
              <span className="block truncate text-sm font-medium">
                {active?.name}
              </span>
              <span className="block truncate text-[0.625rem] text-muted-foreground">
                {switchingTo
                  ? "Switching…"
                  : (ROLE_LABEL[active?.role ?? ""] ?? active?.role)}
              </span>
            </SelectValue>
          </span>
        </SelectTrigger>
        <SelectContent>
          {workspaces.map((workspace) => (
            <SelectItem
              key={workspace.workspace_id}
              value={workspace.workspace_id}
            >
              {workspace.name}
              <span className="ml-2 text-xs text-muted-foreground">
                {ROLE_LABEL[workspace.role] ?? workspace.role}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
