"use client";

import { useRouter } from "next/navigation";

import { ConnectRepo } from "@/components/projects/connect-repo";
import { ProjectList } from "@/components/projects/project-list";
import { mockRepos } from "@/lib/mocks/fixtures";

export default function ProjectsPage() {
  const router = useRouter();

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Projects</h1>
        <p className="text-muted-foreground text-sm">
          Connect a repository, then select it to open its dashboard.
        </p>
      </div>

      {/* onConnect is wired to the (mock) API in Phase 8 */}
      <ConnectRepo />
      <ProjectList repos={mockRepos} onSelect={(repo) => router.push(`/dashboard/${repo.id}`)} />
    </div>
  );
}
