"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { ApiRequestError, connectRepo } from "@/lib/api/client"
import type { ErrorCode } from "@/lib/types"
import { ConnectRepo } from "@/components/projects/connect-repo"
import { ProjectList } from "@/components/projects/project-list"
import { Skeleton } from "@/components/ui/skeleton"
import { useProjects } from "@/hooks/use-projects"

// Each code is a different thing for the user to do about it, which is why they
// are separate rather than one 400 — a bare "400 Bad Request" leaves someone who
// pasted a private repository with no idea what went wrong.
const CONNECT_MESSAGE: Partial<Record<ErrorCode, string>> = {
  INVALID_REPOSITORY_URL: "That does not look like a repository URL.",
  REPOSITORY_NOT_PUBLIC:
    "Only public repositories can be connected in this release.",
  REPOSITORY_UNREACHABLE:
    "That repository could not be reached. Check the URL and try again.",
  ALREADY_CONNECTED: "That repository is already connected.",
}

export default function ProjectsPage() {
  const router = useRouter()
  const { data: repos, loading, error, reload } = useProjects()
  const [connecting, setConnecting] = useState(false)

  async function onConnect(url: string) {
    setConnecting(true)
    try {
      const repo = await connectRepo(url)
      reload() // the list is a separate read; it does not know about the write
      toast.success(`Connected ${repo.owner}/${repo.name}`)
    } catch (err) {
      const code = err instanceof ApiRequestError ? err.code : undefined
      toast.error(
        (code && CONNECT_MESSAGE[code]) ??
          (err instanceof Error
            ? err.message
            : "Couldn't connect that repository."),
      )
    } finally {
      setConnecting(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Projects</h1>
        <p className="text-muted-foreground text-sm">
          Connect a repository, then select it to open its dashboard.
        </p>
      </div>

      <ConnectRepo onConnect={onConnect} busy={connecting} />

      {error ? (
        <p className="text-destructive text-sm">
          Couldn’t load projects: {error.message}
        </p>
      ) : loading ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : (
        <ProjectList
          repos={repos ?? []}
          onSelect={(repo) => router.push(`/dashboard/${repo.id}`)}
        />
      )}
    </div>
  )
}
