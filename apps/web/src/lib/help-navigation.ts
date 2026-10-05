import { helpArticles, type HelpArticle } from "./help-center"
import { analysisHelpArticles } from "./help-analysis"
import { extraHelpArticles } from "./help-articles-extra"

export type HelpTopic = {
  slug: string
  title: string
  description: string
  parent?: string
}
export const helpTopics: HelpTopic[] = [
  {
    slug: "analysis-methods",
    title: "How analysis works",
    description: "Debt detection, PMD, SATD, and scoring.",
  },
  {
    slug: "privacy",
    title: "Data and privacy",
    description: "Stored information, processing, and the privacy notice.",
  },
  {
    slug: "sign-in",
    title: "Sign in",
    description: "Asgardeo, your identity, sessions, and sign-out.",
  },
  {
    slug: "workspace",
    title: "Workspace",
    description: "Set up a workspace and manage your team.",
  },
  {
    slug: "team",
    parent: "workspace",
    title: "Team and invitations",
    description: "Invite teammates, accept links, and manage access.",
  },
  {
    slug: "projects",
    title: "Projects",
    description: "Connect repositories and choose projects and branches.",
  },
  {
    slug: "scanning",
    title: "Scanning",
    description: "Run scans, follow activity, and recover from failures.",
  },
  {
    slug: "dashboard",
    title: "Dashboard",
    description: "Read health reports, explore findings, and narrow the view.",
  },
  {
    slug: "filters",
    parent: "dashboard",
    title: "Filters",
    description: "Severity, detector source, done status, and test exclusions.",
  },
  {
    slug: "findings",
    parent: "dashboard",
    title: "Findings",
    description: "Evidence, prioritization, and triage.",
  },
  {
    slug: "history",
    title: "Scan history",
    description: "Browse snapshots, commits, and score changes.",
  },
  {
    slug: "profiles",
    title: "Scoring profiles",
    description: "Manage scoring defaults and project overrides.",
  },
  {
    slug: "profile-settings",
    parent: "profiles",
    title: "Weights and rule settings",
    description: "Control category weights, source trust, workspace rules, and comment rules.",
  },
  {
    slug: "account",
    title: "Account and appearance",
    description: "Theme, keyboard navigation, and account information.",
  },
  {
    slug: "troubleshooting",
    title: "Troubleshooting",
    description: "Resolve common failures and find answers.",
  },
]
const parents: Record<string, string> = {
  "get-started": "sign-in",
  "manage-workspaces": "workspace",
  "manage-projects": "projects",
  "run-and-stop-scans": "scanning",
  "understand-health-score": "dashboard",
  "review-findings": "findings",
  "use-scan-history": "history",
  "use-scoring-profiles": "profiles",
  troubleshoot: "troubleshooting",
}
export const allHelpArticles: HelpArticle[] = [
  ...helpArticles.map((article) => ({
    ...article,
    parent: parents[article.slug],
  })),
  ...extraHelpArticles,
  ...analysisHelpArticles,
]
export const findHelpTopic = (slug: string) =>
  helpTopics.find((topic) => topic.slug === slug)
export const findHelpArticle = (slug: string) =>
  allHelpArticles.find((article) => article.slug === slug)
export function helpTrail(parent?: string): HelpTopic[] {
  if (!parent) return []
  const topic = findHelpTopic(parent)
  return topic ? [...helpTrail(topic.parent), topic] : []
}
export function searchHelp(query: string) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  return allHelpArticles.filter((article) => {
    const content = [
      article.title,
      article.intro,
      article.description,
      ...helpTrail(article.parent).map((topic) => topic.title),
      ...article.sections.flatMap((section) => [
        section.heading,
        ...section.paragraphs,
        ...(section.steps ?? []),
        section.note ?? "",
      ]),
    ]
      .join(" ")
      .toLowerCase()
    return words.every((word) => content.includes(word))
  })
}
