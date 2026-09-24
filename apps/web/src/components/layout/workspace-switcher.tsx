"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Building2, Plus, Settings } from "lucide-react"
import { toast } from "sonner"

import { Skeleton } from "@/components/ui/skeleton"
import { CreateWorkspaceDialog } from "@/components/workspace/create-workspace-dialog"
import {
  TopBarPicker,
  TopBarPickerAction,
  topBarControl,
} from "@/components/layout/top-bar-picker"
import { getProjects } from "@/lib/api/client"
import { readSelectedProjectId } from "@/hooks/use-selected-project"
import { useActiveWorkspace, useWorkspaceSwitch } from "@/hooks/use-workspace"
import { ROLE_LABEL } from "@/lib/roles"
import type { Workspace } from "@/lib/types"

/**
 * Which workspace the app is looking at, and the quick way to change it.
 *
 * It is the first and largest control in the top bar because the answer
 * changes what every page shows. Its menu is for switching; settings are one
 * row at the foot that takes you to the Workspace tab, not a second panel here.
 */
export function WorkspaceSwitcher({
  workspaces,
  loading = false,
}: Readonly<{
  workspaces: Workspace[] | undefined
  loading?: boolean
}>) {
  const router = useRouter()
  const active = useActiveWorkspace(workspaces)
  const { switchTo, switchingTo } = useWorkspaceSwitch()
  const [creating, setCreating] = useState(false)

  async function onSwitch(workspaceId: string) {
    if (workspaceId === active?.workspace_id) return
    try {
      const workspace = await switchTo(workspaceId)

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

  const dialog = (
    <CreateWorkspaceDialog open={creating} onOpenChange={setCreating} />
  )

  if (loading && !workspaces) {
    return (
      <Skeleton className="h-9 min-w-0 flex-1 bg-white/15 md:w-40 md:flex-none" />
    )
  }

  if (!workspaces) return null

  // Signed in with nowhere to work yet: say so where the name would be, and
  // make creating one the obvious next step.
  if (workspaces.length === 0) {
    return (
      <>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className={`${topBarControl} min-w-0 flex-1 md:w-auto md:max-w-52 md:flex-none`}
        >
          <Plus className="size-4 shrink-0 opacity-80" aria-hidden="true" />
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate font-medium">No workspace</span>
            <span className="block truncate text-[0.6875rem] opacity-75">
              Create workspace
            </span>
          </span>
        </button>
        {dialog}
      </>
    )
  }

  return (
    <>
      <TopBarPicker
        label="Workspace"
        icon={<Building2 className="size-4" />}
        className="min-w-0 flex-1 md:w-auto md:max-w-52 md:flex-none"
        items={workspaces.map((workspace) => ({
          value: workspace.workspace_id,
          label: workspace.name,
          caption: ROLE_LABEL[workspace.role] ?? workspace.role,
        }))}
        activeValue={active?.workspace_id}
        activeLabel={active?.name ?? "Choose a workspace"}
        activeCaption={
          active ? (ROLE_LABEL[active.role] ?? active.role) : undefined
        }
        busy={Boolean(switchingTo)}
        onSelect={(value) => void onSwitch(value)}
        emptyMessage="No workspaces yet."
        footer={(close) => (
          <>
            <TopBarPickerAction
              icon={<Settings className="size-4" />}
              onSelect={() => {
                close()
                router.push("/workspace")
              }}
            >
              Workspace settings
            </TopBarPickerAction>
            <TopBarPickerAction
              icon={<Plus className="size-4" />}
              onSelect={() => {
                close()
                setCreating(true)
              }}
            >
              Create workspace
            </TopBarPickerAction>
          </>
        )}
      />
      {dialog}
    </>
  )
}
