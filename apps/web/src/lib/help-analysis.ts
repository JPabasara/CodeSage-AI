import type { HelpArticle } from "./help-center"

export const analysisHelpArticles: HelpArticle[] = [
  {
    slug: "stored-data",
    parent: "privacy",
    category: "Data and privacy",
    title: "What CodeSage stores",
    description:
      "CodeSage stores account and analysis records so your team can revisit results and manage access.",
    intro:
      "CodeSage stores account and analysis records so your team can revisit results and manage access.",
    sections: [
      {
        heading: "Account and workspace records",
        paragraphs: [
          "Account identity, display name, email, identity-provider association, workspace membership and roles, invitations, and security audit records support sign-in and collaboration. Server-side sessions contain a hash of the browser token and session timestamps.",
        ],
      },
      {
        heading: "Repository and analysis records",
        paragraphs: [
          "Stored results include repository URLs, branches, commit identifiers, scan status and errors, snapshots, file paths and source locations, source-scope classification, code metrics, Git-derived metrics, findings, fingerprints, triage status, model versions and predictions, and scoring profiles.",
        ],
      },
      {
        heading: "Comments and evidence",
        paragraphs: [
          "SATD findings retain the relevant comment as evidence. Other findings may contain descriptions or evidence derived from code. Removing a temporary clone does not remove these stored excerpts.",
        ],
      },
      {
        heading: "Temporary files and removal",
        paragraphs: [
          "Workers clone repositories for analysis and attempt to remove the clone when work completes, fails, or is cancelled. A crash may delay cleanup. Removing projects or workspaces removes associated application records according to their deletion behavior; backups and infrastructure logs have separate deployment retention.",
        ],
      },
    ],
    related: ["debt-detection", "satd-detection", "scoring-method"],
  },
  {
    slug: "debt-detection",
    parent: "analysis-methods",
    category: "How analysis works",
    title: "How technical debt is detected",
    description:
      "CodeSage combines static analysis and comment classification. Each finding should be reviewed against its evidence.",
    intro:
      "CodeSage combines static analysis and comment classification. Each finding should be reviewed against its evidence.",
    sections: [
      {
        heading: "Metrics and built-in rules",
        paragraphs: [
          "Java metrics are extracted with CK; Git history supplies process metrics such as churn. Built-in rules examine metrics and source patterns and produce findings with severity, category, location, and available measured evidence.",
        ],
      },
      {
        heading: "PMD analysis",
        paragraphs: [
          "When enabled for a worker, PMD adds Java static-analysis findings using the configured rule profile. These appear as Rule-based findings with pmd-prefixed rule identifiers. PMD is optional: a disabled, timed-out, or degraded run may contribute no findings, so scan completion alone does not prove PMD coverage.",
        ],
      },
      {
        heading: "SATD and risk prediction",
        paragraphs: [
          "Source comments are classified separately for self-admitted technical debt. A separate risk model estimates defect risk from metrics; that estimate influences priority rather than proving a defect exists.",
        ],
      },
      {
        heading: "Coverage and limits",
        paragraphs: [
          "The current scanner targets Java. Static analysis can miss issues or flag acceptable code. Review reasons and source context before deciding on a fix. A clean result is not a guarantee of security or correctness.",
        ],
      },
    ],
    related: ["satd-detection", "scoring-method", "stored-data"],
  },
  {
    slug: "satd-detection",
    parent: "analysis-methods",
    category: "How analysis works",
    title: "How self-admitted technical debt is detected",
    description:
      "SATD is debt described by developers in source comments, such as an acknowledged shortcut or missing behavior.",
    intro:
      "SATD is debt described by developers in source comments, such as an acknowledged shortcut or missing behavior.",
    sections: [
      {
        heading: "Comments become model inputs",
        paragraphs: [
          "The comment extractor collects source comments and locations. The API sends comment text in batches to the configured ML inference service. The model predicts whether a comment expresses debt and, if so, its category.",
        ],
      },
      {
        heading: "Categories and confidence",
        paragraphs: [
          "The SATD classifier uses code-design, requirement, documentation, and test categories. It does not predict the security category. Results include model version and confidence; confidence is not severity and is not a guarantee that the prediction is correct.",
        ],
      },
      {
        heading: "Severity is assigned separately",
        paragraphs: [
          "A deterministic marker table sets severity from the comment text. Higher-precedence markers win when several match. A predicted debt comment with no recognized marker receives the configured default severity. Detection is therefore more than searching for TODO or FIXME.",
        ],
      },
      {
        heading: "Review and storage",
        paragraphs: [
          "The selected comment is retained as finding evidence with its location and prediction details. Use the SATD source filter and inspect the reason before triaging it. Marking it done does not edit the comment or retrain the model.",
        ],
      },
    ],
    related: ["debt-detection", "scoring-method", "stored-data"],
  },
  {
    slug: "scoring-method",
    parent: "analysis-methods",
    category: "How analysis works",
    title: "How findings and repository health are scored",
    description:
      "Scores combine detected facts with the effective scoring profile. Severity, confidence, risk, and health describe different things.",
    intro:
      "Scores combine detected facts with the effective scoring profile. Severity, confidence, risk, and health describe different things.",
    sections: [
      {
        heading: "Finding priority",
        paragraphs: [
          "Priority = severity base points × category weight × source trust × churn factor × risk factor. Both PMD and built-in findings use the rule source; SATD uses the model source. Model confidence is not an extra multiplier in this formula.",
        ],
      },
      {
        heading: "Source trust, churn, and risk",
        paragraphs: [
          "With trust setting s, rule trust is 0.5 + s and model trust is 1.5 − s. Security findings use source trust 1. Churn increases priority using capped recent commit activity. Risk further adjusts priority using the model trust and predicted risk.",
        ],
      },
      {
        heading: "Health and test scope",
        paragraphs: [
          "Health = 100 × (1 − min(1, total included debt / (k × included KLOC))). KLOC means thousands of lines; k is a configured normalization constant. The active profile controls test-finding inclusion, and health debt and code size use the same scope. List filters do not change this profile setting.",
        ],
      },
      {
        heading: "Comparisons and limitations",
        paragraphs: [
          "Stored findings can be re-scored when profiles change, including older snapshots. Compare results under the same effective profile and source scope. A health score is a prioritization aid, not a security certification or a probability that the repository is bug-free.",
        ],
      },
    ],
    related: ["debt-detection", "satd-detection", "stored-data"],
  },
  {
    slug: "privacy-notice",
    parent: "privacy",
    category: "Data and privacy",
    title: "Privacy notice",
    description:
      "This notice describes data handling visible in the current CodeSage implementation. It is not a claim about an operator’s unverified hosting or retention practices.",
    intro:
      "This notice describes data handling visible in the current CodeSage implementation. It is not a claim about an operator’s unverified hosting or retention practices.",
    sections: [
      {
        heading: "Why information is processed",
        paragraphs: [
          "CodeSage uses identity information to authenticate users, memberships to control workspace access, repository data to analyze technical debt, and operational records to run and troubleshoot the service.",
        ],
      },
      {
        heading: "Data and processing services",
        paragraphs: [
          "Account, session, workspace, invitation, repository, analysis, and evidence records are processed. Authentication goes through Asgardeo and its configured identity provider. GitHub supplies repository data. Invitations use the configured email integration. Comment text and code metrics are sent to the configured ML service. Hosting, database, queue, and logging operators may process the corresponding service data.",
        ],
      },
      {
        heading: "Cookies and browser preferences",
        paragraphs: [
          "The browser uses a session cookie for authenticated access. The backend stores a hash of its token. Browser storage also holds interface preferences and temporary workflow state, such as a pending invitation. Signing out revokes the CodeSage session; it does not delete stored scan history.",
        ],
      },
      {
        heading: "Source code and access",
        paragraphs: [
          "Repositories are cloned for analysis. Temporary clone cleanup is attempted after scans, but finding descriptions and comment evidence remain in stored results. Workspace permissions restrict application access; operational administrators may have infrastructure access.",
        ],
      },
      {
        heading: "Retention and deletion",
        paragraphs: [
          "The application retains analysis history until removed through supported project or workspace operations. The code alone does not establish a universal backup or log retention schedule. Workspace deletion does not mean all copies in provider backups are immediately erased. Contact the deployment operator for applicable retention and deletion arrangements.",
        ],
      },
      {
        heading: "Questions and deployment details",
        paragraphs: [
          "Ask the organization or project team operating this deployment about privacy questions and requests. The operator’s legal identity, privacy contact, hosting regions, backup retention, and any use of data beyond this scan workflow must be confirmed by that operator; those details are not established by this notice.",
        ],
      },
    ],
    related: ["stored-data"],
  },
]
