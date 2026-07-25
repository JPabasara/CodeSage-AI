"use client"

import { useRouter } from "next/navigation"

import { ConnectRepo } from "@/components/projects/connect-repo"
import { ProjectList } from "@/components/projects/project-list"
import { Skeleton } from "@/components/ui/skeleton"
import { useProjects } from "@/hooks/use-projects"

export default function ProjectsPage() {
  const router = useRouter()
  // Data now arrives over the (mock) network instead of a static import.
  const { data: repos, loading, error } = useProjects()

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Projects</h1>
        <p className="text-muted-foreground text-sm">
          Connect a repository, then select it to open its dashboard.
        </p>
      </div>

      {/* Connecting a repo needs a create endpoint (not in v1 mock) — wired later. */}
      <ConnectRepo />

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
