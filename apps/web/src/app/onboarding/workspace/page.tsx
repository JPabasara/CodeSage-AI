"use client"

import { useEffect, useState } from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { FolderGit2, ShieldCheck, Users } from "lucide-react"

import {
  WorkspaceForm,
  workspaceBody,
  type WorkspaceFields,
} from "@/components/workspace/workspace-form"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiRequestError, createWorkspace } from "@/lib/api/client"
import { useSession } from "@/hooks/use-session"
import { adoptWorkspace } from "@/hooks/use-workspace"

/**
 * The first screen of a new account: signed in, with nowhere to work yet.
 *
 * Deliberately outside the app shell. There is no workspace, so the rail would
 * have no projects to link to and every read behind it answers 409 — a shell
 * full of error states is a worse welcome than one form.
 */
export default function OnboardingPage() {
  const router = useRouter()
  const { data: session, error: sessionError } = useSession()
  const [values, setValues] = useState<WorkspaceFields>({
    name: "",
    description: "",
    website_url: "",
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  // Already in a workspace — arriving here is a stale link or a back button,
  // not a state to sit in.
  useEffect(() => {
    if (session && !session.needs_workspace_setup && session.workspace_id) {
      router.replace("/projects")
    }
  }, [router, session])

  useEffect(() => {
    if (
      sessionError instanceof ApiRequestError &&
      sessionError.status === 401
    ) {
      router.replace("/login")
    }
  }, [router, sessionError])

  async function onSubmit() {
    setBusy(true)
    setError(undefined)
    try {
      const workspace = await createWorkspace(workspaceBody(values))
      // Adopt it before navigating: the app shell reads projects and profiles on
      // mount, and it has to read them for THIS workspace rather than for the
      // nothing that was active a moment ago.
      adoptWorkspace(workspace)
      router.replace("/projects")
    } catch (caught) {
      setError(
        caught instanceof ApiRequestError
          ? caught.code === "VALIDATION_FAILED"
            ? "Check the name and website — a website must be a full http or https URL."
            : caught.detail
          : "Couldn't create that workspace.",
      )
      setBusy(false)
    }
  }

  if (!session && !sessionError) {
    return (
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto max-w-xl space-y-4 p-6 outline-none"
      >
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </main>
    )
  }

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="min-h-svh bg-background text-foreground outline-none"
    >
      <div className="mx-auto grid max-w-5xl gap-8 px-5 py-10 lg:grid-cols-[1fr_1fr] lg:items-center lg:py-16">
        <section className="space-y-5">
          <Image
            src="/codesage-refactor-branch-mark.svg"
            alt=""
            width={40}
            height={40}
            className="size-10"
          />
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold tracking-tight">
              Create your workspace
            </h1>
            <p className="max-w-md text-sm leading-6 text-muted-foreground">
              A workspace is where your repositories, scoring profiles and
              teammates live. You are signed in — this is the one thing left
              before the app has somewhere to put things.
            </p>
          </div>

          <ul className="space-y-3 text-sm text-muted-foreground">
            <li className="flex items-start gap-3">
              <FolderGit2
                className="mt-0.5 size-4 shrink-0 text-primary"
                aria-hidden="true"
              />
              Repositories you connect belong to this workspace.
            </li>
            <li className="flex items-start gap-3">
              <Users
                className="mt-0.5 size-4 shrink-0 text-primary"
                aria-hidden="true"
              />
              Teammates you invite join it, with a role you choose.
            </li>
            <li className="flex items-start gap-3">
              <ShieldCheck
                className="mt-0.5 size-4 shrink-0 text-primary"
                aria-hidden="true"
              />
              You become its org-admin, and it starts on the Balanced profile.
            </li>
          </ul>
        </section>

        <section className="rounded-lg border bg-card p-6 shadow-sm">
          <WorkspaceForm
            values={values}
            onChange={setValues}
            onSubmit={onSubmit}
            busy={busy}
            error={error}
            submitLabel="Create workspace"
            busyLabel="Creating…"
          />
          <p className="mt-4 text-xs text-muted-foreground">
            No repository is created with it. The Projects page will be empty
            until you connect one.
          </p>
        </section>
      </div>
    </main>
  )
}
