# Code Sage AI
## Software Requirements Specification
### For the AI-Powered Technical Debt Analytics Dashboard — Version 1.0 (v1.0 release scope)

**Group 16 · Project ID 7 · CS3203 — Software Engineering Project · Mentor: Mr. Anju Chamantha**

> ℹ️ **How to use this file.** It follows the course **SRS template (#3, RUP / IEEE-830)** section-for-section. Each section starts with a short *Template guidance* note (what the marker expects) and is then filled with content grounded in the Project Proposal, Feasibility Report, Backend Analysis Engine doc, and the Release Roadmap. Spots that need the team's own numbers/decisions are marked **✍️ TEAM TODO**. Requirements are tagged by release: **[v1.0]** = this release, **[v1.1] / [v2]** = documented now, built later (see [release-roadmap.md](../Project%20Management%20%26%20Planning/release-roadmap.md)). Convert to `.docx` in the course template for final submission; keep this `.md` as the working master.

---

### Revision History

| Date | Version | Description | Author |
|---|---|---|---|
| 22/Jul/2026 | 0.1 (draft) | Initial SRS: v1.0 functional + non-functional requirements, interfaces, DB, constraints. | Group 16 |
| 30/Jul/2026 | 0.2 (draft) | **[CR-001](../Change%20Requests/CR-001_2026-07-30_scoring-model-and-finding-ux.md)** — severity register (FR-8.1), `source` reduced to `rule \| satd` (FR-8.2), SATD marker-based severity (FR-9.2), risk as a bounded multiplier (FR-10/FR-11), scoring profile = 5 category weights + trust slider (FR-11/FR-20), in-place finding detail (FR-17/FR-18), three-mechanism visibility floor (FR-24). | Group 16 |
| ✍️ | | | |

---

## Table of Contents
1. Introduction
   - 1.1 Purpose
   - 1.2 Scope
   - 1.3 Definitions, Acronyms, and Abbreviations
   - 1.4 References
   - 1.5 Overview
2. Overall Description
3. Specific Requirements
   - 3.1 Functionality
   - 3.2 Usability
   - 3.3 Reliability
   - 3.4 Performance and Security
   - 3.5 Supportability
   - 3.6 Design Constraints
   - 3.7 On-line User Documentation and Help System Requirements
   - 3.8 Purchased Components
   - 3.9 Interfaces
   - 3.10 Database Requirements
   - 3.11 Licensing, Legal, Copyright, and Other Notices
   - 3.12 Applicable Standards
4. Supporting Information

---

# 1. Introduction

## 1.1 Purpose

*Template guidance: state the purpose of this SRS and its audience.*

This document specifies the complete software requirements for **Code Sage AI**, an AI-powered technical-debt analytics dashboard delivered as a multi-tenant web SaaS platform for small-scale agile software teams. It defines the system's external behaviour — functional capabilities, non-functional qualities, interfaces, data, and design constraints — in enough detail for designers to design the system and testers to verify it.

The intended audience is: the development team (frontend, backend, and ML members), the project mentor and evaluators, and any future maintainer. The requirements below are the agreement against which the **v1.0** release is built and tested; later-release requirements are included to show the product trajectory and to keep the v1.0 design forward-compatible.

## 1.2 Scope

*Template guidance: briefly describe the software the SRS applies to and what it influences.*

**Product:** Code Sage AI connects a team's GitHub/GitLab repository, analyses its source code, code comments, and commit history using static analysis plus machine learning, and presents a **prioritized, low-noise** view of the codebase's technical debt: an overall code-health score and grade, a hotspot file-tree heat map, a "Refactor-First" list of the issues most worth fixing, and health trends over time. Unlike enterprise tools that overwhelm small teams with hundreds of findings and heavy configuration, Code Sage AI surfaces only the most critical, actionable items and explains each in one plain-English line.

**This SRS covers the v1.0 release scope** (per [release-roadmap.md](../Project%20Management%20%26%20Planning/release-roadmap.md)):

- **In scope (v1.0):** GitHub sign-in; connecting **one public repository by URL** (1 repo = 1 project); a Projects list with selection; per-branch, **on-demand** scanning with progress and cancel; the full analysis pipeline (Lizard metrics, PyDriller history, rule engine, SATD classifier, risk model); weighted scoring with selectable preset profiles and a critical-security visibility floor; the dashboard outputs (health card + category pie, health trend chart, Refactor-First list with filter-by-debt-type, finding-detail panel, hotspot file-tree heat map); scan history; persistence of every scan as an immutable snapshot; a single-member workspace built on a multi-tenant foundation.
- **In scope but later ([v1.1]/[v2]):** private repositories via GitHub App; finding actions (accept/resolve/false-positive); code snippet on demand; standalone category-breakdown view; multi-repository workspaces; **Team / RBAC**; silent checks (auto-scan on push/PR); cross-repository dependency analytics; GitLab. *(Custom scoring sliders moved **into v1.0** by [CR-001](../Change%20Requests/CR-001_2026-07-30_scoring-model-and-finding-ux.md) — see FR-20.)*
- **Not detection inputs in v1.0** (see **FR-7.1**): **commit-message text** as a SATD input (history is consumed only as the four numeric process metrics); **pull requests and issues** in any form; previously stored snapshots as model or scoring input.
- **Out of scope (whole product):** fully automatic code refactoring; on-premise/proprietary VCS beyond GitHub/GitLab; integration with project-management tools (Jira/Trello); full vulnerability scanning (SAST/DAST, CVE/dependency auditing, penetration testing).

## 1.3 Definitions, Acronyms, and Abbreviations

| Term | Meaning |
|---|---|
| **Technical Debt (TD)** | The implied future cost of shortcuts, bad smells, or shortcuts taken in code. |
| **SATD** | Self-Admitted Technical Debt — debt a developer admits in natural language (e.g. `// TODO: temporary hack`). The literature recognises four sources (comments, commit messages, issues, pull requests); **v1.0 detects SATD in source-code comments only** — see FR-9 and §3.1.9.1. |
| **Finding** | The atomic unit of output: one detected issue at a `file:line:symbol`, with a `source`, a `category`, a `severity`, and a one-line reason. |
| **`source`** | *Which detector* produced a finding: `rule` \| `satd` — the only two producers of findings (FR-8.1). Security patterns run **inside** the rule engine, so a security finding is a `rule` finding whose `category` is `security`; the risk model produces no findings at all. |
| **`category`** | *What type of debt* a finding is: `code-design` \| `requirement` \| `documentation` \| `test` \| `security`. |
| **`severity`** | *How bad* a finding is: `critical` \| `high` \| `medium` \| `low`. **Assigned at detection** — from the rule register for `rule` findings, from the comment-marker table for `satd` findings (FR-9.2) — and never by scoring, by the UI, by an ML model, or by a user (FR-8.1). Stored on the finding, then read by exactly two consumers: scoring (→ base points, FR-11) and the Refactor-First badge (FR-15). |
| **Rule engine** | Deterministic thresholds over static metrics + pattern-based security rules. |
| **Risk model (ML-2)** | Supervised classifier estimating a file's bug-proneness (0–1). |
| **SATD classifier (ML-1)** | Supervised NLP model classifying a **source-code comment** as debt and, if so, its category. |
| **CCN** | Cyclomatic Complexity Number (per function). |
| **NLOC** | Non-comment Lines Of Code. |
| **Churn** | Recent change volume of a file (commits / lines changed over a 90-day window anchored to the scanned commit's date — FR-11). |
| **Process metrics** | The four history-derived numeric features per file: churn, author count, file age, recency. Mined by PyDriller; consumed by ML-2 (all four) and by scoring (churn only). |
| **Snapshot-scoped** | Derived solely from the working tree at the scanned commit SHA. Comments are snapshot-scoped; commit messages are not. |
| **Health score / grade** | 0–100 score and A–E grade summarising a repo's (or subtree's) debt. |
| **Snapshot** | The immutable stored result of one scan, keyed by branch + commit SHA. |
| **Scoring profile** | The user-owned settings that turn findings into scores: **five per-category weights** plus one **trust slider** `s` that trades rule-engine confidence against machine-learning confidence (FR-20). It never contains a severity. |
| **Trust slider (`s`)** | A single control, `s ∈ [0,1]`, default `0.5`, expressing *how much this team trusts the deterministic rules versus the machine-learning detectors*. Yields `rule_trust = 0.5 + s` and `ml_trust = 1.5 − s`; the `security` category is excluded and always uses 1.0 (FR-11, FR-24). |
| **Visibility floor** | A rule that critical security findings are never suppressed or down-weighted below visibility. |
| **Workspace / tenant** | The top-level data owner in the multi-tenant model; a project belongs to a workspace, not a person. |
| **RBAC** | Role-Based Access Control (org-admin / manager / developer / viewer). |
| **RLS** | PostgreSQL Row-Level Security, used to isolate tenants. |
| **SZZ** | Algorithm that links bug-fixing commits back to the changes that induced them (used to label defective files). |
| **GHPR** | GitHub Pull Request defect dataset (risk-model training/evaluation). **Offline training data only** — despite the name, the system never reads pull requests at scan time (§3.1.7.1). |
| **FR / NFR** | Functional / Non-Functional Requirement. |
| **MSW** | Mock Service Worker — intercepts network calls to serve mock API data during frontend development. |
| **SDD / SAD** | Software Design / Architecture Document. |

## 1.4 References

*Template guidance: list every referenced document (title, date, source), IEEE style.*

1. Code Sage AI — **Project Proposal**, Group 16, 5 Jul 2026 (`docs/Deliverables/Project_Proposal.pdf`).
2. Code Sage AI — **Feasibility Report**, Group 16, 12 Jul 2026 (`docs/Deliverables/Feasibility_Report.pdf`).
3. Code Sage AI — **Backend Analysis Engine: Detection, Scoring & Output Generation**, v1.0, 21 Jul 2026 (`docs/Project Management & Planning/code-sage_backend-analysis-engine.md`).
4. Code Sage AI — **Release Roadmap** and **Frontend Prototype Plan** (`docs/Project Management & Planning/`).
5. T. Besker, A. Martini, J. Bosch, *Technical Debt Cripples Software Developer Productivity*, 2018.
6. Y. Li, M. Soliman, P. Avgeriou, *Automatic identification of self-admitted technical debt from four different sources*, Empirical Software Engineering 28(65), 2023. (**SATD dataset / debt-category labels**.)
7. J. Xu, F. Wang, J. Ai, *Defect Prediction With Semantics and Context Features…*, IEEE Trans. Reliability, 2021. (**GHPR dataset**.)
8. IEEE Std 830-1998, *Recommended Practice for Software Requirements Specifications*.

> ✍️ **TEAM TODO:** import the full numbered reference list [1]–[45] from the Proposal/Feasibility reports and align citation numbers before submission.

## 1.5 Overview

*Template guidance: describe how the rest of the SRS is organized.*

Section 2 gives the **overall description** (product perspective, functions, users, constraints, assumptions). Section 3 gives the **specific requirements**: 3.1 functional requirements (grouped by feature and described in detail — no use-case diagrams, per template), followed by non-functional requirements (3.2 usability, 3.3 reliability, 3.4 performance & security, 3.5 supportability), 3.6 design constraints, and 3.7–3.12 documentation, components, interfaces, database, legal, and standards. Section 4 holds supporting information.

---

# 2. Overall Description

*Template guidance: general factors and background — not specific requirements. Cover product perspective, functions, users, constraints, assumptions, requirements subsets.*

**Product perspective.** Code Sage AI is a new, self-contained SaaS product (not a component of a larger system). It integrates externally with the **GitHub API / GitHub App** (and later GitLab) to read repositories, and is built from four internal parts: a **Next.js** frontend (the dashboard), a **FastAPI** backend + **Celery/Redis** async workers (repository integration, orchestration, scoring), a **Python/scikit-learn ML service** (SATD + risk models over **Lizard** metrics and **PyDriller** history), and a **PostgreSQL** database (tenant data + immutable scan snapshots). A load-bearing architectural invariant: **the dashboard computes nothing** — every number shown traces to a stored row; detection and scoring happen server-side.

**Product functions (summary).** Connect a repository → scan a branch on demand (async) → extract signals → detect findings (rules + SATD + risk) → score & prioritize with a profile → persist a snapshot → present health score/grade/delta, a category pie, a health trend, a Refactor-First list (with one-line reasons and debt-type filter), a finding-detail panel, and a hotspot file-tree heat map; browse scan history; select a scoring profile.

**User characteristics / personas.**
- **Developer** — the primary user; connects repos, runs scans, reads and triages findings. Comfortable with code; wants low noise and actionable items.
- **Tech lead / Manager** — configures the scoring profile for the team, watches health trends, uses the dashboard to plan refactoring within sprints.
- **Org admin** *(role realized in [v2])* — manages the workspace, connected repos, members, roles, and billing.
- **Viewer / stakeholder (e.g. product owner, non-technical business owner)** — reads health scores and trends to understand codebase condition without needing to read code. Requires an especially clear, jargon-light presentation.

**Constraints & assumptions.** Three-person team on a fixed academic schedule (core features first — risks R2/R7); free tools, datasets, and hosting only (no budget); GitHub API rate limits (mitigated with ETag caching + App tokens); ML validated on **Python + JavaScript/TypeScript** only; repositories are read via least-privilege, user-selected access. The system assumes a reachable Git host and that the target repository is in a supported language for full detection quality.

**Requirements subsets (release tags).** Each FR carries **[v1.0] / [v1.1] / [v2]**. v1.0 is a complete vertical slice (one user, one public repo, manual scan, full dashboard). Later tags are specified now to protect the design but are not built for v1.0.

---

# 3. Specific Requirements

## 3.1 Functionality

*Template guidance: describe each function/user activity in detail (no use-case diagrams). Organized here by feature.*

> **Notation.** Each requirement: **FR-n [release] Name** — a detailed description of trigger, behaviour, inputs, and outputs. "The system" = Code Sage AI.

### 3.1.1 FR-1 [v1.0] Authentication & session
The system shall let a user sign in via **"Sign in with GitHub."** On success the system establishes an authenticated session and lands the user on the **Projects** destination. In the frontend prototype this is **mocked** (a fake session unlocks a fixture repo list); the product replaces it with real GitHub OAuth without changing the screens. The system shall let a signed-in user sign out from the **Account** menu at the bottom of the left rail. Session state shall be carried per request (token), not held in server memory (stateless services).

### 3.1.2 FR-2 [v1.0 seam / v2 full] Workspace & tenant isolation
Every project, scan, and finding shall belong to a **workspace** (tenant), not directly to a user. In v1.0 the workspace has exactly one member (the owner); the schema nonetheless carries `workspace_id` on tenant-scoped rows and enforces **PostgreSQL Row-Level Security** so a user can only read their own workspace's data. This satisfies Objective 2 (secure multi-tenant architecture) and lets Team/RBAC ([v2]) attach with no schema rewrite.

### 3.1.3 FR-3 [v1.0] Connect a repository (public URL)
The system shall let the user add a project by **pasting a public repository URL**. One repository equals one project in v1.0. On connect, the system validates the URL, records repository metadata (name, owner, visibility=public, default branch), and adds it to the Projects list. Cloning for analysis uses zero API quota (a plain `git clone`). *(Private-repo connection via GitHub App = **FR-3b [v1.1]**: the user installs the App, grants access to **only selected** repositories — least privilege — and those repos auto-appear as projects.)*

### 3.1.4 FR-4 [v1.0] Projects list & selection
The system shall display connected projects **vertically** in the Projects panel; each row shows repo name, owner, visibility, and a small **health hint** (score/grade/delta) when a prior scan exists. The user shall **Select** a project to make it active; the active project's repo name is shown in the dashboard **top navigation bar**. Selecting a project scopes the Dashboard, Scan-History, and (later) Team views to that repository.

### 3.1.5 FR-5 [v1.0] Branch selection
In the dashboard top nav, next to the project name, the system shall provide a **branch dropdown**. The repository's **default branch is pre-selected**. Changing the branch re-scopes the dashboard to that branch's latest snapshot. Analysis is **per-branch** — each branch has its own snapshots and trend.

### 3.1.6 FR-6 [v1.0] Repository scan (manual, async, cancellable)
The system shall provide a **Scan** control in the top nav that runs the analysis pipeline for the active project + branch on an **asynchronous worker** so the UI stays responsive. The control is a state machine: `idle → "Scan"`; while running, it shows **"Scanning… NN%"** with progress and a **Stop** control; on completion it returns to idle and the dashboard reflects the new snapshot; on cancel it stops the worker and leaves the previous snapshot intact; on error it returns to idle with an error indication. In v1.0 scans run **only on user request** (no silent/auto scans). The system may **skip re-scanning** when the branch's latest commit SHA equals the last scanned SHA and instead reuse the stored snapshot (scan-per-commit optimization). *(Silent checks on push/PR = **FR-6b [v2]**.)*

### 3.1.7 FR-7 [v1.0] Signal extraction *(backend)*
On each scan the system shall extract, from a local `git clone` at the selected branch's commit SHA: **static metrics** with **Lizard** (per-function CCN, NLOC, nesting, parameter/token counts; per-file size, duplication); **process metrics** with **PyDriller** (per-file churn, author count, file age, recency); and **text** — **source-code comments from the working tree at that SHA** — for the SATD classifier. Signals are evidence, not debt; they feed detection and scoring.

#### 3.1.7.1 FR-7.1 [v1.0] Extraction boundary — text is snapshot-scoped, history is numeric

The following boundary is **normative** and governs every extractor:

> **Git history enters the pipeline as aggregated numbers, never as text.**

| Input | v1.0 use | Rationale |
|---|---|---|
| Source-code comments at the scanned SHA | **SATD classifier input** (FR-9) | Snapshot-scoped; anchored to `file:line`; disappears when deleted |
| Source files at the scanned SHA | Lizard metrics → rule engine, ML-2 | Snapshot-scoped |
| Commit history reachable from the scanned SHA | **Four numeric process metrics only** (churn, authors, age, recency) | Aggregates cannot go stale the way a sentence can |
| **Commit-message text** | **Not a detection input** | Immutable and unresolvable — see §3.1.9.1 |
| **Pull requests / issues / GitHub API metadata** | **Not an input at all** | The pipeline runs off a clone (zero API quota); PR-triggered scanning is FR-6b [v2] |
| Previously stored snapshots | **Never a model or scoring input** | Read-only history serving FR-12 `delta`, FR-14 trend, FR-19 scan history |

**Consequence — a scan is a pure function.** `Scan(commit SHA)` is determined by the repository at that SHA (its tree *and* the history reachable from it), a fixed model version, and the active profile. It never reads a prior scan row. This is what makes FR-6's skip-if-unchanged optimization sound and FR-21's snapshots reproducible.

### 3.1.8 FR-8 [v1.0] Detection — rule engine
The system shall run a deterministic **rule engine** producing findings with a hard-coded `category`: **code-design** rules (`CCN > 15` complex function; `> 80 NLOC` long method; nesting `> 4`; duplicated block; file `> 800 NLOC`) and **security** patterns (**hardcoded secret** via regex + entropy on high-entropy values assigned to key/token/secret names; **SQL string concatenation**; dangerous **`eval`/`exec`**). Each rule finding records `file`, `line`, `symbol`, `category`, `severity`, the measured `metricValue`, its `threshold`, and a `ruleId`. The rule engine is fully explainable and can ship standalone if ML slips (risk R3).

#### 3.1.8.1 FR-8.1 [v1.0] Severity and category are assigned at detection *(normative)*

Every **rule definition** shall carry a fixed `category` **and** a fixed `severity`, together with its message template (FR-16). The rule knows what it detected, so it knows how bad it is; the values are written onto the finding at detection time and are **never recomputed** by scoring, by a profile change, or by the client.

| `ruleId` | Trigger | `category` | `severity` |
|---|---|---|---|
| `complex-function` | `CCN > 15` | `code-design` | Medium |
| `long-method` | function `> 80 NLOC` | `code-design` | Medium |
| `deep-nesting` | nesting `> 4` | `code-design` | Medium |
| `duplicate-block` | duplicated block detected | `code-design` | Low |
| `large-file` | file `> 800 NLOC` | `code-design` | Low |
| `hardcoded-secret` | regex + entropy on a high-entropy value assigned to a key/token/secret name | `security` | **Critical** |
| `sql-concat` | SQL string concatenation | `security` | High |
| `dangerous-eval` | `eval` / `exec` usage | `security` | High |

**Assignment by producer.**

| Producer | Assigns `category` | Assigns `severity` |
|---|---|---|
| **Rule engine** (metric rules **and** security patterns) | From the register above | From the register above |
| **SATD classifier (ML-1)** — FR-9 | **Predicted** from the comment text | **Not the model.** From the comment-marker table — **FR-9.2** |
| **Risk model (ML-2)** — FR-10 | Neither — it produces no findings | Neither |
| **The user** (scoring profile) | Never | **Never** — the profile carries weights only (FR-20) |

Consequently **no machine-learning model and no user assigns a severity**: severity is fully deterministic and system-owned, which is what makes the critical-security visibility floor (FR-24) and configurable prioritization (FR-20) safe to defend. `severity` answers *how bad is this kind of problem* — the same answer for every team; `category_weight` answers *how much does this team care about that type* — different per team. Merging the two would make the profile non-identifiable and would allow a user to defeat FR-24.

**Severity is flat per rule in v1.0** — `complex-function` emits `medium` whether the measured CCN is 16 or 45; a worse file simply accumulates more findings. Graduating severity by how far a value exceeds its threshold is a **[v1.1]** refinement that changes no architecture: the rule still decides, still at detection time.

#### 3.1.8.2 FR-8.2 [v1.0] `source` has exactly two values *(normative)*

`source` shall be `rule` or `satd` — the only two producers of findings. Specifically:

- **Security patterns are rule findings.** They run inside the rule engine (FR-8), in the same pass and the same code path; only the *mechanism* differs (regex/entropy over text rather than a threshold over a metric). A security finding is therefore `source = rule`, `category = security`. There is **no** `security` value on the `source` axis, because it would duplicate `category` exactly and the two axes must remain orthogonal.
- **The risk model produces no findings** (FR-10), so no finding can carry an `ml-risk` source. The risk score is stored per file, not per finding.

The question *"is this a security issue?"* is answered by `category`; *"how bug-prone is this file?"* by the per-file risk score; *"which rule fired?"* by `ruleId`.

The complete `ruleId → severity → category → message template` register is **Appendix C**; it is the single source of truth for this requirement and for FR-16.

### 3.1.9 FR-9 [v1.0] Detection — SATD classifier (ML-1)
The system shall classify each **source-code comment extracted from the scanned snapshot** (FR-7) as **debt or not**, and if debt, assign a `category` ∈ {`code-design`, `requirement`, `documentation`, `test`} using a supervised NLP model (**TF-IDF → Linear SVM / Logistic Regression** baseline; CodeBERT a stretch), trained on the Li et al. SATD dataset. The debt-category set **must equal the dataset's labels** (else the model is untrainable). Each SATD finding is anchored to the comment's `file:line` and quotes the actual comment text plus the predicted category in its reason. The model predicts **`category` only**; the finding's `severity` is assigned deterministically per **FR-9.2**.

#### 3.1.9.1 FR-9.1 [v1.0] SATD inference scope — comments only *(design rationale)*

**Training corpus ≠ inference input.** The Li et al. corpus is titled *"SATD from four different sources"* (comments, commit messages, issues, pull requests); that describes the **labelled training data**. The model may be trained on the full corpus, but it **shall be evaluated on held-out *comments***, because comments are the only inference distribution in v1.0.

Commit-message SATD is **excluded from v1.0 detection** for three independent reasons, each of which alone is disqualifying:

1. **No `file:line` anchor.** FR-15 requires every Refactor-First row to carry `file:line`, and FR-17 requires the detail panel to show `file:line:symbol` (with the snippet at FR-17b). A commit message has a SHA and *n* touched files — there is no line to point at. The finding is un-renderable in the specified UI.
2. **It breaks the health score and the trend chart.** Git history grows monotonically and commit messages are immutable, so historical SATD findings would **accumulate forever and could never be removed** — there is no "developer deleted it" event. A team that resolved every issue would still watch its score decay, invalidating FR-12 `delta` and FR-14 trend.
3. **No resolution signal.** A comment admitting debt is evidence the debt *is still present*, because the comment is still in the file. A commit message is evidence debt existed *at one past moment*, with no way to determine whether it was subsequently paid off — an unfalsifiable finding.

By contrast, comment-based SATD is **self-healing**: delete the `# TODO`, and the next scan does not detect it, the finding disappears, and health rises — which is precisely the behaviour FR-14 is meant to visualise.

*(Commit-message SATD as a **file-level, time-windowed signal** — analogous to churn rather than a list row — is a candidate for a later release, not v1.0.)*

> ✍️ **TEAM TODO (D5):** confirm the exact category label strings against the Li SATD dataset CSV and lock the `Category` enum accordingly (currently `code-design | requirement | documentation | test | security`).

#### 3.1.9.2 FR-9.2 [v1.0] SATD severity — the comment-marker table *(normative)*

After the classifier has determined that a comment is debt and assigned its `category`, the system shall assign that finding's `severity` by matching the comment text against the following table:

| `severity` | Pattern (case-insensitive, word-boundary) | base points |
|---|---|---|
| `high` | `\b(FIXME\|BUG\|XXX\|BROKEN\|DO\s*NOT\s*(SHIP\|MERGE))\b` | 5 |
| `medium` | `\b(TODO\|HACK\|TEMP\|TEMPORARY\|WORKAROUND\|KLUDGE\|REFACTOR)\b` | 3 |
| `low` | `\b(NOTE\|REVIEW\|NIT\|IDEA\|QUESTION\|MAYBE)\b` | 1 |
| `medium` *(default)* | no marker matched | 3 |

Application rules: patterns shall be evaluated **high → medium → low** and the **highest match wins**, so `# FIXME: TODO later` is `high`; patterns shall match **anywhere** in the comment, not only at its start; and a comment with **no recognised marker is still a finding** — the classifier detecting debt in prose alone is precisely why ML-1 exists rather than a plain regex scan — and defaults to `medium`.

*Rationale.* A supervised model can predict only what its training data labels, and the Li et al. dataset labels **categories, not severities**; there is no answer key for severity, so it cannot be learned and must be assigned deterministically. A single flat value was rejected because `# FIXME: auth check is bypassed` and `# TODO: rename this variable` are not equally bad. The three tiers encode a real distinction — *something is wrong* / *it works but it is ugly* / *for your information* — and use the same hand-written-table mechanism as the rule register, so each row is defensible individually. The division of labour is: the **probabilistic** component decides *is this debt and of what type*; the **deterministic** component decides *how bad*.

The patterns and their message templates are listed in **Appendix C.2**.

### 3.1.10 FR-10 [v1.0] Detection — risk model (ML-2)
The system shall compute a per-file **bug-proneness risk score (0–1)** with a supervised classifier (**Random Forest / Gradient Boosting**) over a **numeric feature vector per file** — Lizard product metrics (CCN, NLOC, nesting, params, comment ratio) from the scanned tree **plus the four PyDriller process metrics** (churn, author count, file age, recency) aggregated from the history reachable from the scanned SHA — trained on labelled defect data (**GHPR** primary; SZZ-derived labels; NASA PROMISE only as a legacy baseline). ML-2 is therefore the one component that legitimately depends on history, and it consumes that history strictly as numbers (FR-7.1), never as text; process metrics are retained because they are empirically stronger defect predictors than static metrics alone. The risk score **assigns neither a debt `category` nor a `severity`** (FR-8.1), produces **no findings** (FR-8.2), and is **not** a line-item. It has exactly two effects: it **boosts the priority of the findings in that file**, through the bounded `risk_factor` multiplier defined in FR-11, and it appears as a per-file **risk badge** (e.g. "risk 0.78") on the file row and in the hotspot tree. Because defective files are rare, the model is evaluated with precision/recall/F1/AUC (never accuracy), and the output is presented as a risk/health indicator, never a "bug oracle."

**The risk score does not by itself create debt.** A file with a high risk score but **no findings** contributes no debt and is not tinted as unhealthy; the badge still reports its risk. This keeps every point of debt traceable to a finding the user can open — a file tinted red that opens to an empty detail panel would be exactly the un-actionable noise this product exists to remove. Risk and debt therefore remain two honest signals rather than one blended number.

### 3.1.11 FR-11 [v1.0] Scoring & prioritization
The system shall fuse findings into scores with a **pure function** that reads the active **scoring profile** (five per-category weights + the trust slider `s` — FR-20) and any accepted-debt suppressions — applied **only at scoring**, so changing a profile or accepting a finding **never requires a re-scan**. It shall compute:

```
churn_factor(file) = 1 + min(commits_90d, 20) / 20        # 1.0 – 2.0
risk_factor(file)  = 1 + ml_trust × risk_score            # 1.0 – 2.5

rule_trust = 0.5 + s                                      # 0.5 – 1.5
ml_trust   = 1.5 − s                                      # 1.5 – 0.5
source_trust(finding) = 1.0         if category = security     ← FR-24
                      = rule_trust  if source   = rule
                      = ml_trust    if source   = satd

finding_priority = base_points(severity)
                 × category_weight[category]
                 × source_trust(finding)
                 × churn_factor(file)
                 × risk_factor(file)

file_debt   = Σ finding_priority (open findings only)
repo_health = 100 × (1 − min(1, Σ file_debt / (k · KLOC)))
grade       = A ≥ 85 · B ≥ 70 · C ≥ 55 · D ≥ 40 · E < 40
```

Severity base points: **Critical 8, High 5, Medium 3, Low 1**. Each factor answers exactly one question and has exactly one owner: *how bad is it* (the system, FR-8.1/FR-9.2) · *what type is it* (FR-8.1/FR-9) · *who found it* (the user's trust slider) · *how hot is the file* (measured) · *how fragile is the file* (FR-10).

**`base_points` is a lookup, not a judgement.** It is a four-entry map over the `severity` the detector already assigned and stored (FR-8.1). Scoring never decides *how bad* a finding is — only how much that badness is worth under the active profile. This is why the badge shown in FR-15 and the ranking computed here can never disagree: both read the same stored value.

**Risk multiplies; it does not add.** The risk score enters scoring **only** through `risk_factor`, in the same shape as `churn_factor` — a bounded per-file multiplier applied to every finding in that file. It contributes no additive term to `file_debt`, so it is never counted twice, and a file with no findings accrues no debt from risk alone (FR-10). A multiplier is also the correct shape: it scales proportionally, so a Critical finding in a fragile file gains more than a Low one, whereas an additive term would shift both equally.

**The bound is normative.** The maximum combined boost is `churn 2.0 × risk 2.5 = 5×`, which is strictly less than the 8× spread between Low (1) and Critical (8). Within a category, therefore, the machine-learning and churn signals may re-order findings but **shall never raise a `low` finding above a `critical` one**. The deterministic severity ranking cannot be inverted by a model.

> ✍️ **TEAM TODO:** `k` shall be **recalibrated** on the golden repositories. `file_debt` changed scale under [CR-001](../Change%20Requests/CR-001_2026-07-30_scoring-model-and-finding-ux.md) — an additive term was removed and a multiplier of up to 2.5× introduced — so any previously chosen value is invalid.

**Churn window anchoring.** `churn_factor(file) = 1 + min(commits_90d, 20) / 20` (range 1.0–2.0). The 90-day window shall be measured **backwards from the committer date of the scanned commit** — the branch's last commit, the same SHA the snapshot is keyed on:

```
window = [ commit_date(scanned_sha) − 90 days , commit_date(scanned_sha) ]
```

**Wall-clock `now()` shall not be used in scoring.** This makes `Scan(SHA)` reproducible (FR-21) and makes FR-6's skip-if-unchanged optimization sound (same SHA ⇒ same snapshot). It also means scanning an older commit yields the churn that was true *at that commit*, and an untouched repository does not drift in score merely with the passage of time. *(Decision D6, closed 2026-07-27 — release-roadmap §7.1.)*

### 3.1.12 FR-12 [v1.0] Overall Health card (Card A)
The system shall present the repo's **health score (0–100)**, **grade (A–E)**, **delta vs the previous snapshot**, and a **count of red (critical/high) issues**, for the selected branch. A folder or the repo root shows the aggregate of the stored file scores beneath it (drill-in re-aggregates without re-scanning).

### 3.1.13 FR-13 [v1.0] Category breakdown pie
The Health card shall include a small **pie chart** showing the percentage of technical debt **by category**, computed from the stored findings (count and/or debt-weighted). *(A standalone, filterable category-breakdown view = **FR-13b [v1.1]**.)*

### 3.1.14 FR-14 [v1.0] Health trend chart (Card B)
The system shall present a **trend chart** of health per scan/commit over time for the selected branch (repo scope), read from stored snapshots. *(Re-scoping Card B to a hovered file/folder's history = **FR-14b [v2]**; the hover event and per-node data seam exist from v1.0.)*

### 3.1.15 FR-15 [v1.0] Refactor-First list + filter by debt type
The system shall present a **prioritized list** of the top rule/SATD findings, sorted by `priority`, each row showing a **debt-category chip**, a **severity chip**, **`file:line`**, and the **one-line reason**. The severity chip renders the `severity` value **stored on the finding** (FR-8.1); the client performs no severity judgement of its own and only maps the stored string to its colour token.

**Source chip.** A row whose `source` is `satd` shall additionally carry a **`SATD` chip**, so the user can see that a developer already admitted this debt. Rows whose `source` is `rule` carry no source chip: `rule` is the default, and a chip present on every row carries no information. The source is shown as **its own chip and never inside the severity chip**, because severity is an ordinal scale (`critical > high > medium > low`) on which a source value is not comparable and would leave `base_points` undefined.

The user shall **filter the list by debt type** (`category`) so a security lead can view only `security`, a docs pass only `documentation`, etc. The per-file risk score is not a row (it is file-level); it lifts risky files up the ranking (FR-11) and shows as a badge.

### 3.1.16 FR-16 [v1.0] One-line reason (deterministic templates)
Every finding shall carry a **one-line, plain-English reason** generated by **string templates** (no NLP generation): one template per rule with the finding's own values interpolated (e.g. *"charge() has cyclomatic complexity 18, over the limit of 15 — split it into smaller functions"*); SATD quotes the extracted comment + predicted category; risk surfaces the salient signals. Reasons are reliable, explainable, instant, and never hallucinate. *(An AI **fix suggestion** that rewrites code is a separate, later feature.)*

### 3.1.17 FR-17 [v1.0] Finding detail — in-place detail mode
Selecting a Refactor-First row (or a file in the tree) shall switch the dashboard into **detail mode**, rendered **in place rather than as an overlay**:

| Region | Dashboard mode | Detail mode |
|---|---|---|
| Main | Overall Health card (FR-12) + health trend chart (FR-14) | **Finding detail** — evidence (rule id, measured value vs threshold, or the quoted comment), the one-line reason, and `file:line:symbol` |
| Right | Hotspot file tree (FR-18) | Hotspot file tree, **auto-expanded and highlighting the finding's file** |
| Bottom | *(the Refactor-First list in its full position)* | **Refactor-First list, condensed** — the user can move between findings without leaving detail mode |

Closing the finding shall restore the health card and trend chart and return the list to its full position. The selected finding shall be reflected in the URL so that reload and browser navigation behave correctly.

*Rationale.* This is the master–detail pattern used for reading many items in sequence, which is what triage is. An overlay covers the file tree, costs a close-and-reopen for every finding, and is too narrow to render a code snippet without wrapping; rendering in place keeps the tree visible and interactive, adds the spatial context of *where* the finding lives, and provides the width that FR-17b needs.

*(The offending **code snippet on demand** = **FR-17b [v1.1]** — v1.0 builds the region for it; **actions** Accept-debt / Resolve / False-positive = **FR-17c [v1.1]**. v1.0 is view-only.)*

### 3.1.18 FR-18 [v1.0] Hotspot file-tree heat map
The system shall present an **interactive file tree** on the right of the dashboard, each file/folder **tinted red → amber → green** by its health/debt score, with the per-file **risk badge** (FR-10) shown on the node. Folders aggregate their children. The user can **expand/collapse** and **drill in** (folder health re-aggregates from stored file scores, no re-scan). Hovering a node emits an event (wired for FR-14b) and selecting a file can open its finding detail.

**Reveal-and-highlight.** When the dashboard enters detail mode (FR-17), the tree shall **automatically expand the ancestors of the selected finding's file, scroll it into view, and highlight it**, so the user always sees where the finding they are reading lives. The tree remains fully interactive throughout detail mode.

### 3.1.19 FR-19 [v1.0] Scan history
The system shall provide a **Scan-History** view listing past snapshots for the active project/branch (each: date, commit SHA, health score, grade, delta, finding count). Selecting a past scan **loads that snapshot into the dashboard** (read-only view of history). This is possible because every scan is persisted (FR-21).

### 3.1.20 FR-20 [v1.0] Scoring profiles — presets and custom weights
The system shall let the user shape prioritization through a **scoring profile** consisting of **five per-category weights** and **one trust slider**. Any change re-scores the stored findings instantly (no re-scan) and re-orders the Refactor-First list.

**Controls.**

| Control | Range | Meaning |
|---|---|---|
| `category_weight` × 5 — `security`, `code-design`, `requirement`, `documentation`, `test` | 0.1 – 3.0 | *How much does this team care about this type of debt?* |
| Trust slider `s` | 0 – 1, default 0.5 | *How much does this team trust the deterministic rules versus the machine-learning detectors?* (FR-11) |

**Presets seed the sliders.** The system shall provide three presets — **Balanced** (the default for every new workspace), **Security-first** and **Delivery-speed** — which populate the sliders in one click, plus a **Reset to preset** action. Selecting a preset is therefore a single interaction; adjusting from it is optional.

| Preset | security | code-design | requirement | documentation | test | `s` |
|---|---|---|---|---|---|---|
| **Balanced** (default) | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 | 0.5 |
| **Security-first** | 3.0 | 1.0 | 0.8 | 0.5 | 1.0 | 0.5 |
| **Delivery-speed** | 1.5 | 1.2 | 0.8 | 0.5 | 0.5 | 0.7 |

**Constraints.** Weights shall be **clamped** to the ranges above, because `repo_health` is calibrated against `k` (FR-11) and unbounded weights would drive every repository to grade E and make the health score meaningless. The profile shall **never contain a severity** (FR-8.1). Regardless of profile, the **critical-security visibility floor** (FR-24) holds.

*Rationale for retaining presets alongside sliders.* A default profile must exist for every new workspace; a one-click preset change is what demonstrates *"same findings, different lens, no re-scan"*; and opening a configuration screen with six raw numeric controls and no guidance would work directly against U-1 and U-2, reproducing the very experience this product differentiates against.

### 3.1.21 FR-21 [v1.0] Snapshot persistence (stateful storage, stateless services)
The system shall store the result of every scan as an **immutable snapshot** keyed by (repo, branch, commit SHA, timestamp): the health score, per-file scores, tree, findings, and category breakdown. All dashboard reads (health, trend, history, delta) are pure reads of these snapshots. Application services remain stateless; persistence lives in PostgreSQL. This enables the trend chart, scan history, delta, and skip-if-unchanged.

### 3.1.22 FR-22 [v1.0] Account menu
The system shall provide an **Account** control at the bottom of the left rail exposing **sign out** and (stubbed in v1.0) **settings** and **billing**.

### 3.1.23 FR-23 [v2] Team & RBAC
The system shall support multi-user workspaces with roles **org-admin / manager / developer / viewer**, member **invitations**, and **auto-shared projects** (a member sees every workspace project without re-connecting). Role governs permissions (viewer = read dashboards; developer = scan + triage; manager = profiles + members; org-admin = connect/remove repos, members, billing). Repository access for scanning uses the workspace's GitHub App installation, not each member's personal token. *(Specified now; built in v2.)*

### 3.1.24 FR-24 [v1.0] Critical-security visibility floor
The system shall guarantee that **critical security findings are never suppressed or down-weighted below visibility**, regardless of the active profile or accepted-debt suppressions. A delivery-speed profile may de-prioritize a long method; it must never hide a leaked credential. *(This rule is what makes configurable prioritization safe.)*

The floor is enforced by **three independent mechanisms**, so that no single setting can defeat it:

1. **Severity is not user-settable.** `hardcoded-secret = critical` is fixed in the rule register (FR-8.1); no profile control can change it.
2. **The `security` category is excluded from the trust slider.** `source_trust` is always 1.0 for security findings (FR-11), so no position of `s` can de-weight them. Without this exclusion the "trust the model" end of the slider would halve every security finding, since all security detection is deterministic.
3. **Critical security findings are pinned into the visible list** regardless of computed priority, even at the minimum permitted `security` weight of 0.1 (FR-20).

> **Implementation note.** While profiles were preset-only, this requirement held by construction — no preset set the security weight low enough to matter. Now that FR-20 exposes weight sliders, mechanism 3 shall be **implemented as code**, not assumed. A statement in this document is no longer sufficient on its own.

### 3.1.25 FR-25 [supporting / Objective 5] ML evaluation vs rule baseline
The system's ML components shall be **evaluated and documented**: SATD classifier and risk model reported with **precision/recall/F1** (and AUC for risk), compared against the deterministic **rule baseline**, on held-out data and on real repositories. *(This satisfies Objective 5; produced during the testing phase, not a runtime feature.)*

> ✍️ **TEAM TODO:** add any v1.0 FRs the team wants that aren't captured (e.g. error/empty-state behaviour per screen, "dogfood scan of Code Sage AI itself"), and assign each a stable FR-id.

## 3.2 Usability

*Template guidance: training time, task times, conformance to usability standards.*

- **U-1 [v1.0]** A first-time developer shall be able to connect a repo, run a scan, and identify the top-priority issue **without reading a manual** — the low-noise, prioritized design is the core usability goal (the anti-SonarQube differentiator).
- **U-2 [v1.0]** The dashboard shall present the **most critical items first** and avoid overwhelming the user with raw metrics; findings are explained in one plain-English line.
- **U-3 [v1.0]** A non-technical stakeholder shall be able to read the **health score, grade, and trend** and understand codebase condition at a glance.
- **U-4 [v1.0]** The UI shall be **keyboard-navigable** with visible focus and **readable contrast** on severity/heat-map colours.
- **U-5 [v1.0]** Copy shall name actions by what the user does (e.g. empty state: *"No repositories yet — connect one to see its health."*).

> ✍️ **TEAM TODO:** set a measurable usability target (e.g. "a new user completes connect→scan→open-top-finding in under N minutes in a usability test").

## 3.3 Reliability

*Template guidance: availability, MTBF/MTTR, accuracy, defect rate.*

- **R-1 [v1.0]** A failed or cancelled scan shall **not corrupt** the previous snapshot; the dashboard continues to show the last good snapshot.
- **R-2 [v1.0]** Detection is deterministic and reproducible: the rule engine yields identical findings for identical inputs.
- **R-3 [v1.0]** ML outputs are presented as **risk/health indicators with documented error rates**, never as guarantees.

> ✍️ **TEAM TODO:** set target **availability** (e.g. 99.x% for the hosted service), acceptable **MTTR**, and the accuracy targets you will claim for the ML models (tie to FR-25 metrics).

## 3.4 Performance and Security

*Template guidance: response times, throughput, capacity; and security controls.*

**Performance**
- **P-1 [v1.0]** The dashboard shall remain **responsive during analysis**: scans run on Celery workers off the request path; the UI polls scan progress.
- **P-2 [v1.0]** Reads of a stored snapshot (health, trend, list, tree) shall render quickly since they are pure DB reads (no computation on read).
- **P-3** Profile switches and folder drill-ins recompute from stored findings **in milliseconds** (no re-scan).

> ✍️ **TEAM TODO:** set concrete targets — e.g. dashboard first paint < X s; scan of a Y-KLOC repo completes in < Z min; supports N concurrent scans. Feasibility scales the first release for **50 teams × 5 developers**.

**Security**
- **S-1 [v1.0]** Repository access shall be **least-privilege and read-only**; the user explicitly selects which repositories the system may access; the system cannot read any other repo.
- **S-2 [v1.0]** All client-server communication shall use **HTTPS**; secrets/tokens are stored securely, never exposed to the client.
- **S-3 [v1.0 seam]** Tenants shall be **logically isolated** via PostgreSQL **Row-Level Security**; no tenant can read another tenant's data.
- **S-4 [v1.1]** GitHub App installation tokens shall be used for private-repo access (secure, revocable, fine-grained).
- **S-5** The system shall not store repository source beyond what analysis requires, in line with the dataset/privacy posture in the Feasibility Report.

## 3.5 Supportability

*Template guidance: maintainability, coding standards, conventions.*

- **SP-1** One **data contract** (`apps/web/src/lib/types/index.ts`, mirrored in the plan) is the single source of truth for FE⇄BE shapes; changes go through a reviewed PR.
- **SP-2** Frontend uses **shadcn/ui** (owned source), Tailwind tokens (single-file theming), and shadcn Chart only (no raw Recharts); the file-tree library lives behind one component boundary.
- **SP-3** The system is **containerized (Docker)** with independently scalable frontend/backend/worker/DB components.
- **SP-4** The risk model supports **periodic re-training** on recent data (risk R6) without architectural change.

## 3.6 Design Constraints

*Template guidance: mandated design decisions (languages, tools, architecture).*

- **DC-1** Stack is fixed: **Next.js (App Router) + TypeScript + Tailwind/shadcn** (frontend); **FastAPI + Celery + Redis** (backend/workers); **Python + scikit-learn** with **Lizard** + **PyDriller** (ML/analysis); **PostgreSQL** (data). Deployed on cloud, containerized with Docker.
- **DC-2** **Charts** use shadcn Chart exclusively; **colours** come from CSS variables (never hardcoded); **display data** comes from the contract (never hardcoded).
- **DC-3** ML runs as **supervised** models trained once then used for inference; **no reinforcement learning**. Per-repo calibration and feedback learning are deferred (still supervised).
- **DC-4** Language support is **agnostic by architecture, validated on Python + JavaScript/TypeScript**; new languages require per-language security rules + recalibration.
- **DC-5** Scope is **locked to the proposal** (risk R7); new ideas go to the future-improvements list, not into v1.0.

## 3.7 On-line User Documentation and Help System Requirements

- **DOC-1** v1.0 shall include in-context empty/help copy and tooltips explaining scores, grades, severities, and the meaning of each debt category.

> ✍️ **TEAM TODO:** decide whether a separate help page / onboarding tour is in scope, and where (likely [v1.1]).

## 3.8 Purchased Components

- No paid/purchased components. All tools, libraries, and datasets are **free/open-source** (see Feasibility Report cost = USD 0). Third-party **payment processing (Stripe)** applies only to the [v2] billing feature.

## 3.9 Interfaces

*Template guidance: describe interfaces without screenshots — required panels/menus/fields; software, hardware, and communication interfaces; a block diagram of the main interfaces.*

### 3.9.1 User Interfaces
The GUI is a persistent **left rail** (Projects · Dashboard · Scan History · Team [v2] · Profiles · Account) with a swapping content area.
- **Login page:** a prominent **"Sign in with GitHub"** button.
- **Projects page:** a **Connect** control (public-URL input; private-repo picker [v1.1]); a **vertical project list** (name, owner, visibility, health hint, **Select**).
- **Dashboard page — dashboard mode:** a **top nav** (project name, **branch dropdown**, **Scan** button with progress + Stop, **last-analyzed time + commit SHA**); a **left half** (Overall Health card with category pie; Health trend chart; below them the **Refactor-First list** with a **debt-type filter**, each row carrying a category chip, a severity chip, `file:line`, the one-line reason, and — for SATD rows only — a **SATD source chip**); a **right half** (**hotspot file-tree heat map** with per-file risk badges).
- **Dashboard page — detail mode (FR-17):** selecting a finding replaces the health card and trend chart **in place** with the **finding detail** (evidence, one-line reason, `file:line:symbol`, and the region reserved for the [v1.1] snippet); the file tree **auto-expands and highlights** that finding's file; the Refactor-First list **condenses to a strip** so the user can move between findings. Closing restores dashboard mode. No overlay and no blurred background.
- **Scan-History page:** a list of past snapshots; selecting one loads it into the dashboard.
- **Profiles page:** three **preset buttons** (Balanced / Security-first / Delivery-speed) that seed the controls, **five category weight sliders**, one **rules ↔ model trust slider**, and a **Reset to preset** action; changes re-score instantly with no re-scan.
- **Account menu:** sign out, settings/billing (stubbed).

> ✍️ **TEAM TODO:** include a **block diagram** of the main UI interfaces (rail → pages → panels) per the template. Screenshots are not required at SRS stage.

### 3.9.2 Hardware Interfaces
- **Client side:** any modern laptop/desktop browser; no special hardware. Target responsiveness down to **laptop width**.

> ✍️ **TEAM TODO:** state minimum client prerequisites if the marker expects them (browser versions; RAM/disk are negligible for a web client).

### 3.9.3 Software Interfaces
- **GitHub API / GitHub App** — repository metadata, source, commit history (read-only, least privilege); ETag-cached conditional requests (rate-limit mitigation). **GitLab API** [v2].
- **Internal service interfaces** — the frontend calls the FastAPI **REST API** (`/api/...`); the backend enqueues jobs to **Celery/Redis**; the backend calls the **ML inference service**; all read/write **PostgreSQL**. Endpoint shapes follow the OpenAPI contract in the SAD/SDD.
- **Datasets** — Li SATD dataset, GHPR (+ NASA PROMISE legacy). These are **offline, download-once artefacts consumed during model training only**; no dataset and no external API is contacted during a scan. Note that GHPR expands to *GitHub Pull Request* but is training data — it does **not** imply runtime PR ingestion (FR-7.1).

### 3.9.4 Communications Interfaces
- **HTTPS/REST** between client and backend; asynchronous **HTTP polling** for scan progress. Internal broker traffic via **Redis**. All external traffic encrypted (TLS).

## 3.10 Database Requirements

*Template guidance: database requirements for the system.*

- **DB-1** **PostgreSQL** stores tenants/workspaces, users & roles, repository/project metadata, branches, **immutable scan snapshots**, per-file scores, findings, scoring profiles, and accepted-debt suppressions.
- **DB-2** **Multi-tenant isolation** via **Row-Level Security** keyed on `workspace_id`.
- **DB-3** Snapshots are **append-only** and keyed by (repo, branch, commit SHA, timestamp) to support trend, history, delta, and skip-if-unchanged.
- **DB-4** The stored shapes must satisfy the **data contract** (see SDD data view / `lib/types`).

> ✍️ **TEAM TODO:** the full ER diagram / table schema belongs in the **SAD/SDD Data View**; reference it here.

## 3.11 Licensing, Legal, Copyright, and Other Notices

- **L-1** All development tools/libraries are used under their **open-source licenses**; no copyright violations.
- **L-2** Repository data is processed under **least-privilege, user-granted** access; handled per privacy/data-protection norms; no unauthorized data sharing (Feasibility §2.5).
- **L-3** Public datasets are used under their research licenses (e.g. the Technical Debt Dataset is **CC BY-NC-SA 4.0** — research/non-commercial; verify compatibility before any commercial use).

> ✍️ **TEAM TODO:** confirm each dataset's license permits your intended use, and add a privacy-policy reference for the hosted service.

## 3.12 Applicable Standards

- **ST-1** This SRS follows **IEEE 830-1998** (course template #3).
- **ST-2** Secure integration follows **GitHub App** least-privilege guidance; multi-tenancy follows **PostgreSQL RLS** practice.
- **ST-3** Code quality: agreed team **Prettier/ESLint** conventions; typed contract via TypeScript.

---

# 4. Supporting Information

- **Appendix A — Traceability:** each FR traces to a proposal Objective / scope item and to a release (roadmap). *(✍️ TEAM TODO: add a traceability matrix FR → Objective → Test case.)*
- **Appendix B — Dashboard-output definitions:** the six outputs (health card, hotspot tree, Refactor-First list, finding detail, category breakdown, trend) with their exact data shapes are defined by the **data contract** (`apps/web/src/lib/types/index.ts`).
- **Reference format:** IEEE style; tools cited by web page with "(Accessed on <date>)".

## Appendix C — Rule register

The normative source for **FR-8.1** (severity/category assignment), **FR-9.2** (SATD severity) and **FR-16** (one-line reasons). One row per rule; `severity` is column 3, which is the complete answer to *"where does severity come from?"*

**C.1 — Rule-engine rules** (`source = rule`)

| `ruleId` | `category` | `severity` | base | Reason template |
|---|---|---|---|---|
| `hardcoded-secret` | security | **Critical** | 8 | `A credential-like value is assigned to {symbol} — move it to an environment variable and rotate the key.` |
| `sql-concat` | security | High | 5 | `SQL is built by string concatenation in {symbol}() — use a parameterised query.` |
| `dangerous-eval` | security | High | 5 | `{symbol}() calls {construct} on runtime input — replace it with an explicit parser or dispatch table.` |
| `complex-function` | code-design | Medium | 3 | `{symbol}() has cyclomatic complexity {value}, over the limit of {threshold} — split it into smaller functions.` |
| `long-method` | code-design | Medium | 3 | `{symbol}() is {value} lines long, over the limit of {threshold} — extract cohesive blocks into helpers.` |
| `deep-nesting` | code-design | Medium | 3 | `{symbol}() nests {value} levels deep, over the limit of {threshold} — use early returns to flatten it.` |
| `duplicate-block` | code-design | Low | 1 | `This block is duplicated {value} times across the file — extract it into a shared helper.` |
| `large-file` | code-design | Low | 1 | `{file} is {value} lines long, over the limit of {threshold} — consider splitting it by responsibility.` |

**C.2 — SATD marker patterns** (`source = satd`; `category` is predicted by ML-1, `severity` comes from the marker — FR-9.2)

| Marker pattern | `severity` | base | Reason template |
|---|---|---|---|
| `\b(FIXME\|BUG\|XXX\|BROKEN\|DO\s*NOT\s*(SHIP\|MERGE))\b` | High | 5 | `Self-admitted defect: '{comment_text}' — classified as {predicted_category}.` |
| `\b(TODO\|HACK\|TEMP\|TEMPORARY\|WORKAROUND\|KLUDGE\|REFACTOR)\b` | Medium | 3 | `Self-admitted debt: '{comment_text}' — classified as {predicted_category}.` |
| `\b(NOTE\|REVIEW\|NIT\|IDEA\|QUESTION\|MAYBE)\b` | Low | 1 | `Self-admitted note: '{comment_text}' — classified as {predicted_category}.` |
| *(no marker matched)* | Medium | 3 | `Self-admitted debt: '{comment_text}' — classified as {predicted_category}.` |

**C.3 — File-level risk message** (not a finding; the badge/tooltip text for FR-10)

| Trigger | Template |
|---|---|
| `risk_score` shown on a file | `High-risk file ({risk}): {salient_signals}.` → e.g. *"High-risk file (0.78): high complexity (CCN 18) and frequent change (14 commits/90d)."* |

> ✍️ **TEAM TODO:** expand C.1 as further rules are added (target ~30–50 rows as language coverage grows); confirm the `{construct}` and `{salient_signals}` interpolation fields with the backend.

*End of SRS v0.2 draft. Freeze the `Category` enum (D5) and the FR set with the whole team before promoting to v1.0. Recalibrate `k` (FR-11) before quoting any health score.*
