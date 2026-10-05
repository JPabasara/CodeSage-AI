import type { HelpArticle } from "./help-center"

export const extraHelpArticles: HelpArticle[] = [
  {
    slug: "sign-in-asgardeo",
    parent: "sign-in",
    category: "Help",
    title: "Sign in with Asgardeo",
    description:
      "CodeSage sends you to Asgardeo to authenticate. The provider page offers the sign-in methods configured for this deployment.",
    intro:
      "CodeSage sends you to Asgardeo to authenticate. The provider page offers the sign-in methods configured for this deployment.",
    sections: [
      {
        heading: "Steps",
        paragraphs: [],
        steps: [
          "Open the CodeSage login page.",
          "Select Sign in with Asgardeo once.",
          "Complete the provider prompts, including verification if requested.",
          "Wait for the return to CodeSage and create or choose a workspace.",
        ],
      },
      {
        heading: "What to expect",
        paragraphs: [
          "If you return to login, start a fresh sign-in from CodeSage. Avoid reusing an old callback URL. For an invitation, use the email identity that received it.",
        ],
      },
    ],
    related: ["sign-in-errors"],
  },
  {
    slug: "sign-in-errors",
    parent: "sign-in",
    category: "Help",
    title: "Recover from sign-in or session errors",
    description:
      "A session cookie alone does not prove your session is still valid. CodeSage checks the session with its API.",
    intro:
      "A session cookie alone does not prove your session is still valid. CodeSage checks the session with its API.",
    sections: [
      {
        heading: "Steps",
        paragraphs: [],
        steps: [
          "Return to the login page.",
          "Start one fresh Asgardeo sign-in.",
          "Complete the flow in the same browser.",
          "If it fails again, record the visible error for the project administrator.",
        ],
      },
      {
        heading: "What to expect",
        paragraphs: [
          "CodeSage does not provide a local password-reset form. Use recovery options offered by your identity provider. Never share your cookie or login URL containing authentication parameters.",
        ],
      },
    ],
    related: ["sign-in-asgardeo"],
  },
  {
    slug: "sign-out",
    parent: "sign-in",
    category: "Help",
    title: "Check your identity and sign out",
    description:
      "The account avatar shows your name, email, and identity provider when available. This helps confirm which identity is accepting an invitation.",
    intro:
      "The account avatar shows your name, email, and identity provider when available. This helps confirm which identity is accepting an invitation.",
    sections: [
      {
        heading: "Steps",
        paragraphs: [],
        steps: [
          "Open the account avatar to check the signed-in email.",
          "Select Sign out at the bottom of the sidebar.",
          "Confirm in the dialog, or cancel to keep the current session.",
        ],
      },
      {
        heading: "What to expect",
        paragraphs: [
          "Sign-out revokes the CodeSage session. Signing back in is required before accessing workspace data again.",
        ],
      },
    ],
    related: ["accept-invitations"],
  },
  {
    slug: "create-workspace",
    parent: "workspace",
    category: "Help",
    title: "Create and switch workspaces",
    description:
      "Each workspace contains its own projects, profiles, and membership. Your role can differ between workspaces.",
    intro:
      "Each workspace contains its own projects, profiles, and membership. Your role can differ between workspaces.",
    sections: [
      {
        heading: "Steps",
        paragraphs: [],
        steps: [
          "Use the onboarding form when you have no workspace, or New workspace in Workspace when available.",
          "Enter the workspace details and submit.",
          "Use the top-bar workspace picker to change the active workspace.",
        ],
      },
      {
        heading: "What to expect",
        paragraphs: [
          "Creating a workspace makes you its org admin. An empty project list after switching usually means the selected workspace has no projects; data from another workspace is not copied.",
        ],
      },
    ],
    related: ["manage-workspaces"],
  },
  {
    slug: "workspace-settings",
    parent: "workspace",
    category: "Help",
    title: "Edit workspace settings or delete a workspace",
    description:
      "Workspace settings are shared with everyone in that workspace. Only an org admin can change the settings.",
    intro:
      "Workspace settings are shared with everyone in that workspace. Only an org admin can change the settings.",
    sections: [
      {
        heading: "Steps",
        paragraphs: [],
        steps: [
          "Open Workspace and confirm the workspace name.",
          "Edit the name, description, or full website URL.",
          "Choose Save changes, or Discard to abandon edits.",
        ],
      },
      {
        heading: "What to expect",
        paragraphs: [
          "Deletion removes the workspace’s projects, scans, findings, profiles, invitations, and memberships. Read the confirmation carefully; this does not delete repositories on GitHub.",
        ],
      },
    ],
    related: ["manage-workspaces"],
  },
  {
    slug: "invite-teammates",
    parent: "team",
    category: "Help",
    title: "Invite teammates and revoke invitations",
    description:
      "Workspace membership is managed from Workspace. The form provides an email address and initial role.",
    intro:
      "Workspace membership is managed from Workspace. The form provides an email address and initial role.",
    sections: [
      {
        heading: "Steps",
        paragraphs: [],
        steps: [
          "Open Workspace and find Invite a teammate.",
          "Enter the teammate’s email and choose an available role.",
          "Select Send invite.",
          "Review pending invitations; use Revoke if access should no longer be offered.",
        ],
      },
      {
        heading: "What to expect",
        paragraphs: [
          "To make someone an org admin, invite them first, then change their role after they join. Revoking an unused invitation prevents that link from granting access.",
        ],
      },
    ],
    related: ["accept-invitations"],
  },
  {
    slug: "accept-invitations",
    parent: "team",
    category: "Help",
    title: "Accept an invitation and recover an unusable link",
    description: "Invitations use a one-time link tied to an email identity.",
    intro: "Invitations use a one-time link tied to an email identity.",
    sections: [
      {
        heading: "Steps",
        paragraphs: [],
        steps: [
          "Open the link from the invitation email.",
          "If prompted, sign in with that email through Asgardeo.",
          "Wait for the workspace to open.",
          "If membership was created but switching failed, use the offered workspace action.",
        ],
      },
      {
        heading: "What to expect",
        paragraphs: [
          "Expired, revoked, used, invalid, or wrong-email links may all be shown as unusable. Check your account email, then request a fresh invitation if necessary.",
        ],
      },
    ],
    related: ["sign-in-asgardeo"],
  },
  {
    slug: "member-roles",
    parent: "team",
    category: "Help",
    title: "Change roles and remove teammates",
    description:
      "The member table shows each person’s workspace role. Administrative controls depend on member-management permission.",
    intro:
      "The member table shows each person’s workspace role. Administrative controls depend on member-management permission.",
    sections: [
      {
        heading: "Steps",
        paragraphs: [],
        steps: [
          "Open Workspace and locate the teammate.",
          "Use the role selector if available.",
          "To remove access, choose the member’s removal action and confirm.",
        ],
      },
      {
        heading: "What to expect",
        paragraphs: [
          "Your own row is read-only in this interface; another org admin manages it. Removing membership revokes workspace access while recorded activity remains. Ask an org admin when controls are unavailable.",
        ],
      },
    ],
    related: ["invite-teammates"],
  },
  {
    slug: "choose-branch",
    parent: "projects",
    category: "Help",
    title: "Choose a project and branch",
    description:
      "The workspace picker, project picker, and branch picker describe the report you are viewing.",
    intro:
      "The workspace picker, project picker, and branch picker describe the report you are viewing.",
    sections: [
      {
        heading: "Steps",
        paragraphs: [],
        steps: [
          "Select the correct workspace.",
          "Choose the project in the top bar.",
          "On its dashboard, choose a branch.",
          "Check the commit and scan time before interpreting the report.",
        ],
      },
      {
        heading: "What to expect",
        paragraphs: [
          "Selecting a branch does not analyze new commits automatically. Run a scan when you need results for updated code. A branch without a snapshot has no report yet.",
        ],
      },
    ],
    related: ["run-and-stop-scans"],
  },
  {
    slug: "what-is-analysed",
    parent: "scanning",
    category: "Help",
    title: "What CodeSage analyses: Java only",
    description:
      "A scan reads the Java source on one branch. Build files are read only to detect the Java version, and every other file is left alone.",
    intro:
      "A scan reads the Java source on one branch. Build files are read only to detect the Java version, and every other file is left alone.",
    sections: [
      {
        heading: "Analysed",
        paragraphs: [
          "Only .java files are parsed, measured and scored. Files selected for Exclude from scans are skipped. With Hide from Refactor first by default, selected files are analysed and their findings can be revealed using Show excluded findings.",
          "The git history of those files is read for change frequency, which feeds the bug-risk model.",
        ],
      },
      {
        heading: "Read, but never scored",
        paragraphs: [
          "pom.xml, build.gradle, build.gradle.kts and gradle.properties are read only to find the Java version, so PMD parses the code correctly. They never produce findings and never count toward health.",
        ],
      },
      {
        heading: "Not analysed",
        paragraphs: [
          "Markdown and other documentation (.md), resources, XML, properties and YAML files, and code in other languages such as Kotlin, JavaScript or Python are cloned with the repository but never read. They are not in the file tree, not in the line count health is measured against, and never produce findings. A TODO in a Markdown file is not self-admitted debt; one in a Java comment is.",
          "Files over 1 MB and binaries are not downloaded at all. The clone is deleted as soon as the scan ends.",
        ],
        note: "A branch with no Java files at all ends with a clear No Java files message instead of an empty report.",
      },
      {
        heading: "When you connect a repository",
        paragraphs: [
          "Before a repository is connected, CodeSage shows this same list and asks you to confirm. Connect only adds it to the workspace; Connect and scan also starts its first scan on the default branch and opens its dashboard.",
          "Tick Don't show this again to skip the question for later repositories in this workspace. CodeSage then repeats the choice you made, on this browser only.",
        ],
      },
    ],
    related: ["scan-failures", "stored-data"],
  },
  {
    slug: "scan-failures",
    parent: "scanning",
    category: "Help",
    title: "Understand scan limits and failed scans",
    description:
      "Scanning is subject to repository and time limits configured by the deployment.",
    intro:
      "Scanning is subject to repository and time limits configured by the deployment.",
    sections: [
      {
        heading: "Steps",
        paragraphs: [],
        steps: [
          "Read the failure message in the scan status.",
          "For No Java files, select a branch containing Java.",
          "For a size limit, use a project within the reported limit.",
          "For download or analysis timeouts, record the project, branch, and scan identifier before retrying.",
        ],
      },
      {
        heading: "What to expect",
        paragraphs: [
          "The current pipeline explicitly rejects branches without Java files. A timeout or stopped scan does not produce a complete new report; older successful snapshots remain available.",
        ],
      },
    ],
    related: ["troubleshoot"],
  },
  {
    slug: "activity",
    parent: "scanning",
    category: "Help",
    title: "Follow scans from Activity",
    description:
      "The top-bar Activity menu lets you follow work while using other pages in the same workspace.",
    intro:
      "The top-bar Activity menu lets you follow work while using other pages in the same workspace.",
    sections: [
      {
        heading: "Steps",
        paragraphs: [],
        steps: [
          "Start a scan or open Activity.",
          "Find the project and branch in the running or ready entries.",
          "Open the relevant entry to return to that report.",
          "When new results are ready, use Show them where offered.",
        ],
      },
      {
        heading: "What to expect",
        paragraphs: [
          "A healthy worker does not guarantee that a queued job is progressing. If a scan remains queued with no work advancing, provide its identifier to the project team.",
        ],
      },
    ],
    related: ["run-and-stop-scans"],
  },
  {
    slug: "dashboard-views",
    parent: "dashboard",
    category: "Help",
    title: "Choose a dashboard view and browse files",
    description:
      "The view controls change which dashboard panels have room on screen.",
    intro:
      "The view controls change which dashboard panels have room on screen.",
    sections: [
      {
        heading: "Steps",
        paragraphs: [],
        steps: [
          "Choose Overview for the health summary.",
          "Choose Findings for the ranked list.",
          "Choose Findings + files to browse the repository tree.",
          "Choose Findings + detail to keep a selected finding beside the list.",
        ],
      },
      {
        heading: "What to expect",
        paragraphs: [
          "The chosen layout is remembered in this browser. Panel layout does not change the stored snapshot or scoring profile.",
        ],
      },
    ],
    related: ["review-findings"],
  },
  {
    slug: "severity-filter",
    parent: "filters",
    category: "Help",
    title: "Filter by severity and debt type",
    description:
      "Severity and debt category filters narrow the ranked list together. Category describes the kind of debt; severity describes the issue’s level.",
    intro:
      "Severity and debt category filters narrow the ranked list together. Category describes the kind of debt; severity describes the issue’s level.",
    sections: [
      {
        heading: "Steps",
        paragraphs: [],
        steps: [
          "Open the findings filter toolbar.",
          "Toggle the severity chips you want included.",
          "Choose a debt type or All types.",
          "Use Clear filter when the combination hides everything.",
        ],
      },
      {
        heading: "What to expect",
        paragraphs: [
          "Filters combine: a finding must satisfy the active source, severity, category, done-status, and test-code selections. These list controls do not edit profile weights.",
        ],
      },
    ],
    related: ["test-exclusions"],
  },
  {
    slug: "source-filter",
    parent: "filters",
    category: "Help",
    title: "Filter SATD and rule-based findings",
    description:
      "SATD means self-admitted technical debt detected from comments. Rule-based findings come from analysis rules.",
    intro:
      "SATD means self-admitted technical debt detected from comments. Rule-based findings come from analysis rules.",
    sections: [
      {
        heading: "Steps",
        paragraphs: [],
        steps: [
          "Find Filter by source in the findings toolbar.",
          "Select SATD or Rule-based.",
          "Select All to restore both sources.",
          "Check severity and debt type if the list remains empty.",
        ],
      },
      {
        heading: "What to expect",
        paragraphs: [
          "Selecting a source changes the visible list. To change its contribution to scoring, use the profile source-trust control instead.",
        ],
      },
    ],
    related: ["source-trust"],
  },
  {
    slug: "test-exclusions",
    parent: "filters",
    category: "Help",
    title: "Directory and test exclusions: show or hide findings",
    description:
      "Choose whether selected paths are skipped during scans or analysed with their findings hidden by default.",
    intro:
      "Choose whether selected paths are skipped during scans or analysed with their findings hidden by default.",
    sections: [
      {
        heading: "Steps",
        paragraphs: [],
        steps: [
          "Open Directory exclusions from the findings list or the project settings in Profiles.",
          "Detected test files and directories are ticked automatically. Untick any path you want to include as production code.",
          "Choose Exclude from scans or Hide from Refactor first by default, then save.",
          "Run a new scan after changing directory scope.",
          "Use Show excluded findings in Refactor first to reveal findings from scanned excluded paths.",
        ],
      },
      {
        heading: "What to expect",
        paragraphs: [
          "Exclude from scans generates no findings for selected paths. The toolbar cannot reveal findings that were never generated.",
          "Hide from Refactor first by default scans selected paths and tags their findings separately. Show excluded findings changes visibility only; it does not change health scores.",
          "Clear filter restores the saved visibility default. Existing snapshots retain their original source classification.",
        ],
      },
    ],
    related: ["test-paths", "profile-test-inclusion"],
  },
  {
    slug: "done-filter",
    parent: "filters",
    category: "Help",
    title: "Show completed findings and reset filters",
    description:
      "Done findings are hidden by default. Marking work done may therefore remove a row from the visible list.",
    intro:
      "Done findings are hidden by default. Marking work done may therefore remove a row from the visible list.",
    sections: [
      {
        heading: "Steps",
        paragraphs: [],
        steps: [
          "Enable Show done to include completed findings.",
          "Open a completed finding and choose Reopen if work remains.",
          "If the list is empty, review source, severity, debt type, and Show excluded findings.",
          "Use Clear filter to reset source, severity, debt type, and test visibility.",
        ],
      },
      {
        heading: "What to expect",
        paragraphs: [
          "Clear filter does not turn off Show done. Open/done counters describe the supplied finding collection, so they can differ from the filtered rows on screen.",
        ],
      },
    ],
    related: ["review-findings"],
  },
  {
    slug: "test-paths",
    parent: "filters",
    category: "Help",
    title: "Select directories and correct detected test paths",
    description:
      "Managers and org admins can configure directory exclusions per repository.",
    intro:
      "Managers and org admins can configure directory exclusions per repository.",
    sections: [
      {
        heading: "Steps",
        paragraphs: [],
        steps: [
          "Open Directory exclusions and wait for Loading directories… to finish.",
          "The left column contains the directory tree; the right contains the two exclusion options. Folders start collapsed. Expand a folder or search to find a path.",
          "Detected test paths and saved selections are ticked. Untick incorrect matches to record production overrides.",
          "Choose Exclude from scans to skip selected paths, or Hide from Refactor first by default to scan them while hiding their findings initially.",
          "Save configuration, then run a new scan.",
        ],
      },
      {
        heading: "What to expect",
        paragraphs: [
          "The fixed-size dialog scrolls when content is long. On smaller screens its columns stack.",
          "Selecting a folder covers all descendants. Search temporarily expands matching paths without changing your expansion choices.",
          "Directory settings are also offered when connecting a repository. Save and scan applies them before scanning; Scan with current settings uses the saved configuration.",
        ],
      },
    ],
    related: ["test-exclusions"],
  },
  {
    slug: "source-trust",
    parent: "profile-settings",
    category: "Help",
    title: "Adjust source trust and category weights",
    description:
      "Weights express how much each debt category matters. Source trust balances model and rule contributions.",
    intro:
      "Weights express how much each debt category matters. Source trust balances model and rule contributions.",
    sections: [
      {
        heading: "Steps",
        paragraphs: [],
        steps: [
          "Open Profiles and select an editable custom profile.",
          "Adjust Security, Code design, Requirement, Documentation, or Test weights.",
          "Set source trust: 0 favors the model and 1 favors rules.",
          "Save changes and check the project’s effective profile before comparing scores.",
        ],
      },
      {
        heading: "What to expect",
        paragraphs: [
          "Security findings are excluded from the source-trust adjustment; this slider cannot de-weight them. A debt category named Test is different from classifying a source file as test code.",
        ],
      },
    ],
    related: ["profile-test-inclusion"],
  },
  {
    slug: "profile-test-inclusion",
    parent: "profile-settings",
    category: "Help",
    title: "Excluded findings and health scores",
    description:
      "Directory exclusions control scanning and finding visibility; showing hidden findings does not change the health score.",
    intro:
      "Directory exclusions control scanning and finding visibility; showing hidden findings does not change the health score.",
    sections: [
      {
        heading: "Steps",
        paragraphs: [],
        steps: [
          "Open Directory exclusions to choose how selected paths are handled.",
          "Use Exclude from scans when selected paths should generate no findings.",
          "Use Hide from Refactor first by default when selected paths should be analysed but hidden initially.",
          "Save and rescan to apply changed directory scope.",
        ],
      },
      {
        heading: "What to expect",
        paragraphs: [
          "The Include test-code findings control has been removed from Profiles. Existing profile scoring settings are preserved.",
          "Show excluded findings is a display filter, not a scoring setting. Revealing findings does not recalculate the score.",
          "Adjust category weights and source trust in Profiles to change scoring. Untick a misclassified production path and rescan to correct its classification.",
        ],
      },
    ],
    related: ["test-exclusions", "source-trust"],
  },
  {
    slug: "profile-lifecycle",
    parent: "profiles",
    category: "Help",
    title: "Create, duplicate, edit, and delete custom profiles",
    description:
      "Built-in profiles are read-only starting points. Custom profiles belong to the active workspace.",
    intro:
      "Built-in profiles are read-only starting points. Custom profiles belong to the active workspace.",
    sections: [
      {
        heading: "Steps",
        paragraphs: [],
        steps: [
          "Open Profiles and create a custom profile or duplicate a starting profile.",
          "Give it a distinct name and adjust values.",
          "Save changes before switching scope or profile.",
          "Before deleting, replace its workspace-default and project assignments.",
        ],
      },
      {
        heading: "What to expect",
        paragraphs: [
          "Unsaved changes require a save/discard decision when switching. The interface reports duplicate names and workspace profile limits; delete an unused custom profile if the limit is reached.",
        ],
      },
    ],
    related: ["use-scoring-profiles"],
  },
  {
    slug: "appearance",
    parent: "account",
    category: "Help",
    title: "Change theme and navigate with the keyboard",
    description:
      "Appearance preferences affect your browser experience rather than workspace data.",
    intro:
      "Appearance preferences affect your browser experience rather than workspace data.",
    sections: [
      {
        heading: "Steps",
        paragraphs: [],
        steps: [
          "Open Theme at the bottom of the sidebar.",
          "Select Light, Dark, or System default.",
          "Use the sidebar collapse control on desktop, or the mobile navigation menu.",
          "Use Tab to reach controls and arrow keys within the findings filter toolbar.",
        ],
      },
      {
        heading: "What to expect",
        paragraphs: [
          "System default follows your device preference. Collapsed navigation icons retain labels through tooltips; a visible focus outline identifies keyboard focus.",
        ],
      },
    ],
    related: ["sign-out"],
  },
  {
    slug: "workspace-rule-selection",
    parent: "profile-settings",
    category: "Help",
    title: "Enable or disable workspace rules",
    description:
      "Org admins control which built-in and PMD rules run in future scans across the workspace.",
    intro:
      "Org admins control which built-in and PMD rules run in future scans across the workspace.",
    sections: [
      {
        heading: "Steps",
        paragraphs: [],
        steps: [
          "Open Profiles → Rule selection → View workspace rules.",
          "Search or browse rules, untick rules you want to disable, and choose Save rules.",
          "Alternatively, open a finding detail card, choose Disable this rule, and confirm its workspace-wide effect.",
          "Run a new scan to apply the new selection, even without a new commit.",
          "Re-enable rules by ticking them in Rule selection and saving.",
        ],
      },
      {
        heading: "What to expect",
        paragraphs: [
          "The rule-selection dialog has a fixed size with a scrolling list. Other roles can inspect rules but cannot change them.",
          "Existing findings and scores remain unchanged until a new scan is produced. Disabling a rule differs from Mark as done, which applies to one finding.",
          "AI-based comment findings are unaffected by deterministic rule selection.",
        ],
      },
    ],
    related: ["workspace-comment-rules", "review-findings"],
  },
  {
    slug: "workspace-comment-rules",
    parent: "profile-settings",
    category: "Help",
    title: "Add and manage comment rules",
    description:
      "Comment rules match explicit team markers before unmatched comments are sent to ML.",
    intro:
      "Comment rules match explicit team markers before unmatched comments are sent to ML.",
    sections: [
      {
        heading: "Steps",
        paragraphs: [],
        steps: [
          "Open Profiles → Comment rules → View comment rules.",
          "Added rules lists the configured rules. Org admins can Edit or Remove a rule.",
          "Switch to Add rule and enter a name, keyword or regex pattern, category, and severity.",
          "Enter a sample comment and choose Test pattern. Choose Add rule after the pattern is valid.",
          "Adding or updating returns to Added rules. Choose Save comment rules to persist the list, then rescan.",
        ],
      },
      {
        heading: "What to expect",
        paragraphs: [
          "Both tabs share a fixed-size dialog with scrolling content. Drafts survive tab switches.",
          "The first enabled matching rule sets category and severity. Existing rule order is preserved; the list has no reorder or enable controls.",
          "Other roles can inspect rules and test patterns, but cannot edit, remove, or save them. Changes affect future scans across the workspace.",
        ],
      },
    ],
    related: ["workspace-rule-selection", "review-findings"],
  },
]
