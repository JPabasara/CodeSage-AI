// Warm a project's dashboard while the pointer rests on a link to it, so the
// click lands on data that is already here.
import { getBranches, getHealthReport, getScanHistory } from "@/lib/api/client"
import { fetchShared, readCached } from "@/lib/query-cache"
import { healthKey } from "@/hooks/use-health-report"
import { readSelectedBranch } from "@/hooks/use-selected-branch"
import {
  readActiveWorkspaceId,
  readWorkspaceEpoch,
} from "@/hooks/use-workspace-scope"
import type { Repo } from "@/lib/types"

/** Long enough that sweeping across a list prefetches nothing. */
export const PREFETCH_WAIT_MS = 120

let waiting: ReturnType<typeof setTimeout> | undefined

function warm<T>(key: string, fetcher: () => Promise<T>) {
  if (readCached(key)) return
  // A miss (say, a score still being calculated) is the page's to show, not ours.
  fetchShared(key, fetcher).catch(() => undefined)
}

export function prefetchProject(
  repo: Pick<Repo, "id" | "default_branch">,
  prefetchRoute?: (href: string) => void,
) {
  cancelProjectPrefetch()
  waiting = setTimeout(() => {
    waiting = undefined
    const workspaceId = readActiveWorkspaceId()
    if (!workspaceId) return
    const epoch = readWorkspaceEpoch()
    // The branch the dashboard will open on: the one last looked at, else the default.
    const branch =
      readSelectedBranch(workspaceId, repo.id) ?? repo.default_branch
    prefetchRoute?.(`/dashboard/${repo.id}`)
    warm(`${epoch}:branches:${repo.id}`, () => getBranches(repo.id))
    warm(healthKey(epoch, repo.id, branch), () =>
      getHealthReport(repo.id, branch),
    )
    warm(`${epoch}:scans:${repo.id}:${branch}`, () =>
      getScanHistory(repo.id, branch),
    )
  }, PREFETCH_WAIT_MS)
}

export function cancelProjectPrefetch() {
  if (waiting) clearTimeout(waiting)
  waiting = undefined
}
