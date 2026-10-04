// The workspace overview's arithmetic, kept pure so it can be tested on its own.
import type { Activity, Grade, Repo } from "@/lib/types"

export const GRADES: readonly Grade[] = ["A", "B", "C", "D", "E"]

/** The same thresholds a project's own grade uses. */
export function gradeFor(score: number): Grade {
  if (score >= 85) return "A"
  if (score >= 70) return "B"
  if (score >= 55) return "C"
  if (score >= 40) return "D"
  return "E"
}

export type WorkspaceHealth = {
  score: number
  grade: Grade
  /** The same average over each project's change since its previous scan. */
  delta: number
  /** Averaged by size (KLOC) when every scanned project reports it. */
  weighted: boolean
  scannedCount: number
  distribution: Record<Grade, number>
  notScanned: number
}

export function workspaceHealth(projects: Repo[]): WorkspaceHealth | undefined {
  const scanned = projects.filter((repo) => repo.latest_health)
  const distribution = { A: 0, B: 0, C: 0, D: 0, E: 0 } as Record<Grade, number>
  for (const repo of scanned) distribution[repo.latest_health!.grade] += 1
  if (scanned.length === 0) return undefined

  const weighted = scanned.every((repo) => (repo.latest_health?.kloc ?? 0) > 0)
  const weightOf = (repo: Repo) =>
    weighted ? (repo.latest_health?.kloc ?? 0) : 1
  const totalWeight = scanned.reduce((sum, repo) => sum + weightOf(repo), 0)
  const average = (value: (repo: Repo) => number) =>
    scanned.reduce((sum, repo) => sum + value(repo) * weightOf(repo), 0) /
    totalWeight

  const score = average((repo) => repo.latest_health!.score)
  return {
    score,
    grade: gradeFor(Math.round(score)),
    delta: average((repo) => repo.latest_health!.delta),
    weighted,
    scannedCount: scanned.length,
    distribution,
    notScanned: projects.length - scanned.length,
  }
}

/** A sum over scanned projects; undefined when none of them reports the field. */
export function sumOf(
  projects: Repo[],
  field: "red_issue_count" | "finding_count",
): number | undefined {
  const values = projects
    .map((repo) => repo.latest_health?.[field])
    .filter((value): value is number => typeof value === "number")
  return values.length === 0
    ? undefined
    : values.reduce((sum, value) => sum + value, 0)
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

export function scannedWithinWeek(projects: Repo[], now = Date.now()) {
  return projects.filter((repo) => {
    const at = Date.parse(repo.latest_health?.scanned_at ?? "")
    return !Number.isNaN(at) && now - at <= WEEK_MS
  }).length
}

export type AttentionItem = {
  repo: Repo
  kind: "dropped" | "low-grade" | "never-scanned" | "rescoring"
  title: string
  detail: string
}

/** A drop this large since the previous scan is worth a look. */
export const NOTABLE_DROP = 3
const MAX_ATTENTION = 4

/**
 * What to look at first, one line per project at most: a sharp drop, then a D
 * or E grade, then projects never scanned, then scores still being recalculated.
 */
export function needsAttention(
  projects: Repo[],
  activity?: Activity,
): AttentionItem[] {
  const items: AttentionItem[] = []
  const seen = new Set<string>()
  const add = (item: AttentionItem) => {
    if (seen.has(item.repo.id) || items.length >= MAX_ATTENTION) return
    seen.add(item.repo.id)
    items.push(item)
  }

  const dropped = projects
    .filter((repo) => (repo.latest_health?.delta ?? 0) <= -NOTABLE_DROP)
    .sort((a, b) => a.latest_health!.delta - b.latest_health!.delta)
  for (const repo of dropped) {
    const health = repo.latest_health!
    const drop = Math.round(Math.abs(health.delta))
    const before = Math.round(health.score + drop)
    add({
      repo,
      kind: "dropped",
      title: `${repo.name} dropped ${drop} ${drop === 1 ? "point" : "points"}`,
      detail: `${before} → ${Math.round(health.score)} after its latest scan.`,
    })
  }

  const lowGrades = projects
    .filter((repo) => {
      const grade = repo.latest_health?.grade
      return grade === "D" || grade === "E"
    })
    .sort((a, b) => a.latest_health!.score - b.latest_health!.score)
  for (const repo of lowGrades) {
    const health = repo.latest_health!
    const red = health.red_issue_count
    add({
      repo,
      kind: "low-grade",
      title: `${repo.name} is grade ${health.grade} (${Math.round(health.score)})`,
      detail:
        typeof red === "number" && red > 0
          ? `${red} critical or high ${red === 1 ? "finding" : "findings"}. Start with the Refactor-first list.`
          : "Start with the Refactor-first list.",
    })
  }

  for (const repo of projects.filter((item) => !item.latest_health)) {
    add({
      repo,
      kind: "never-scanned",
      title: `${repo.name} has never been scanned`,
      detail: "Run its first scan to see its health.",
    })
  }

  for (const rescoring of activity?.rescoring ?? []) {
    const repo = projects.find((item) => item.id === rescoring.repo_id)
    if (!repo) continue
    add({
      repo,
      kind: "rescoring",
      title: `${repo.name} is being re-scored`,
      detail: `${rescoring.snapshots_left} ${rescoring.snapshots_left === 1 ? "scan" : "scans"} left to score under the current profile.`,
    })
  }
  return items
}

export type ProjectSort = "attention" | "health" | "recent" | "name"

export const PROJECT_SORTS: { value: ProjectSort; label: string }[] = [
  { value: "attention", label: "Needs attention first" },
  { value: "health", label: "Health, high to low" },
  { value: "recent", label: "Recently scanned" },
  { value: "name", label: "Name" },
]

export function sortProjects(projects: Repo[], mode: ProjectSort): Repo[] {
  const byName = (a: Repo, b: Repo) => a.name.localeCompare(b.name)
  const scanTime = (repo: Repo) =>
    Date.parse(repo.latest_health?.scanned_at ?? "") || 0
  return [...projects].sort((a, b) => {
    const ah = a.latest_health
    const bh = b.latest_health
    switch (mode) {
      case "attention":
        // Lowest health first; projects never scanned go last.
        if (!ah || !bh) return ah ? -1 : bh ? 1 : byName(a, b)
        return ah.score - bh.score || byName(a, b)
      case "health":
        if (!ah || !bh) return ah ? -1 : bh ? 1 : byName(a, b)
        return bh.score - ah.score || byName(a, b)
      case "recent":
        return scanTime(b) - scanTime(a) || byName(a, b)
      case "name":
        return byName(a, b)
    }
  })
}
