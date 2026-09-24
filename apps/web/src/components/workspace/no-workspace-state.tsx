"use client"

import { useState } from "react"
import { usePathname } from "next/navigation"
import {
  Building2,
  FolderGit2,
  Gauge,
  History,
  Mail,
  Plus,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { WorkspaceForm } from "@/components/workspace/workspace-form"
import {
  CreateWorkspaceDialog,
  useCreateWorkspace,
} from "@/components/workspace/create-workspace-dialog"
import { useWorkspaceGate } from "@/hooks/use-workspace-scope"

type LockedPage =
  "workspace" | "projects" | "dashboard" | "history" | "profiles"

const COPY: Record<
  LockedPage,
  { icon: LucideIcon; heading: string; body: string }
> = {
  workspace: {
    icon: Building2,
    heading: "Create your workspace",
    body: "A workspace is where your repositories, scoring profiles and teammates live. You become its org-admin.",
  },
  projects: {
    icon: FolderGit2,
    heading: "Create a workspace to connect repositories",
    body: "Repositories you connect belong to a workspace, along with their scans and your team.",
  },
  dashboard: {
    icon: Gauge,
    heading: "Create a workspace to see code health",
    body: "The dashboard scores each connected repository and ranks what to refactor first.",
  },
  history: {
    icon: History,
    heading: "Create a workspace to keep scan history",
    body: "Every scan of a repository is kept, so you can compare its health over time.",
  },
  profiles: {
    icon: SlidersHorizontal,
    heading: "Scoring profiles belong to a workspace",
    body: "Profiles decide how findings are weighted when a repository is scored.",
  },
}

export function lockedPageFor(pathname: string): LockedPage {
  if (pathname.startsWith("/workspace")) return "workspace"
  if (pathname.startsWith("/profiles")) return "profiles"
  if (pathname.startsWith("/dashboard")) {
    return pathname.endsWith("/history") ? "history" : "dashboard"
  }
  return "projects"
}

/**
 * What a signed-in user with no workspace sees in place of a page's content.
 *
 * Not an error — nothing failed. One sentence on what the page is for, one way
 * forward, and the other way in for someone who was invited.
 */
export function NoWorkspaceState({ page }: Readonly<{ page: LockedPage }>) {
  const [open, setOpen] = useState(false)
  const { icon: Icon, heading, body } = COPY[page]

  return (
    <div className="flex min-h-full items-start justify-center px-4 py-10 sm:items-center sm:py-16">
      <section
        aria-labelledby="no-workspace-heading"
        data-testid="no-workspace-state"
        className="w-full max-w-lg rounded-lg border bg-card p-6 shadow-sm"
      >
        <span className="mb-4 flex size-10 items-center justify-center rounded-md border bg-muted/50 text-primary">
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <h1
          id="no-workspace-heading"
          className="text-lg font-semibold tracking-tight"
        >
          {heading}
        </h1>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{body}</p>

        <div className="mt-5">
          {page === "workspace" ? (
            <InlineCreate />
          ) : (
            <Button onClick={() => setOpen(true)}>
              <Plus aria-hidden="true" />
              Create workspace
            </Button>
          )}
        </div>

        <p className="mt-5 flex items-start gap-2 border-t pt-4 text-xs leading-5 text-muted-foreground">
          <Mail className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          Invited to a team? Open the link in your invitation email to join.
        </p>
      </section>

      <CreateWorkspaceDialog open={open} onOpenChange={setOpen} />
    </div>
  )
}

function InlineCreate() {
  const form = useCreateWorkspace()
  return (
    <WorkspaceForm
      values={form.values}
      onChange={form.setValues}
      onSubmit={form.submit}
      busy={form.busy}
      error={form.error}
      submitLabel="Create workspace"
      busyLabel="Creating…"
    />
  )
}

/**
 * The app shell's content, or — for a signed-in user with no workspace — the
 * locked card for whichever page they opened. While the session is still
 * loading the page renders as usual: its reads are held back until there is a
 * workspace, so it shows its own skeleton rather than a second one here.
 */
export function WorkspaceGate({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const gate = useWorkspaceGate()
  const pathname = usePathname()
  if (gate === "none")
    return <NoWorkspaceState page={lockedPageFor(pathname)} />
  return children
}
