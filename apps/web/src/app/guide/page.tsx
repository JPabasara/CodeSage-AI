import type { Metadata } from "next"
import type { ReactNode } from "react"
import Image from "next/image"
import Link from "next/link"
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  CircleHelp,
  FolderGit2,
  FolderMinus,
  GitBranch,
  History,
  LayoutDashboard,
  ListChecks,
  ScanSearch,
  SlidersHorizontal,
  Users,
  type LucideIcon,
} from "lucide-react"

import { gradeColor, severityColor } from "@/lib/utils"

export const metadata: Metadata = {
  title: "Product guide",
  description:
    "How CodeSage AI scans Java repositories, ranks technical debt, and scores repository health.",
}

const SECTIONS = [
  { id: "how-it-works", label: "How it works" },
  { id: "areas", label: "Areas" },
  { id: "analysis", label: "What is analysed" },
  { id: "scores", label: "Scores" },
  { id: "severity", label: "Severity" },
  { id: "roles", label: "Roles" },
  { id: "faq", label: "FAQ" },
] as const

const FACTS = [
  ["Language", "Java"],
  ["Repositories", "Public GitHub"],
  ["Custom profiles", "Up to 5 per workspace"],
  ["Re-scoring", "Live, no rescan needed"],
  ["History", "A snapshot per successful scan"],
] as const

const STEPS: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: Users,
    title: "Create a workspace",
    body: "Sign in, then create or pick a workspace in the top bar. A new workspace starts empty and you become its org admin.",
  },
  {
    icon: FolderGit2,
    title: "Connect a repository",
    body: "Paste the full URL of a public GitHub repository that contains Java. Connecting does not start a scan.",
  },
  {
    icon: GitBranch,
    title: "Scan a branch",
    body: "Choose the branch in the top bar and select Scan. Progress follows you from page to page.",
  },
  {
    icon: ListChecks,
    title: "Fix what ranks first",
    body: "Start at the top of Refactor first, check the evidence, fix the code, then rescan for fresh results.",
  },
]

type Area = { icon: LucideIcon; title: string; body: string; points: string[] }

const AREAS: Area[] = [
  {
    icon: Users,
    title: "Start with a workspace",
    body: "A workspace holds your projects, scans, findings, scoring profiles, and team. Your role decides which changes you can make.",
    points: [
      "Invite teammates by email; they sign in with the invited identity",
      "Switching workspace switches everything you see",
      "Deleting a workspace removes all of its data and cannot be undone",
    ],
  },
  {
    icon: FolderGit2,
    title: "Connect Java repositories",
    body: "This release accepts public GitHub repositories containing Java. CodeSage reads a repository but never writes to it or deletes it.",
    points: [
      "Connect with a full URL such as github.com/owner/repository",
      "The top-bar project picker decides where Dashboard and Scan history lead",
      "Removing a project deletes its CodeSage scans and findings, not the repository",
    ],
  },
  {
    icon: ScanSearch,
    title: "Run and stop scans",
    body: "A scan analyses one branch at one commit, and publishes a snapshot only when every stage succeeds.",
    points: [
      "Each branch keeps its own latest result and history",
      "A queued scan is waiting for the workspace's scan slot",
      "Stop takes effect between stages, so the current stage may finish first",
    ],
  },
  {
    icon: LayoutDashboard,
    title: "Read the dashboard",
    body: "Overview shows health and what to fix first. Findings lists ranked cards with a detail panel. Code map shows the repository tree.",
    points: [
      "New results never replace the report you are reading; choose Show them to switch",
      "Findings are shown ten to a page, highest priority first",
    ],
  },
  {
    icon: ListChecks,
    title: "Use findings carefully",
    body: "Critical and high findings deserve attention first. Open a card to see its location, rule, metrics, threshold, and a code excerpt when available.",
    points: [
      "Marking a finding done hides it from the open list, but does not improve the health score",
      "Done never edits GitHub or stops the issue being detected again",
      "Org admins can turn a rule off for the whole workspace from a finding's detail",
    ],
  },
  {
    icon: SlidersHorizontal,
    title: "Tune profiles",
    body: "A workspace can keep five custom profiles. Set a workspace default or apply an override to one project. Saved scans are re-scored without another scan.",
    points: [
      "Category weights decide what matters most; source trust balances rules against the model",
      "Built-in profiles are protected; duplicate one to customise it",
      "A profile in use as a default or override cannot be deleted",
    ],
  },
  {
    icon: FolderMinus,
    title: "Set directory exclusions",
    body: "Decide which folders are left out of scans or hidden from Refactor first. Detected test paths are ticked for you.",
    points: [
      "Untick a wrong match to treat it as production code",
      "Save and rescan to apply; older snapshots keep their original classification",
    ],
  },
  {
    icon: History,
    title: "Review scan history",
    body: "History keeps completed snapshots for each project and branch. Open one to review its result under the profile currently in force.",
    points: [
      "Delta compares a score with the snapshot before it; a dash means there is nothing to compare",
      "Files, metrics, and findings stay fixed; scores follow the current profile",
    ],
  },
  {
    icon: CircleHelp,
    title: "Get help",
    body: "Once signed in, Support opens a searchable Help Center and a guided New User Trial.",
    points: [
      "When reporting a problem, include workspace, project, branch, time, and scan ID",
      "Never share passwords, session cookies, tokens, or private source code",
    ],
  },
]

const SOURCES = [
  {
    title: "Code metrics and built-in rules",
    body: "Java metrics from CK and Git history such as churn feed built-in rules that check measurements and source patterns.",
  },
  {
    title: "PMD rules",
    body: "Optional Java static analysis, shown with pmd-prefixed rule IDs. A disabled or degraded run may add nothing, so a finished scan does not prove PMD coverage.",
  },
  {
    title: "Self-admitted debt (SATD)",
    body: "A model reads source comments for debt developers have admitted to, such as a shortcut or missing behaviour. It is more than a search for TODO.",
  },
  {
    title: "Defect-risk model",
    body: "Estimates defect risk from metrics. It moves a finding's priority up or down; it does not prove a bug exists.",
  },
]

const CATEGORIES = [
  ["Code design", "--category-code-design"],
  ["Security", "--category-security"],
  ["Test", "--category-test"],
  ["Documentation", "--category-documentation"],
  ["Requirement", "--category-requirement"],
] as const

// Best first, with widths following each grade's share of 0–100 so the bar reads as a scale.
const GRADES = [
  { grade: "A", range: "85–100", share: 15 },
  { grade: "B", range: "70–84.9", share: 15 },
  { grade: "C", range: "55–69.9", share: 15 },
  { grade: "D", range: "40–54.9", share: 15 },
  { grade: "E", range: "0–39.9", share: 40 },
] as const

const PRIORITY_FACTORS = [
  "Severity points",
  "Category weight",
  "Source trust",
  "Churn",
  "Risk",
]

const SEVERITIES = [
  ["critical", "Critical", "Review now; may expose serious risk."],
  ["high", "High", "Plan an early fix."],
  ["medium", "Medium", "Improve during normal refactoring."],
  ["low", "Low", "Useful cleanup with lower urgency."],
] as const

const ROLES = [
  [
    "Org admin",
    "Everything a manager can do, plus workspace settings, inviting and managing members, workspace-wide rules, and deleting the workspace.",
  ],
  [
    "Manager",
    "Connect and remove projects, start and stop any scan, edit scoring profiles, and triage findings.",
  ],
  [
    "Developer",
    "Start scans and stop their own, and mark findings done or reopen them.",
  ],
  ["Viewer", "Read projects, results, history, profiles, and the team list."],
] as const

const FAQ = [
  [
    "Why did my score change without a new scan?",
    "Findings are stored; scores are worked out when you read them. Changing the workspace default, a project override, category weights, or source trust re-scores current and older snapshots straight away.",
  ],
  [
    "What does Mark as done do?",
    "It is a status your team shares. It does not edit GitHub, fix code, or stop the issue being detected next time. Fix the repository and scan the branch again for fresh evidence.",
  ],
  [
    "Why is my scan still queued?",
    "A queued scan is waiting for the workspace's scan slot, usually because another scan is running. Check the activity indicator before starting another.",
  ],
  [
    "Why does stopping take time?",
    "Stop is checked between stages, so the current clone, extraction, or detection stage may finish first. This keeps partial findings from replacing your last complete snapshot.",
  ],
  [
    "Which languages and repositories are supported?",
    "Java in public GitHub repositories. Private repositories and other languages are not available yet, and a branch with no Java files is rejected.",
  ],
  [
    "Why can't I edit or delete a profile?",
    "Built-in profiles are protected, so duplicate one instead. A custom profile cannot be deleted while it is the workspace default or assigned to a project.",
  ],
  [
    "Does a high score mean the code is bug-free?",
    "No. Health is a prioritisation aid, not a security certification or a promise that the code is correct. Review each finding's evidence before acting on it.",
  ],
] as const

export default function ProductGuidePage() {
  return (
    <div className="relative min-h-svh bg-background text-foreground">
      {/* Sits over the hero, so the waves run behind the brand as one band. */}
      <header className="absolute inset-x-0 top-0 z-10">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Image
            src="/codesage-refactor-branch-logo.svg"
            alt="CodeSage AI"
            width={180}
            height={48}
            priority
            className="h-12 w-auto"
          />
          <nav aria-label="Site" className="flex items-center gap-2 sm:gap-4">
            <Link
              href="/privacy"
              className="hidden rounded-md px-2 py-1 text-sm font-medium text-zinc-300 hover:text-white focus-visible:ring-2 focus-visible:ring-emerald-300 focus-visible:outline-none sm:inline"
            >
              Privacy
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-400 px-3.5 py-2 text-sm font-semibold text-zinc-950 shadow-sm transition-colors hover:bg-emerald-300 focus-visible:ring-2 focus-visible:ring-emerald-200 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 focus-visible:outline-none"
            >
              Open CodeSage
            </Link>
          </nav>
        </div>
      </header>

      <main id="main-content">
        <section
          aria-labelledby="guide-title"
          className="relative isolate overflow-hidden border-b border-white/10 bg-zinc-950 text-white"
        >
          <WavePattern />
          <div className="mx-auto grid max-w-6xl gap-10 px-4 pt-28 pb-14 sm:px-6 sm:pt-32 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-center">
            <div className="space-y-5">
              <p className="inline-flex items-center gap-2 rounded-full border border-emerald-300/30 bg-emerald-300/10 px-3 py-1 text-xs font-medium text-emerald-200">
                <BookOpen className="size-3.5" aria-hidden="true" /> Product
                guide
              </p>
              <h1
                id="guide-title"
                className="text-4xl font-semibold tracking-tight sm:text-5xl"
              >
                Understand CodeSage AI
              </h1>
              <p className="max-w-2xl text-base leading-7 text-zinc-300 sm:text-lg sm:leading-8">
                Learn what each area does, how results are ranked, and what the
                selected thresholds mean. This guide is public and does not
                require an account.
              </p>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/4 p-5 backdrop-blur-sm">
              <h2 className="mb-3 text-xs font-semibold tracking-[0.08em] text-emerald-300 uppercase">
                At a glance
              </h2>
              <dl>
                {FACTS.map(([term, value]) => (
                  <div
                    key={term}
                    className="flex items-baseline justify-between gap-4 border-t border-white/10 py-2.5 first:border-t-0"
                  >
                    <dt className="text-sm text-zinc-400">{term}</dt>
                    <dd className="text-right text-sm font-medium text-white">
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>

            <nav aria-label="On this page" className="lg:col-span-2">
              <ul className="flex flex-wrap gap-2">
                {SECTIONS.map((section) => (
                  <li key={section.id}>
                    <a
                      href={`#${section.id}`}
                      className="inline-flex rounded-full border border-white/15 bg-white/5 px-3.5 py-1.5 text-sm text-zinc-200 transition-colors hover:border-emerald-300/60 hover:text-white focus-visible:ring-2 focus-visible:ring-emerald-300 focus-visible:outline-none"
                    >
                      {section.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        </section>

        <div className="mx-auto max-w-6xl space-y-16 px-4 py-14 sm:px-6">
          <GuideSection
            id="how-it-works"
            eyebrow="How it works"
            title="From repository to ranked fixes"
            description="Four steps take you from an empty workspace to a list of what to refactor first."
          >
            <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((step, index) => (
                <li
                  key={step.title}
                  className="relative rounded-xl border bg-card p-5 shadow-xs"
                >
                  <div className="flex items-center gap-3">
                    <span className="grid size-8 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                      {index + 1}
                    </span>
                    <step.icon
                      className="size-5 text-primary"
                      aria-hidden="true"
                    />
                  </div>
                  <h3 className="mt-4 text-base font-semibold text-foreground-strong">
                    {step.title}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-foreground">
                    {step.body}
                  </p>
                </li>
              ))}
            </ol>
          </GuideSection>

          <GuideSection
            id="areas"
            eyebrow="Areas"
            title="What each area does"
            description="Every part of CodeSage, and the details that are easy to miss."
          >
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {AREAS.map((area) => (
                <AreaCard key={area.title} area={area} />
              ))}
            </div>
          </GuideSection>

          <GuideSection
            id="analysis"
            eyebrow="What is analysed"
            title="Where findings come from"
            description="Static analysis and comment classification run side by side. Review each finding against its evidence."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              {SOURCES.map((source) => (
                <div
                  key={source.title}
                  className="rounded-xl border bg-card p-5 shadow-xs"
                >
                  <h3 className="text-base font-semibold text-foreground-strong">
                    {source.title}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-foreground">
                    {source.body}
                  </p>
                </div>
              ))}
            </div>
            <div className="mt-5 rounded-xl border bg-card p-5 shadow-xs">
              <h3 className="text-base font-semibold text-foreground-strong">
                Debt categories
              </h3>
              <ul className="mt-3 flex flex-wrap gap-2">
                {CATEGORIES.map(([label, token]) => (
                  <li
                    key={label}
                    className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-medium"
                  >
                    <span
                      aria-hidden="true"
                      className="size-2.5 rounded-full"
                      style={{ backgroundColor: `var(${token})` }}
                    />
                    {label}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                The comment model never predicts Security; security findings
                come from rules, and the trust slider cannot de-weight them.
              </p>
            </div>
          </GuideSection>

          <GuideSection
            id="scores"
            eyebrow="Scores"
            title="Read the health score"
            description="A higher score means better maintainability under the active profile. Severity describes impact; priority decides what appears first."
          >
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border bg-card p-5 shadow-xs">
                <h3 className="text-base font-semibold text-foreground-strong">
                  Health grades
                </h3>
                <div
                  aria-hidden="true"
                  className="mt-4 flex h-3 overflow-hidden rounded-full"
                >
                  {GRADES.map((band) => (
                    <span
                      key={band.grade}
                      style={{
                        width: `${band.share}%`,
                        backgroundColor: gradeColor(band.grade),
                      }}
                      className="border-r-2 border-card last:border-r-0"
                    />
                  ))}
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-5">
                  {GRADES.map((band) => (
                    <ScoreBand
                      key={band.grade}
                      grade={band.grade}
                      range={band.range}
                    />
                  ))}
                </div>
                <p className="mt-4 text-sm leading-6 text-foreground">
                  Health runs from 0 to 100. Debt is weighed against the amount
                  of Java code, measured in thousands of lines (KLOC).
                </p>
                <p className="mt-2 rounded-md bg-muted px-3 py-2 font-mono text-xs leading-5 text-foreground">
                  Health = 100 × (1 − min(1, debt ÷ (k × KLOC)))
                </p>
              </div>

              <div className="rounded-xl border bg-card p-5 shadow-xs">
                <h3 className="text-base font-semibold text-foreground-strong">
                  How Refactor first is ordered
                </h3>
                <p className="mt-4 flex flex-wrap items-center gap-x-1.5 gap-y-2 text-sm">
                  {PRIORITY_FACTORS.map((factor, index) => (
                    <span key={factor} className="contents">
                      {index > 0 ? (
                        <span className="text-muted-foreground">×</span>
                      ) : null}
                      <span className="rounded-md border border-primary/30 bg-primary/10 px-2 py-1 font-medium text-foreground-strong">
                        {factor}
                      </span>
                    </span>
                  ))}
                </p>
                <p className="mt-4 text-sm leading-6 text-foreground">
                  Severity alone does not decide the order, so two findings with
                  the same severity can rank differently.
                </p>
                <p className="mt-2 text-sm leading-6 text-foreground">
                  Scores are worked out when you read them, so a profile change
                  re-scores current and older snapshots without a rescan.
                </p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Category weights stay between 0.1 and 3.0. Source trust stays
                  between 0 and 1 so results remain comparable.
                </p>
              </div>
            </div>
          </GuideSection>

          <GuideSection
            id="severity"
            eyebrow="Severity"
            title="Severity guide"
            description="Severity says how serious a finding is on its own. Work from the top down."
          >
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {SEVERITIES.map(([key, label, text]) => (
                <li
                  key={key}
                  className="rounded-xl border border-t-4 bg-card p-5 shadow-xs"
                  style={{ borderTopColor: severityColor(key) }}
                >
                  <p className="flex items-center gap-2 text-base font-semibold text-foreground-strong">
                    <span
                      aria-hidden="true"
                      className="size-2.5 rounded-full"
                      style={{ backgroundColor: severityColor(key) }}
                    />
                    {label}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-foreground">
                    {text}
                  </p>
                </li>
              ))}
            </ul>
          </GuideSection>

          <GuideSection
            id="roles"
            eyebrow="Roles"
            title="Who can do what"
            description="Everyone in a workspace can read its results. A greyed-out control usually means your role lacks that permission."
          >
            <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Workspace roles</caption>
                <thead className="bg-muted/60 text-xs tracking-[0.06em] text-muted-foreground uppercase">
                  <tr>
                    <th scope="col" className="w-36 px-5 py-3 font-semibold">
                      Role
                    </th>
                    <th scope="col" className="px-5 py-3 font-semibold">
                      Can
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {ROLES.map(([role, can]) => (
                    <tr key={role}>
                      <th
                        scope="row"
                        className="px-5 py-4 align-top font-semibold text-foreground-strong"
                      >
                        {role}
                      </th>
                      <td className="px-5 py-4 leading-6 text-foreground">
                        {can}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </GuideSection>

          <GuideSection
            id="faq"
            eyebrow="FAQ"
            title="Frequently asked questions"
            description="Short answers to what people ask most."
          >
            <div className="divide-y overflow-hidden rounded-xl border bg-card shadow-xs">
              {FAQ.map(([question, answer]) => (
                <details key={question} className="group">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-sm font-semibold text-foreground-strong hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset [&::-webkit-details-marker]:hidden">
                    {question}
                    <ChevronDown
                      className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                      aria-hidden="true"
                    />
                  </summary>
                  <p className="px-5 pb-4 text-sm leading-6 text-foreground">
                    {answer}
                  </p>
                </details>
              ))}
            </div>
          </GuideSection>

          <section
            aria-labelledby="get-started-title"
            className="relative isolate overflow-hidden rounded-2xl bg-zinc-950 px-6 py-10 text-white sm:px-10"
          >
            <WavePattern />
            <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
              <div className="max-w-xl space-y-2">
                <h2
                  id="get-started-title"
                  className="text-2xl font-semibold tracking-tight"
                >
                  Ready to rank your technical debt?
                </h2>
                <p className="text-sm leading-6 text-zinc-300">
                  Sign in with your organisation account, connect a public Java
                  repository, and run your first scan.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <Link
                  href="/login"
                  className="inline-flex items-center gap-2 rounded-md bg-emerald-400 px-4 py-2.5 text-sm font-semibold text-zinc-950 transition-colors hover:bg-emerald-300 focus-visible:ring-2 focus-visible:ring-emerald-200 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 focus-visible:outline-none"
                >
                  Sign in to start
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
                <Link
                  href="/privacy"
                  className="rounded-sm text-sm font-medium text-emerald-200 underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-emerald-300 focus-visible:outline-none"
                >
                  Read the privacy notice
                </Link>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  )
}

/** Mint waves on black: the brand band behind the hero and the closing call. */
function WavePattern() {
  const lines = Array.from({ length: 9 }, (_, i) => {
    const y = 150 + i * 24
    const a = 30 + i * 6
    const s = i * 22
    return `M${-60 - s} ${y} C ${220 - s} ${y - a} ${460 - s} ${y + a} ${720 - s} ${y} S ${1220 - s} ${y + a} ${1500 - s} ${y}`
  })
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -z-10"
    >
      <div className="absolute -top-40 -right-24 size-136 rounded-full bg-emerald-400/20 blur-3xl" />
      <div className="absolute -bottom-48 -left-24 size-112 rounded-full bg-emerald-500/10 blur-3xl" />
      <svg
        className="absolute inset-0 size-full"
        viewBox="0 0 1440 420"
        preserveAspectRatio="none"
        fill="none"
      >
        {lines.map((d, i) => (
          <path
            key={d}
            d={d}
            stroke="#34D399"
            strokeOpacity={0.12 + i * 0.035}
            strokeWidth={1.25}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <path
          d="M0 360 C 240 320 480 400 720 360 S 1200 320 1440 360 V420 H0 Z"
          fill="#34D399"
          fillOpacity={0.08}
        />
        <path
          d="M0 392 C 260 366 520 418 760 392 S 1220 368 1440 392 V420 H0 Z"
          fill="#34D399"
          fillOpacity={0.1}
        />
      </svg>
    </div>
  )
}

function GuideSection({
  id,
  eyebrow,
  title,
  description,
  children,
}: Readonly<{
  id: string
  eyebrow: string
  title: string
  description: string
  children: ReactNode
}>) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-6">
      <div className="mb-6 max-w-3xl space-y-2">
        <p className="text-xs font-semibold tracking-[0.08em] text-primary uppercase">
          {eyebrow}
        </p>
        <h2
          id={`${id}-title`}
          className="text-2xl font-semibold tracking-tight text-foreground-strong"
        >
          {title}
        </h2>
        <p className="text-base leading-7 text-muted-foreground">
          {description}
        </p>
      </div>
      {children}
    </section>
  )
}

function AreaCard({ area }: Readonly<{ area: Area }>) {
  return (
    <article className="flex flex-col rounded-xl border bg-card p-5 shadow-xs">
      <span className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary">
        <area.icon className="size-5" aria-hidden="true" />
      </span>
      <h3 className="mt-4 text-base font-semibold text-foreground-strong">
        {area.title}
      </h3>
      <p className="mt-2 text-sm leading-6 text-foreground">{area.body}</p>
      <ul className="mt-4 space-y-2 border-t pt-4">
        {area.points.map((point) => (
          <li
            key={point}
            className="flex gap-2 text-sm leading-6 text-muted-foreground"
          >
            <Check
              className="mt-1 size-4 shrink-0 text-primary"
              aria-hidden="true"
            />
            {point}
          </li>
        ))}
      </ul>
    </article>
  )
}

function ScoreBand({
  grade,
  range,
}: Readonly<{ grade: string; range: string }>) {
  return (
    <div
      className="rounded-lg border border-t-4 bg-muted/30 px-2 py-3 text-center"
      style={{ borderTopColor: gradeColor(grade) }}
    >
      <p className="text-sm font-semibold text-foreground-strong">
        Grade {grade}
      </p>
      <p className="mt-1 text-xs text-muted-foreground tabular-nums">{range}</p>
    </div>
  )
}
