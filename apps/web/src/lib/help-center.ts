export type HelpArticle = {
  parent?: string
  slug: string
  category: string
  title: string
  description: string
  intro: string
  sections: {
    heading: string
    paragraphs: string[]
    steps?: string[]
    note?: string
  }[]
  related: string[]
}

export const helpArticles: HelpArticle[] = [
  {
    slug: "get-started",
    category: "Get started",
    title: "Set up CodeSage and run your first scan",
    description:
      "Create a workspace, connect a repository, and produce your first report.",
    intro:
      "CodeSage turns a Java repository into a prioritized technical-debt report. Everything belongs to a workspace, so setup begins there.",
    sections: [
      {
        heading: "Before you begin",
        paragraphs: [
          "You need a public GitHub repository containing Java source code. Private-repository access and non-Java analysis are not available in the current version. A branch without Java files is rejected with a No Java files message.",
        ],
      },
      {
        heading: "Run your first scan",
        paragraphs: ["Connecting a repository does not scan it automatically."],
        steps: [
          "Sign in and create or select a workspace.",
          "Open Projects and paste the full public GitHub URL.",
          "Open the project dashboard and choose the branch in the top bar.",
          "Select Scan and follow progress.",
          "When the result is ready, choose Show them to open the new snapshot.",
        ],
      },
      {
        heading: "If the result is empty",
        paragraphs: [
          "Confirm the selected branch contains Java. Review Directory exclusions and use Show excluded findings to check scanned test paths. A clean Java project can also legitimately return no findings.",
        ],
      },
    ],
    related: [
      "run-and-stop-scans",
      "understand-health-score",
      "manage-projects",
    ],
  },
  {
    slug: "manage-workspaces",
    category: "Workspace & team",
    title: "Manage workspaces, teammates, and roles",
    description:
      "Understand workspace boundaries, invitations, permissions, and deletion.",
    intro:
      "A workspace is an isolated home for projects, scans, findings, profiles, and teammates. Switching workspaces changes the entire data context.",
    sections: [
      {
        heading: "Create or switch workspace",
        paragraphs: [
          "Use the workspace picker in the top bar. A new workspace starts empty and you become its org admin. Projects and profiles are not copied from the previous workspace.",
        ],
      },
      {
        heading: "Invite teammates",
        paragraphs: [
          "Someone with member-management permission can send, review, and revoke invitations. The recipient must open the unique email link and sign in with the invited identity.",
        ],
      },
      {
        heading: "Understand roles",
        paragraphs: [
          "Org admins control settings, deletion, and membership. Managers handle project, scan, profile, and finding work. Team administration requires member-management permission. Developers and viewers have progressively fewer write actions. A disabled control normally means the active-workspace role lacks that permission.",
        ],
      },
      {
        heading: "Delete a workspace",
        paragraphs: [
          "Deletion permanently removes its projects, scans, findings, profiles, invitations, and memberships. GitHub repositories and other CodeSage workspaces are not affected.",
        ],
        note: "Workspace deletion cannot be undone.",
      },
    ],
    related: ["manage-projects", "use-scoring-profiles", "troubleshoot"],
  },
  {
    slug: "manage-projects",
    category: "Projects",
    title: "Connect, select, and remove projects",
    description: "Manage public GitHub repositories in the active workspace.",
    intro:
      "A CodeSage project is a connection to a GitHub repository. It stores analysis data but never writes to or deletes the repository itself.",
    sections: [
      {
        heading: "Connect a project",
        paragraphs: [
          "Open Projects and enter a full URL such as https://github.com/owner/repository. Only public GitHub repositories are currently supported. Connecting requires manager or org-admin permission.",
        ],
      },
      {
        heading: "Select a project",
        paragraphs: [
          "The top-bar project picker controls where the Dashboard and Scan History navigation links lead. Direct project links still open the project named in the URL.",
        ],
      },
      {
        heading: "Remove a project",
        paragraphs: [
          "Removing a project deletes its CodeSage scans, snapshots, and findings from this workspace. It does not change GitHub.",
        ],
        note: "Removal is destructive for stored CodeSage history.",
      },
    ],
    related: ["get-started", "run-and-stop-scans", "manage-workspaces"],
  },
  {
    slug: "run-and-stop-scans",
    category: "Scanning",
    title: "Run, monitor, and stop scans",
    description:
      "Learn scan stages, branch behavior, cancellation, and result delivery.",
    intro:
      "A scan analyzes one branch at one commit and publishes a snapshot only after the full pipeline succeeds.",
    sections: [
      {
        heading: "Choose the correct branch",
        paragraphs: [
          "Branches have separate latest snapshots and histories. The branch selected in the app bar is the branch the Scan action analyzes.",
        ],
      },
      {
        heading: "What happens during a scan",
        paragraphs: [
          "The worker clones the repository, reads Java and Git metrics, detects findings, finalizes one transaction, and calculates the report. Progress follows you across pages. A queued scan is waiting for the workspace scan slot.",
        ],
      },
      {
        heading: "Stop a scan",
        paragraphs: [
          "Stop is checked between pipeline stages. The current clone, extraction, or detection stage may finish first. This delay prevents partial findings from replacing the last complete snapshot.",
        ],
      },
      {
        heading: "Open completed results",
        paragraphs: [
          "If results arrive while you are reading an older report, CodeSage keeps it pinned. Choose Show them to switch deliberately to the new snapshot.",
        ],
      },
    ],
    related: ["get-started", "use-scan-history", "troubleshoot"],
  },
  {
    slug: "understand-health-score",
    category: "Dashboard",
    title: "Understand health scores and Refactor first",
    description: "Learn what the grade means and why finding order can change.",
    intro:
      "Repository health summarizes weighted technical-debt density. It is a decision aid, not a test-coverage or correctness score.",
    sections: [
      {
        heading: "Read the grade",
        paragraphs: [
          "Health ranges from 0 to 100. A is 85 or higher, B is 70–84, C is 55–69, D is 40–54, and E is below 40. Debt is normalized by Java code size.",
        ],
      },
      {
        heading: "Understand priority",
        paragraphs: [
          "Refactor first is not sorted by severity alone. Base points are adjusted by category weight, detector trust, code churn, and risk. Two findings with equal severity can therefore rank differently.",
        ],
      },
      {
        heading: "Why scores change without scanning",
        paragraphs: [
          "Findings are stored, while scores are derived when read. Changing the workspace default, project override, profile weights or source trust can re-score current and historical snapshots immediately.",
        ],
      },
      {
        heading: "Choose a dashboard view",
        paragraphs: [
          "Overview emphasizes health and priorities. Findings shows ranked cards and a detail panel. Code map shows the repository tree. Open scan history to view past scans.",
        ],
      },
    ],
    related: ["review-findings", "use-scoring-profiles", "use-scan-history"],
  },
  {
    slug: "review-findings",
    category: "Findings",
    title: "Review, triage, and classify findings",
    description:
      "Interpret evidence, mark work done, and configure test paths.",
    intro:
      "A finding describes detected technical debt at a source location. Its severity and weighted priority answer different questions.",
    sections: [
      {
        heading: "Read finding detail",
        paragraphs: [
          "Cards emphasize concise finding text. Use Previous and Next to browse ten findings per page. Select a card to see the source location, rule, metrics, threshold, and code excerpt when available. Severity describes the issue; priority estimates its refactoring value.",
        ],
      },
      {
        heading: "Mark as done or reopen",
        paragraphs: [
          "Done is a collaboration status. It does not edit GitHub, fix code, or suppress future detection. Fix the repository and scan the updated branch for fresh evidence.",
        ],
      },
      {
        heading: "Disable a rule across the workspace",
        paragraphs: [
          "Org admins can choose Disable this rule in a built-in or PMD finding’s detail card. Confirm the workspace-wide change. It affects future scans; existing findings remain visible. Re-enable the rule in Profiles → Rule selection. This is separate from marking an individual finding done.",
        ],
      },
      {
        heading: "Configure source scope",
        paragraphs: [
          "Open Directory exclusions to choose Exclude from scans or Hide from Refactor first by default. Detected test paths are preselected; untick incorrect matches to treat them as production code. Save and rescan to apply changed classification. Existing snapshots keep their original classification.",
        ],
      },
    ],
    related: [
      "understand-health-score",
      "run-and-stop-scans",
      "use-scoring-profiles",
    ],
  },
  {
    slug: "use-scan-history",
    category: "History",
    title: "Use scan history and snapshots",
    description: "Open earlier commits and interpret score deltas correctly.",
    intro:
      "Every successful scan creates an immutable snapshot of detected facts for one branch and commit.",
    sections: [
      {
        heading: "Open a snapshot",
        paragraphs: [
          "Choose a row in Scan History to pin the dashboard to that snapshot. Return to latest results to leave the historical view.",
        ],
      },
      {
        heading: "Read delta",
        paragraphs: [
          "Delta compares a snapshot score with the preceding snapshot in its sequence. A dash means no meaningful previous change is available, including the oldest result.",
        ],
      },
      {
        heading: "Facts are fixed; scores are live",
        paragraphs: [
          "Files, metrics, and findings belong to the saved snapshot. Displayed scores and deltas use the profile currently in force, so they can change after a profile edit without rewriting history.",
        ],
      },
    ],
    related: [
      "run-and-stop-scans",
      "understand-health-score",
      "use-scoring-profiles",
    ],
  },
  {
    slug: "use-scoring-profiles",
    category: "Profiles",
    title: "Create and assign scoring profiles",
    description:
      "Configure weights, trust, defaults, overrides, and workspace rules.",
    intro:
      "Profiles express what technical debt matters most to a workspace or project. They change scoring, not detection.",
    sections: [
      {
        heading: "Workspace default and project override",
        paragraphs: [
          "Every project inherits the workspace default unless assigned its own profile. Clearing the override makes it inherit the current default again.",
        ],
      },
      {
        heading: "Edit profile values",
        paragraphs: [
          "Category weights change relative importance. Source trust adjusts detector contribution. Saving recalculates existing results without scanning. Directory exclusions are configured separately per repository; workspace rules control future detection.",
        ],
      },
      {
        heading: "Built-in and custom profiles",
        paragraphs: [
          "Built-ins are protected and cannot be edited or deleted; create or duplicate a custom profile instead. A custom profile cannot be deleted while it is the default or assigned to a project.",
        ],
      },
    ],
    related: ["understand-health-score", "review-findings", "use-scan-history"],
  },
  {
    slug: "troubleshoot",
    category: "Troubleshooting",
    title: "Troubleshoot scans, permissions, and loading errors",
    description:
      "Resolve common problems and collect useful diagnostic details.",
    intro:
      "Most problems fall into repository scope, workspace permissions, scan state, or a temporary service failure.",
    sections: [
      {
        heading: "An action is disabled",
        paragraphs: [
          "Check your role in the active workspace. Ask an org admin if you need a write permission. The API verifies permissions even if a control appears enabled.",
        ],
      },
      {
        heading: "A scan stays queued",
        paragraphs: [
          "Another scan may own the workspace slot. Check the activity and scan indicators before starting another. If no scan is progressing, report the queued scan ID and approximate start time.",
        ],
      },
      {
        heading: "A page does not load",
        paragraphs: [
          "Use Retry if offered, confirm the active workspace and project, then refresh once. Do not repeatedly start scans while status is unknown.",
        ],
      },
      {
        heading: "Report a problem",
        paragraphs: [
          "Include workspace, project, branch, time, scan or snapshot ID, commit, and exact message. Never send passwords, session cookies, access tokens, or private source code.",
        ],
      },
    ],
    related: ["run-and-stop-scans", "manage-workspaces", "get-started"],
  },
]

export const articleBySlug = (slug: string) =>
  helpArticles.find((article) => article.slug === slug)
export const helpCategories = [
  ...new Set(helpArticles.map((article) => article.category)),
]
