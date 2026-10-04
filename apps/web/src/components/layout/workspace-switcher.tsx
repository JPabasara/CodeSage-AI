"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Plus, Settings } from "lucide-react"
import { toast } from "sonner"

import { Skeleton } from "@/components/ui/skeleton"
import { CreateWorkspaceDialog } from "@/components/workspace/create-workspace-dialog"
import {
  TopBarPicker,
  TopBarPickerAction,
  topBarCaption,
  topBarControl,
} from "@/components/layout/top-bar-picker"
import { useActiveWorkspace, useWorkspaceSwitch } from "@/hooks/use-workspace"
import { ROLE_LABEL } from "@/lib/roles"
import type { Workspace } from "@/lib/types"

// Which workspace the app is looking at, and the quick way to change it.
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
      // The new workspace's home, never a dashboard that may not be scanned.
      router.push("/overview")
      toast.success(`Switched to ${workspace.name}`)
    } catch {
      toast.error("Couldn't switch workspace.")
    }
  }

  const dialog = (
    <CreateWorkspaceDialog open={creating} onOpenChange={setCreating} />
  )

  if (loading && !workspaces) {
    return <Skeleton className="h-9 w-36 bg-tb-hover" />
  }

  if (!workspaces) return null

  if (workspaces.length === 0) {
    return (
      <>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className={topBarControl}
        >
          <span className={topBarCaption}>No workspace</span>
          <span className="flex items-center gap-1.5 text-[0.90625rem] leading-tight font-semibold">
            <Plus className="size-3.5 text-tb-muted" aria-hidden="true" />
            Create workspace
          </span>
        </button>
        {dialog}
      </>
    )
  }

  return (
    <>
      <TopBarPicker
        tourTarget="workspace-switcher"
        label="Workspace"
        heading="Switch workspace"
        className="max-w-64"
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
