# Code Sage AI
## Software Architecture Document — Version 1.0 (v1.0 release scope)

**Group 16 · Project ID 7 · CS3203 — Software Engineering Project · Mentor: Mr. Anju Chamantha**

> **How to use this file.** It follows the course SAD template (#4, RUP "4+1" views) section for section. Diagrams are written as **Mermaid** so they render in GitHub and the architecture is captured now. For the `.docx` submission, redraw each one in draw.io or Lucidchart following the figure rules in the template: black text at 12pt or larger, white background, caption in the form "Figure n. caption", and at least one sentence of description in the text. Figure numbers here match the figure numbers in the `.docx` template exactly. Items still open for the team are marked **TEAM TODO**.

---

### Revision History

| Date | Version | Description | Author |
|---|---|---|---|
| 22/Jul/2026 | 0.1 (draft) | Initial architecture: 4+1 views, data model, quality attributes for v1.0. | Group 16 |
| 30/Jul/2026 | 0.2 (draft) | CR-001 (D-CR1 – D-CR7): domain model and data view updated for the two-value `source`, the write-once severity rule, the category weights plus trust slider profile (`w_ml` removed), risk as a scoring multiplier, and the in-place finding detail. | Group 16 |
| 31/Jul/2026 | 0.3 (draft) | CR-001 (D-CR8 – D-CR12): §9 data view — `SCAN` and `FILE_SCORE` hold facts only, every score derived on read. D-CR12 fixes the `Category` enum at six values, so `SCORE_PROFILE.weights` carries six keys. | Group 16 |
| 01/Aug/2026 | 0.4 (draft) | New §6.2 — the apply-profile write path (`PUT /api/profiles/active`), contrasted with the scan path. §9 gains `WORKSPACE.active_profile_id`. Implements SRS FR-20. | Group 16 |
| 03/Aug/2026 | 0.5 (draft) | Aligned with SRS v1.0. Three decisions recorded: repository access in v1.0 is **public URL paste only** (GitHub App moved to v1.1/v2); **scoring is a pure Python function**, never computed in the database; **no webhooks and no RBAC in v1.0**. `SCORE_PROFILE` weight count corrected to six throughout. `SUPPRESSION` removed from the v1.0 schema (SRS FR-17b makes finding actions v1.1). Figures renumbered 1–10 to match the `.docx`. | Group 16 |
| 05/Aug/2026 | 0.6 (draft) | §6.2 gains the step-by-step apply-profile workflow and the reason for `PUT` over `PATCH`. §9 adds the rule separating a cache from a source of truth, with the cache key defined on the inputs rather than the session. §10 adds the read-cost arithmetic, the exact per-group aggregate that makes the trend chart cheap, and the four-stage caching ladder with ETag at stage 1. No architectural decision changed — these record how the existing decisions perform. | Group 16 |
| 07/Aug/2026 | 0.7 (draft) | §6 completed and verified against the normative SRS `.docx`. Figure 4 redrawn as a swimlane activity diagram, one lane per process, so every lane crossing names its mode of communication and the FR-6 scan phase is visible; skip-if-unchanged, the error path and the ML bypass documented as decisions. Figure 5 corrected: the worker writes its phase to the database instead of calling the API (which contradicted Figure 7), and the poll loop is now concurrent with the pipeline rather than preceding it. All endpoint paths in §6 aligned with SRS Table 3.96. §10 capacity corrected to 50 registered users per SRS PERF-06 (was 250) and PERF-07 concurrency added. Citations fixed: FR-17b (was FR-17c), Table 3.97 (was 3-24), FR-9.3 (was Table 4-4), and the SRS filename in §1.4. Figure 10 rewritten with newline-separated attributes — the semicolon form was invalid Mermaid, so the ER diagram had never rendered. All nine Mermaid blocks now verified against the Mermaid 11 parser. | Group 16 |
| 07/Aug/2026 | 0.8 (draft) | Re-aligned with the revised SRS of 05/Aug 22:21. SRS Table 3.96 now carries `GET` and `PUT /api/profiles/active`, and FR-20 now states the idempotent-complete-write, no-request-while-dragging, clamp-and-return and unparameterised-read rules directly. §6.2 therefore cites them as normative instead of introducing the endpoint itself, and gains step 0 — the Profiles screen seeds from `GET /api/profiles/active` on load. Table citations renumbered for the SRS's new sequence (3.96 endpoints, 3.97 communications, 3.95 internal interfaces). No architectural decision changed: the SRS moved to match the architecture. | Group 16 |
| 08/Aug/2026 | 0.9 (draft) | Figure 4 corrected: ML-1 and ML-2 were drawn as a chain, which asserted a data dependency that does not exist. They are now parallel branches off extraction — comments to ML-1, product and process metrics to ML-2 — landing on `FINDING` and `FILE_SCORE` respectively (SRS FR-9, FR-10). The degraded-path edge now leaves the worker rather than ML-2, since the worker is where the call is attempted, and names the `risk_factor = 1.0` fallback. §6 gains a paragraph on model independence and on `category` coming from ML-1 while severity comes from the FR-9.2 marker table. | Group 16 |

---

## Table of Contents
1. Introduction (1.1 Purpose · 1.2 Scope · 1.3 Definitions · 1.4 References · 1.5 Overview)
2. Architectural Representation
3. Architectural Goals and Constraints
4. Use-Case View (4.1 Use-Case Realizations)
5. Logical View (5.1 Overview · 5.2 Architecturally Significant Design Packages)
6. Process View (6.1 The extraction boundary · 6.2 Applying a scoring profile · 6.3 The visibility floor)
7. Deployment View
8. Implementation View (8.1 Overview · 8.2 Layers)
9. Data View
10. Size and Performance (10.1 What a dashboard read costs · 10.2 The trend chart · 10.3 Caching)
11. Quality
12. References

---

# 1. Introduction

## 1.1 Purpose

This document describes the software architecture of **Code Sage AI**, the AI-powered technical-debt analytics dashboard specified in the SRS. It uses the RUP "4+1" model, so the system is presented through five views — Use-Case, Logical, Process, Deployment and Implementation — plus a Data View, because the persistent schema carries real architectural weight in this system.

The document has three audiences. The **development team** uses it to know which component owns which responsibility before writing code. The **mentor and evaluators** use it to judge whether the design actually delivers what the SRS promises. **Future maintainers** use it to understand why the system is shaped this way, so a later change does not quietly break an assumption.

It should be read together with the SRS, which says *what* the system must do. This document says *how* the parts are arranged to do it. Where the two overlap, the SRS is the normative source and this document points back to the requirement by its ID.

## 1.2 Scope

This document covers the architecture of the **v1.0 release**: a multi-tenant web application in which a user signs in with GitHub, connects a public repository by pasting its URL, runs a scan on a chosen branch when they decide to, and reads a prioritised technical-debt dashboard built from the stored result.

It covers all four parts of the system — the frontend, the backend API and its asynchronous workers, the machine-learning service, and the database.

Three limits are worth stating clearly, because they shape several views:

- **Repository access in v1.0 is public repositories by URL only.** Sign-in uses GitHub OAuth, and the analysis pipeline reads the repository through an ordinary `git clone`. There is no GitHub App installation, no private-repository support and no webhook endpoint in v1.0. Those belong to v1.1 and v2, and the document marks the points where they would attach.
- **Scans are started by the user, never by an event.** There is no automatic or event-driven analysis in v1.0 (SRS FR-6).
- **Later-release concerns** — team management and role-based access control, private repositories, additional Git hosts — are mentioned only where they affect a v1.0 decision, such as the tenant column that exists from day one so that multi-user workspaces can be added later without a migration.

## 1.3 Definitions, Acronyms, and Abbreviations

The project keeps a single glossary in **SRS §1.3**, and that glossary is the authority. The terms used most often in this document are listed below as a convenience for the reader.

| Term | Meaning in this document |
|---|---|
| Finding | One detected issue at a `file:line:symbol`, carrying a source, a category, a severity and a one-line reason. The atomic unit of output. |
| `source` | Which detector produced a finding. Exactly two values: `rule` or `satd` (SRS FR-8.2). |
| `category` | What kind of debt a finding is. Exactly six values: `code-design`, `requirement`, `defect`, `documentation`, `test`, `security` (SRS FR-9.3). |
| Snapshot | The stored, immutable result of one scan, identified by repository, branch, commit SHA and time. |
| Scoring profile | The six category weights plus the trust slider that turn stored findings into scores (SRS FR-20). |
| Visibility floor | The rule that a critical security finding stays visible no matter how the profile is set (SRS FR-24). |
| Workspace / tenant | The top-level owner of data. A project belongs to a workspace, not to a person. |
| RLS | PostgreSQL Row-Level Security, the mechanism used to keep tenants apart. |
| ML-1 / ML-2 | The SATD comment classifier and the file-level bug-proneness risk model. |

## 1.4 References

1. **Software Requirements Specification**, Code Sage AI v1.0 — `docs/Deliverables/SRS(Tentative)_Group_16_Technical_Debt_Dashboard.docx`. The normative source for every FR, NFR and appendix referenced here. *(The `.md` copy in the same folder is a superseded working draft and is not normative.)*
2. **Change Request CR-001** — `docs/Change Requests/CR-001_2026-07-30_scoring-model-and-finding-ux.md`. The scoring-model and finding-UX decisions (D-CR1 – D-CR12).
3. **Backend Analysis Engine design note** — `docs/Project Management & Planning/code-sage_backend-analysis-engine.md`.
4. **Release Roadmap** and **Frontend Prototype Plan** — `docs/Project Management & Planning/`.
5. **Project Proposal** and **Feasibility Report** — `docs/Deliverables/`.
6. **Shared data contract** — `apps/web/src/lib/types/index.ts`. The single source of truth for the shapes crossing the frontend, backend and database boundary (SRS SP-4).

**Diagram tool:** TEAM TODO — state the tool used for the final `.docx` diagrams and cite it in IEEE style, with the accessed date.

## 1.5 Overview

The rest of the document is organised as follows.

**Section 2** explains which architectural views are used and why. **Section 3** lists the goals and constraints that actually shaped the design, each with its architectural consequence. **Sections 4 to 8** present the five views: the use cases that exercise the architecture, the decomposition into subsystems and classes, the runtime behaviour of the processes, the physical deployment, and the layering of the codebase. **Section 9** describes the persistent data model and the rule that separates stored facts from derived scores. **Section 10** covers sizing and performance targets, and **Section 11** explains how the architecture delivers the quality attributes. **Section 12** lists the references.

---

# 2. Architectural Representation

Code Sage AI is a **multi-tenant web application with an asynchronous analysis pipeline and an offline-trained machine-learning component**. Work that takes seconds to minutes is pushed off the request path onto background workers, so the user interface stays responsive while a repository is being analysed.

All five 4+1 views are used, plus a Data View. The Data View is normally optional, but here the schema encodes an architectural rule — which values are stored and which are computed — so leaving it out would hide a central decision.

| View | What it captures | Diagrams |
|---|---|---|
| Use-Case | The user journeys that exercise the most architecture | Use-case diagram, scenario tables (Figure 1) |
| Logical | Decomposition into subsystems, layers and key classes | Package and class diagrams (Figures 2, 3) |
| Process | Runtime behaviour, background workers, how processes talk | Activity and sequence diagrams (Figures 4, 5, 6) |
| Deployment | Physical nodes and which process runs where | Deployment diagram (Figure 7) |
| Implementation | How the source code is layered and organised | Component and package diagrams (Figures 8, 9) |
| Data | The persistent multi-tenant schema | ER diagram (Figure 10) |

One idea runs through every view and is worth stating once, up front:

> **Detection and scoring happen on the server. The dashboard only reads and draws.**

This is why the client is thin, the services are stateless, and the database is the only stateful part of the system.

---

# 3. Architectural Goals and Constraints

| # | Goal or constraint | What it forces in the architecture |
|---|---|---|
| G1 | **Secure multi-tenancy** (SRS FR-2, SEC-03, DBR-3) | A workspace is a tenant. Every tenant-owned table carries `workspace_id` and is protected by PostgreSQL Row-Level Security. The column exists from day one even though v1.0 has one user per workspace, so adding teams later is not a migration. |
| G2 | **The UI must stay responsive during a scan** (SRS PERF-05, FR-6) | Scans run on Celery workers behind a Redis broker, never inside the HTTP request. The API returns a scan ID immediately and the client polls for progress. |
| G3 | **Output must be low-noise and explainable** (SRS U-4, U-6, FR-16) | A deterministic rule engine plus fixed message templates. Machine learning is surfaced as a risk level and a debt category, never as a verdict the user cannot check. |
| G4 | **Changing a profile must not require a re-scan** (SRS FR-20, FR-21, SP-7) | Scoring is a **pure Python function** over stored findings. Weights are applied at read time only. Nothing about a profile is ever written onto a finding. |
| G5 | **Severity must never be influenced by the user** (SRS FR-8.1, FR-24) | `severity` and `category` are written once, by the detector that produced the finding, and no later process updates them. The profile carries weights only. |
| G6 | **The prototype must become the product** (SRS SP-10) | The frontend is built against a frozen data contract with mock handlers. Moving to the real backend is a base-URL change, not a rewrite. |
| G7 | **Core first, on a fixed academic schedule** | The rule engine ships and works on its own. The ML models are added on top of a system that is already useful, so a weak model delays a feature rather than the release. |
| G8 | **Free, containerised, independently scalable stack** (SRS SP-20) | Each component ships as its own Docker container. Workers scale horizontally for concurrent scans. |

**Constraints.** The technology stack is fixed: Next.js and Tailwind on the frontend; FastAPI, Celery and Redis on the backend; Python with scikit-learn, Lizard and PyDriller for analysis and ML; PostgreSQL for storage; Docker for deployment. Only supervised learning is used. Models are trained offline on public datasets and loaded at runtime as versioned artifacts (SRS SP-14). The team has three members and an academic timeline, which is why v1.0 is deliberately one complete vertical slice rather than several half-finished features.

---

# 4. Use-Case View

**Actors.** Developer (primary), Tech Lead or Manager, Viewer or Stakeholder, Org Admin *(v2 only)*, GitHub *(external system)*, and the ML Service *(an internal system actor, shown because it participates in the scan)*.

**Architecturally significant use cases for v1.0.**

| ID | Use case | Actors | Why it is architecturally significant |
|---|---|---|---|
| UC-1 | Sign in | Developer, GitHub | Establishes the session and the workspace context that RLS depends on. |
| UC-2 | Connect a repository | Developer, GitHub | The only point where external repository metadata enters the system. |
| UC-3 | Run a scan | Developer, GitHub, ML Service | **The central case.** It exercises every layer, every process and every external interface. |
| UC-4 | View the health dashboard | Developer, Viewer | Exercises the read path and proves that the client computes nothing. |
| UC-5 | Triage and filter findings | Developer | Exercises the in-place detail mode and the ranked list. |
| UC-6 | Select a scoring profile | Tech Lead | The second write path, and the one that must not trigger a scan. |
| UC-7 | Browse scan history | Developer | Exercises the immutable snapshot store and the trend. |
| UC-8 | Manage team and roles *(v2)* | Org Admin | Shown only to confirm the tenant seam is placed correctly. |

```mermaid
flowchart LR
    Dev([Developer]):::a
    Lead([Tech Lead]):::a
    View([Viewer]):::a
    GH([GitHub]):::ext
    ML([ML Service]):::ext

    UC1((Sign in))
    UC2((Connect repo))
    UC3((Run scan))
    UC4((View dashboard))
    UC5((Triage and filter))
    UC6((Select profile))
    UC7((Scan history))

    Dev---UC1---GH
    Dev---UC2---GH
    Dev---UC3
    UC3---ML
    Dev---UC4
    View---UC4
    Dev---UC5
    Lead---UC6
    Dev---UC7
    classDef a fill:#eef,stroke:#333,color:#000
    classDef ext fill:#efe,stroke:#333,color:#000
```

*Figure 1. Use-case overview for v1.0.* Figure 1 shows the seven v1.0 use cases and the actors that take part in each. The ML Service is drawn as an actor because it is a separate process that the scan calls out to, not a library inside the worker.

**TEAM TODO:** redraw Figure 1 as a proper UML use-case diagram, with ovals inside a labelled system boundary.

## 4.1 Use-Case Realizations

### UC-3 Run a scan *(the central realization)*

| | |
|---|---|
| **Use case name** | Run a scan |
| **Actors** | Developer (starts it); GitHub and the ML Service take part |
| **Description** | Analyse the selected branch of the active project and store the result as a snapshot that the dashboard can render. |
| **Preconditions** | The user is signed in, a project is connected and selected, and a branch is chosen. |
| **Main flow** | 1. The user clicks **Scan**. 2. The API creates a scan record with phase `queued`, puts a job on the Redis queue and returns a `scanId` straight away. 3. The UI shows progress and polls the status endpoint once a second. 4. A worker clones the branch at its head commit SHA. 5. The worker extracts static metrics with Lizard, process metrics with PyDriller, and source comments from the working tree at that SHA. 6. The rule engine produces rule and security findings; ML-1 classifies the comments into SATD findings; ML-2 produces a per-file risk score. 7. The worker stores the findings, the per-file risk scores and the churn factors as an immutable snapshot. 8. The scan is marked `done`. 9. The UI requests the dashboard payload, the API scores the stored findings under the active profile, and the dashboard renders. |
| **Successful post-condition** | A new snapshot exists. The dashboard shows an updated health score, file tree, finding list and trend point, with the new last-analysed time and commit SHA. |
| **Fail post-condition** | The scan ends in `error` or `idle`. The previous snapshot is untouched and is still what the user sees. |
| **Extensions** | 3a. The user clicks **Stop**, the job is cancelled and the scan returns to `idle`. 4a. The branch head SHA equals the last scanned SHA, so the system may skip the work and reuse the stored snapshot. 6a. The ML service is unavailable, so the scan completes with rule-engine findings only — degraded, but still a valid snapshot. |

### UC-2 Connect a repository

| | |
|---|---|
| **Use case name** | Connect a repository by public URL |
| **Actors** | Developer; GitHub |
| **Description** | Add a public repository to the workspace as a project. |
| **Preconditions** | The user is signed in. |
| **Main flow** | 1. The user pastes a public repository URL. 2. The API validates the URL format and reads the repository metadata from the GitHub REST API — name, owner, visibility and default branch. 3. A project row is created under the user's workspace. 4. The project appears in the Projects list. |
| **Successful post-condition** | The project is connected and can be selected. |
| **Fail post-condition** | The URL is invalid, unreachable or not public, so an error message is shown and no project row is created. |
| **Extensions** | Private repository → this needs the GitHub App installation flow, which is **v1.1**. In v1.0 the request is rejected with a clear message. |

### UC-6 Select a scoring profile

| | |
|---|---|
| **Use case name** | Select or adjust a scoring profile |
| **Actors** | Tech Lead or Developer |
| **Description** | Change how the six debt categories are weighted, and how far the team trusts the rules against the models, then see the dashboard re-rank immediately. |
| **Preconditions** | The user is signed in and at least one snapshot exists. |
| **Main flow** | 1. The user picks a preset or moves the sliders. 2. The client holds the change locally; no request is sent while dragging. 3. The user clicks **Apply**. 4. The API clamps the weights to 0.1–3.0 and the trust value to 0–1, stores them, and sets the workspace's active profile. 5. The client re-reads the dashboard. 6. The API scores the same stored findings under the new profile and returns new priorities, scores and grade. |
| **Successful post-condition** | The list re-orders and the grade may change. **No scan runs, no worker wakes, and no snapshot is written.** |
| **Fail post-condition** | The update fails, the previously active profile stays in force, and the dashboard is unchanged. |
| **Extensions** | 4a. A weight arrives outside the allowed range and is clamped by the server before it is stored. |

**TEAM TODO:** add scenario tables for UC-4 (View the dashboard) and UC-5 (Triage and filter) before the final submission.

---

# 5. Logical View

## 5.1 Overview

The design splits into four subsystems, each internally layered.

```mermaid
flowchart TB
    subgraph FE["Frontend (Next.js)"]
        Pages["App Router pages"] --> Feat["Feature components<br/>(dashboard, projects, layout)"]
        Feat --> UIlib["shadcn/ui primitives"]
        Feat --> Hooks["data hooks"] --> ApiClient["API client"]
        Types["lib/types (CONTRACT)"]
    end
    subgraph BE["Backend (FastAPI + Celery)"]
        API["REST routers"] --> Svc["Domain services<br/>(projects, scans, scoring)"]
        Svc --> Score["ScoringEngine<br/>(pure Python function)"]
        Svc --> Tasks["Celery tasks (scan pipeline)"]
        Tasks --> Extract["Extraction (Lizard, PyDriller)"]
        Tasks --> Detect["Detection (rule engine)"]
    end
    subgraph MLS["ML Service (Python, scikit-learn)"]
        SATD["SATD classifier (ML-1)"]
        Risk["Risk model (ML-2)"]
    end
    subgraph DB["PostgreSQL"]
        Repos["repos / branches"]
        Snaps["snapshots / findings / file scores"]
        Tenants["workspaces / users (RLS)"]
    end
    ApiClient -->|HTTPS REST| API
    Detect --> Snaps
    Tasks --> SATD
    Tasks --> Risk
    Svc --> DB
    Score --> DB
```

*Figure 2. Logical decomposition into subsystems and layers.* Figure 2 shows that the shared contract in `lib/types` is what the frontend hooks are written against, and that it mirrors the API and database shapes. Note where `ScoringEngine` sits: it is called by the domain services on the **read** path, not by the workers on the write path.

## 5.2 Architecturally Significant Design Packages

```mermaid
classDiagram
    class Workspace { id; name; activeProfileId }
    class User { id; name; email }
    class Membership { role: Role }
    class Repo { id; name; owner; visibility; url; defaultBranch }
    class Branch { name; isDefault; lastCommitSha; lastCommitAt }
    class Scan { scanId; branch; commitSha; scannedAt; phase; findingCount; modelVersion }
    class Finding { fingerprint; source: rule|satd; category; severity; file; line; symbol; reason; status }
    class FileScore { file; riskScore; churnFactor }
    class ScoreProfile { id; name; weights: 6 categories; trustS; isPreset }
    class ScoringEngine { score(findings, profile) }

    Workspace "1" --> "*" Membership
    User "1" --> "*" Membership
    Workspace "1" --> "*" Repo
    Repo "1" --> "*" Branch
    Repo "1" --> "*" Scan
    Scan "1" --> "*" Finding
    Scan "1" --> "*" FileScore
    Workspace "1" --> "*" ScoreProfile
    Workspace "1" --> "1" ScoreProfile : active
    ScoringEngine ..> Finding : reads
    ScoringEngine ..> FileScore : reads
    ScoringEngine ..> ScoreProfile : reads
```

*Figure 3. Core domain model.* In Figure 3, **Scan** is the aggregate root of a snapshot and **Finding** and **FileScore** are its parts. **ScoreProfile** and **ScoringEngine** sit outside that aggregate on purpose: the engine reads all three and writes none of them.

Three rules in this model are worth spelling out, because most of the architecture depends on them.

**`category` and `severity` are written once, by whoever detected the finding.** For a rule finding, both come from the rule definition in SRS Appendix C.1. For a SATD finding, ML-1 supplies the `category` and the comment-marker table in SRS Appendix C.2 supplies the `severity`. Nothing downstream recomputes either one. `ScoringEngine` reads `severity` only to look up its base points; the client reads it only to draw a badge. Because no user setting can reach these two columns, a profile change re-ranks findings without altering a single stored value. This is normative in SRS FR-8.1 and FR-9.2.

**`source` has exactly two values, `rule` and `satd`.** Only two components emit findings. Security patterns run inside the rule engine, so a security finding is a `rule` finding whose `category` is `security` — a separate `security` source value would duplicate the category axis and break the independence the model relies on. ML-2 emits no findings at all; it writes `FileScore.riskScore`. This is normative in SRS FR-8.2.

**`ScoreProfile` holds weights, never severities.** It carries six category weights, one for each value of `category`, plus a single trust scalar `s` that slides between trusting the rules and trusting the models. It is read only by `ScoringEngine`, only at scoring time. This is normative in SRS FR-20.

---

# 6. Process View

**The processes.** Four kinds of process make up a running system: the **API process** (FastAPI, stateless, can be replicated); one or more **worker processes** (Celery, where the scan pipeline runs); the **ML inference process**, which loads the two model artifacts and answers classification and risk requests; and the **database process**. The API and the workers communicate through the **Redis** broker, which carries job messages and progress state. Everything persists to **PostgreSQL**.

| Process | Kind | Talks to | Carries |
|---|---|---|---|
| API (FastAPI) | Stateless, request/response | Redis, PostgreSQL, GitHub | HTTP requests, job enqueue, all read-path scoring |
| Worker (Celery) | Long-running, background | Redis, PostgreSQL, ML service, GitHub | The clone → extract → detect → persist pipeline |
| ML inference | Long-running, request/response | Called by workers | Comment batches in, labels out; feature vectors in, risk scores out |
| PostgreSQL | Stateful | API and workers | All persistent state |

Figure 4 is drawn with one swimlane per process, so that every arrow crossing a lane boundary is one of the four modes of communication named in the table above. The scan phase (SRS FR-6, U-10) is annotated on the activities that change it.

```mermaid
flowchart TB

    subgraph U["USER — browser (Next.js client)"]
        direction LR
        U1["Click Scan<br/>phase = idle"]
        U2["Poll status every 1 s<br/>phase = running NN%"]
        U3["Click Stop<br/>(optional)"]
        U4["Dashboard renders<br/>phase = done"]
    end

    subgraph A["API PROCESS — FastAPI (stateless, replicable)"]
        direction LR
        A1["Read branch head SHA"]
        A2{"head SHA =<br/>last scanned SHA?"}
        A3["INSERT SCAN<br/>phase = queued"]
        A4["Return scanId"]
        A5["Serve phase + progress"]
        A6["Revoke job<br/>phase = idle"]
        A7["ScoringEngine.score<br/>findings x active profile"]
    end

    subgraph Q["BROKER — Redis (private network)"]
        direction LR
        Q1(["Job queue + progress state"])
    end

    subgraph W["WORKER PROCESS — Celery (1..n, scaled horizontally)"]
        direction LR
        W1["git clone at SHA<br/>phase = running"]
        W2["Extract: Lizard, PyDriller,<br/>comments at that SHA"]
        W3["Rule engine:<br/>rule + security findings"]
        W4["Persist snapshot"]
        W5["phase = done"]
        WE["phase = error"]
    end

    subgraph M["ML PROCESS — inference service"]
        direction LR
        M1["ML-1 SATD classify"]
        M2["ML-2 per-file risk"]
    end

    subgraph D["DATABASE — PostgreSQL (RLS)"]
        direction LR
        D1[("SCAN")]
        D2[("FINDING + FILE_SCORE")]
    end

    U1 -->|HTTPS POST /api/repos/repoId/scan| A1
    A1 --> A2
    A2 -->|yes: skip re-scan| A7
    A2 -->|no| A3
    A3 -->|SQL over TLS| D1
    A3 -->|Redis message: enqueue scanId| Q1
    A3 --> A4
    A4 -->|HTTPS scanId + phase| U2
    Q1 -->|Redis message: deliver scanId| W1
    W1 --> W2
    W2 --> W3
    W2 -->|HTTP: comments at that SHA| M1
    W2 -->|HTTP: product + process metrics| M2
    M1 -->|SATD findings, category only| W4
    M2 -->|risk_score 0-1 per file| W4
    W3 --> W4
    W4 -->|SQL over TLS: append-only INSERT| D2
    W4 --> W5
    W5 -->|SQL over TLS: UPDATE phase| D1
    W1 -->|Redis: publish NN%| Q1
    U2 -->|HTTPS GET .../scan/scanId| A5
    A5 -->|Redis: read progress| Q1
    U3 -.->|HTTPS POST .../scan/scanId/stop| A6
    A6 -.->|Redis: revoke| Q1
    W2 -.->|clone or extract fails| WE
    W2 -.->|ML unreachable: rule findings only, risk_factor = 1.0| W4
    U4 -->|HTTPS GET /api/repos/repoId/health| A7
    A7 -->|SQL over TLS: read stored facts| D2
    A7 -->|HealthReport| U4
```

*Figure 4. Scan activity across the four processes, with the scan phase annotated.* Figure 4 shows something important about where scoring happens. The write path ends in the worker lane at "persist snapshot"; **`ScoringEngine` never appears in that lane.** Scoring is not a pipeline stage — it sits in the API lane and runs on the read path, every time the dashboard is requested.

Three details in the figure are architectural decisions rather than drawing conventions.

**Skip-if-unchanged is decided in the API lane, before the enqueue.** The check costs one conditional GitHub REST call for the branch head SHA (ETag-conditional, so it usually costs no quota) against one indexed database read. Deciding it in the API means an unchanged branch never reaches Redis and never occupies a worker, and the user gets the dashboard back inside the PERF-03 one-second budget instead of watching a scan that has nothing to do.

**The error path terminates in the worker lane, not the API lane.** A failed scan is recorded by the worker as `phase = error` on the existing `SCAN` row, which is what makes SRS SP-13 work: a user-reported failure is diagnosable from the database without reading logs. The previous snapshot is untouched, because nothing was written to `FINDING` or `FILE_SCORE`.

**The two models are independent, and the figure must not chain them.** ML-1 and ML-2 take different inputs, produce different outputs and never exchange data. ML-1 reads the comments and emits SATD findings, predicting `category` only — one of the five dataset categories, never `security`, which the rule engine alone produces (SRS FR-9.3). Severity for those findings comes from the deterministic marker table in SRS Appendix C.2, not from the model (SRS FR-9.2). ML-2 reads the Lizard product metrics and the four PyDriller process metrics and emits one `risk_score` per file; it produces **no findings at all** (SRS FR-10), which is why its arrow lands on `FILE_SCORE` while ML-1's lands on `FINDING`. Drawing one model feeding the other would assert a dependency that does not exist and would serialise two calls that can run at the same time.

**The ML lane is bypassable.** The dashed edge that skips the ML lane carries the degraded case, and it leaves from the worker rather than from a model — the worker is where the call is attempted, so it is where the failure is observed. Because both models are hosted in one inference container (§7), they are reachable or unreachable together. When they are unreachable the worker still persists a valid snapshot: rule and security findings are all present, no SATD findings appear, and every `risk_factor` falls back to 1.0, so no finding receives a risk boost. A failed model costs a feature, never the scan.

## 6.1 The extraction boundary

> **Git history enters the pipeline as numbers, never as text.**

Text produces findings, and a finding must land on a `file:line` the user can open — so text is read from the checked-out tree at the scanned commit. History produces metrics, so it may look backwards, but only as a numeric feature vector. This is normative in SRS FR-7.1.

| Input | Used at scan time? |
|---|---|
| Source comments at the scanned SHA | Yes — the SATD classifier reads these |
| Source files at the scanned SHA | Yes — Lizard, then the rule engine and ML-2 |
| Commit history reachable from that SHA | Yes, but only as four numbers: churn, author count, file age, recency |
| Commit message text | No — it has no `file:line`, so a finding could not point anywhere |
| Pull requests, issues, GitHub API metadata | No — the pipeline runs off a clone and uses no API quota |
| Previously stored snapshots | No — history is read only to draw trends and deltas, never to detect or score |

Two consequences follow, and the architecture leans on both.

**A scan is a pure function of the repository at one commit.** The result depends on the tree and reachable history at that SHA plus a fixed model version — never on a previous scan row. This is what makes skip-if-unchanged (branch B of Figure 4) safe, and what makes snapshots reproducible. The precision matters: a scan is independent of prior *scans*, not of git *history*, because ML-2 needs that history as numbers.

**The churn window is anchored to the commit, not to the clock.** The 90 days are measured backwards from the scanned commit's committer date, never from `now()`. Wall-clock time is not an input to scoring at all. Without this, the same commit would score differently on different days and skip-if-unchanged would be unsound. *(Decision D6, closed 27 Jul 2026; normative in SRS FR-11.)*

```mermaid
sequenceDiagram
    actor Dev as Developer
    participant UI as :DashboardUI
    participant SC as :ScanControl
    participant API as api:FastAPI
    participant Q as broker:Redis
    participant W as worker:CeleryTask
    participant EX as :Extractors(Lizard,PyDriller)
    participant ML as ml:Service(SATD,Risk)
    participant RE as :RuleEngine
    participant SS as :ScoringEngine
    participant DB as db:PostgreSQL

    Dev->>UI: click Scan
    UI->>SC: start(repoId, branch)
    SC->>API: POST /api/repos/{repoId}/scan
    API->>DB: INSERT SCAN (phase = queued)
    API->>Q: enqueue(scanId)
    API-->>SC: 202 { scanId, phase: queued }

    Q->>W: deliver(scanId)
    activate W
    W->>DB: UPDATE SCAN (phase = running)

    par worker runs the pipeline
        W->>EX: extract(clone at SHA)
        EX-->>W: static metrics, process metrics, comments
        W->>RE: detect(metrics)
        RE-->>W: rule and security findings
        W->>ML: classify(comments), risk(feature vectors)
        ML-->>W: SATD findings, per-file risk scores
        W->>Q: publish progress NN%
    and client polls independently
        loop every 1 s until phase is done or error
            SC->>API: GET /api/repos/{repoId}/scan/{scanId}
            API->>Q: read progress
            API-->>SC: { phase, progress }
        end
    end

    W->>DB: INSERT FINDING, FILE_SCORE (append-only)
    W->>DB: UPDATE SCAN (phase = done)
    deactivate W

    SC->>API: GET /api/repos/{repoId}/health?branch=...
    API->>DB: read findings and per-file facts
    API->>SS: score(findings, active profile)
    SS-->>API: priorities, file debt, health, grade, breakdown
    API-->>UI: HealthReport
    UI-->>Dev: render dashboard
```

*Figure 5. Run-a-scan sequence.* Figure 5 shows the full path through the internal objects. Three things in it are worth reading carefully.

`:ScoringEngine` is invoked by the **API**, after the worker has finished and the client has asked for the dashboard — never by the worker. The write path and the scoring path do not touch.

**The worker never calls the API.** It reports its phase by writing to `SCAN` and its progress by publishing to Redis; the API serves the polling client from those two places. This keeps the dependency direction one-way and matches the deployment view in Figure 7, which has no worker-to-API edge.

**The polling loop and the pipeline are concurrent, not sequential.** They are drawn in a `par` fragment because the client is polling *while* the worker works — that is the whole point of the asynchronous design (SRS PERF-05). Drawing the loop before the worker starts would say the opposite.

## 6.2 Applying a scoring profile

A profile change is the only other user-initiated write in v1.0, and it is deliberately the opposite of a scan in every way. Nothing is queued, no worker wakes and no snapshot row is written (SRS FR-20, FR-21).

**The full workflow, step by step.**

0. On load, the Profiles screen seeds its controls from `GET /api/profiles/active`, so the sliders always open showing what is actually in force.
1. The user picks one of the three presets — **Balanced** is the workspace default — or drags the six weight sliders and the trust slider directly. This is client-side state only — **no request is sent while dragging**.
2. The user clicks **Apply**.
3. The client sends `PUT /api/profiles/active` carrying the **complete** profile: the six weights and `trust_s`.
4. The server validates and clamps — weights to 0.1–3.0, `trust_s` to 0–1.
5. The server writes, in one transaction: `UPDATE score_profile SET weights, trust_s` and `UPDATE workspace SET active_profile_id`. Seven numbers. That is the entire write.
6. The server returns the profile **as stored**, after clamping, so the interface shows what is really in force rather than what the client asked for.
7. The client re-reads `GET /api/repos/{repoId}/health?branch=…`. **The URL is unchanged** — no profile appears in it.
8. The server reads the stored findings and per-file facts, passes them to `ScoringEngine`, and returns the re-scored dashboard.

**The two endpoints this uses are normative.** SRS Table 3.96 defines both halves: `GET /api/profiles/active` returns the workspace's active profile and seeds the Profiles screen on load, and `PUT /api/profiles/active` applies one. FR-20 states the contract they honour — a profile is applied in *"a single idempotent write carrying the complete profile"*, dragging a control *"changes client state only; no request is issued until the user confirms with Apply"*, and the server *"clamps every weight on write and returns the stored profile, so the client confirms what was saved rather than assuming its own values were accepted."* The workflow above implements that requirement rather than inventing it; the paragraphs that follow record *why* the shape is the right one.

**Why `PUT` and not `PATCH`.** `PUT` means "make this resource look exactly like this". The body is the whole profile, not a change to it, so a retry after a dropped response cannot double-apply anything. That matters specifically because step 7 fires immediately after step 6: a half-applied profile would render a dashboard matching no profile that actually exists.

**Why no profile in the URL of step 7.** FR-20 settles this: *"the active profile is server-side state scoped to the workspace, so the read endpoints are unchanged and carry no profile parameter."* The architectural reason is that if the profile travelled as a query parameter, every read endpoint would grow a parameter each time the profile shape changed, and the scoring formula would leak into the API surface. SRS Table 3.96 reflects it — `GET /api/repos/{repoId}/health?branch=` takes a branch and nothing else, and derives scores under the active profile.

| | Run a scan | Apply a profile |
|---|---|---|
| Request | `POST /api/repos/{repoId}/scan` | `PUT /api/profiles/active` |
| Handled by | API → Redis → Celery worker | The API process alone |
| Writes | A new immutable `SCAN` with its `FINDING` and `FILE_SCORE` rows | Seven numbers on one `SCORE_PROFILE` row |
| Duration | Seconds to minutes, polled | One round trip |
| Effect on findings | Creates them | Leaves them completely untouched |

```mermaid
sequenceDiagram
    actor Dev as Developer
    participant UI as :ProfilesUI
    participant API as api:FastAPI
    participant SS as :ScoringEngine
    participant DB as db:PostgreSQL

    Dev->>UI: pick preset or drag sliders
    Note over UI: client state only, no request sent
    Dev->>UI: click Apply
    UI->>API: PUT /api/profiles/active { weights, trust_s }
    API->>API: clamp weights 0.1-3.0, trust_s 0-1
    API->>DB: UPDATE SCORE_PROFILE, SET WORKSPACE.active_profile_id
    DB-->>API: stored profile
    API-->>UI: ScoreProfile (as stored)
    UI->>API: GET /api/repos/{repoId}/health?branch=...
    API->>DB: read stored findings, risk and churn facts
    API->>SS: score(findings, active profile)
    SS-->>API: priorities, file debt, health, grade, trend
    API-->>UI: HealthReport
    UI-->>Dev: re-ordered list, new grade, same findings
```

*Figure 6. Apply-a-profile sequence.* Figure 6 is a write of seven numbers followed by an ordinary read. Comparing it with Figure 5 shows why a profile change costs one round trip while a scan costs minutes.

**Three properties this shape buys.**

1. **The read endpoints stay unparameterised.** The active profile is server-side state belonging to the workspace, so `GET /api/repos/{repoId}/health?branch=…` looks identical before and after a profile change. The API surface does not grow when the profile shape grows, and the scoring formula never leaks into URLs.
2. **The `PUT` is idempotent by construction.** The body is the complete profile, not a change to it, so retrying after a dropped response cannot leave a half-applied profile. That matters because the client immediately fires a dependent read.
3. **The profile is shared, not per-tab.** A reload, a second tab and a second team member all resolve the same active profile, so the profile name shown on the trend chart (SRS FR-14) always refers to something real.

**Clamping is a server-side rule, not a client convenience** (SRS FR-20). The client clamps so the sliders feel right. The server clamps because `repo_health` is calibrated against the constant `k`, and one unclamped weight from any client would make every stored grade incomparable.

## 6.3 The visibility floor

SRS FR-24 requires that a critical security finding stays visible no matter how the profile is set. This is a scoring-engine responsibility, and it is delivered by three mechanisms working together rather than by one check:

1. **Severity is not user-configurable** (§5.2), so a hardcoded secret is permanently `Critical` in the rule register.
2. **Security findings bypass the trust slider** — `source_trust` is fixed at 1.0 for the `security` category, so no trust setting can de-weight them.
3. **`ScoringEngine` pins critical security findings into the visible list** even when the security weight is at its 0.1 minimum, overriding the computed order.

Mechanisms 1 and 2 are structural, so they cannot be forgotten. Mechanism 3 is an explicit step in the engine and must have its own test (SRS TC-24).

---

# 7. Deployment View

```mermaid
flowchart LR
    subgraph Client
        BR["Browser<br/>(Next.js app)"]
    end
    subgraph Cloud["Cloud host (Docker containers)"]
        FEH["Frontend container<br/>Next.js server"]
        APIH["Backend container<br/>FastAPI + ScoringEngine"]
        WRK["Worker container(s)<br/>Celery"]
        RED["Redis<br/>broker"]
        MLH["ML inference<br/>container"]
        PG[("PostgreSQL<br/>(Row-Level Security)")]
    end
    GH["GitHub<br/>(OAuth, REST, git clone)"]
    BR -->|HTTPS| FEH
    BR -->|HTTPS REST| APIH
    APIH --> RED --> WRK
    WRK --> MLH
    APIH --> PG
    WRK --> PG
    WRK -->|git clone over HTTPS| GH
    APIH -->|OAuth and repo metadata| GH
```

*Figure 7. Deployment for v1.0.* In Figure 7 every box inside the cloud boundary is an independently scalable Docker container. The worker containers are the ones that scale horizontally, because concurrent scans are the only load that grows with usage. Each worker needs local disk for the clone it is analysing — around 2 GB per concurrent scan, released when the scan ends (SRS Table 3-20).

| Node | Processes hosted | Connections |
|---|---|---|
| Client device | Browser running the Next.js app | HTTPS to the frontend and the API |
| Frontend container | Next.js server | Serves the app to the browser |
| Backend container | FastAPI API process, `ScoringEngine` | Redis, PostgreSQL, GitHub (OAuth and REST) |
| Worker container(s) | Celery workers, extraction tools | Redis, PostgreSQL, ML container, GitHub (clone) |
| ML container | Model inference, loading versioned artifacts | Called by workers only |
| Redis | Broker | Private network only, never exposed publicly |
| PostgreSQL | Database, RLS enforced | Private network only, TLS |

**TEAM TODO:** confirm the hosting provider (the Feasibility Report cites DigitalOcean) and add the TLS termination and domain nodes to Figure 7.

---

# 8. Implementation View

## 8.1 Overview

The source lives in a **monorepo** with three applications — `apps/web`, `apps/api` and `apps/ml` — organised into three layers: **presentation → application/domain → data**. The shared data contract is the only agreed shape that crosses the frontend/backend boundary.

The layering rule is simple and is enforced in code review: **the presentation layer never reaches the database directly.** Every read goes through the API, and every API read that produces a score goes through `ScoringEngine`.

```mermaid
flowchart TB
    subgraph P["Presentation layer"]
        WEB["apps/web (Next.js): pages, components, hooks, API client"]
    end
    subgraph A["Application / Domain layer"]
        APIA["apps/api (FastAPI): routers, domain services, ScoringEngine"]
        WK["scan orchestration (Celery tasks)"]
        MLA["apps/ml: SATD and risk inference"]
    end
    subgraph D["Data layer"]
        PG[("PostgreSQL: tenants, snapshots, findings, file scores")]
    end
    WEB -->|REST over the shared contract| APIA
    APIA --> WK --> MLA
    APIA --> PG
    WK --> PG
```

*Figure 8. Implementation layers and their components.* Figure 8 shows the dependency direction: it points downward only. No arrow goes from the data layer back up.

## 8.2 Layers

**Presentation — `apps/web`.** App Router pages, kept thin and fetching only through data hooks. Feature components for the dashboard, projects and layout. `shadcn/ui` primitives. One `lib/api` client module through which all HTTP passes. `lib/types`, which is the shared contract. A Mock Service Worker layer used in development and tests only, never in production.

**Application and domain — `apps/api` and `apps/ml`.** REST routers. Domain services for projects, branches, scans and profiles. `ScoringEngine`, a **pure Python function** that takes stored findings, per-file facts and the active profile and returns priorities, file debt, health, grade and the category breakdown. Celery tasks that run the clone → extract → detect → persist pipeline. Model inference for ML-1 and ML-2, plus the deterministic reason-template engine that builds the one-line explanations.

**Data — PostgreSQL.** Tenant-isolated tables with Row-Level Security, and an append-only snapshot store.

**Rules that govern the layers.**

- Volatile third-party libraries sit behind exactly one boundary each, so replacing one is a single-file change: all charts through one chart wrapper, the file tree behind one component, all HTTP through one API client (SRS SP-6).
- Rule thresholds, severity base points and profile weights are configuration or data, never literals in code, so recalibration is a config change and not a release (SRS SP-8).
- Models are trained offline and loaded at runtime as versioned artifacts, so swapping a model needs no application change (SRS SP-14).

**TEAM TODO:** draw the package diagram (Figure 9) showing the internal packages of `apps/api` — `routers`, `services`, `scoring`, `tasks`, `extractors`, `db` — and their dependencies.

*Figure 9. Package diagram of the backend application.* **(to be drawn)**

---

# 9. Data View

```mermaid
erDiagram
    WORKSPACE ||--o{ MEMBERSHIP : has
    USER ||--o{ MEMBERSHIP : in
    WORKSPACE ||--o{ REPO : owns
    REPO ||--o{ BRANCH : has
    REPO ||--o{ SCAN : has
    SCAN ||--o{ FINDING : produces
    SCAN ||--o{ FILE_SCORE : produces
    WORKSPACE ||--o{ SCORE_PROFILE : defines

    WORKSPACE {
        uuid id PK
        text name
        uuid active_profile_id FK
    }
    USER {
        uuid id PK
        text name
        text email
    }
    MEMBERSHIP {
        uuid id PK
        uuid workspace_id FK
        uuid user_id FK
        text role
    }
    REPO {
        uuid id PK
        uuid workspace_id FK
        text name
        text owner
        text visibility
        text url
        text default_branch
        timestamptz connected_at
    }
    BRANCH {
        uuid id PK
        uuid repo_id FK
        text name
        bool is_default
        text last_commit_sha
        timestamptz last_commit_at
    }
    SCAN {
        uuid scan_id PK
        uuid repo_id FK
        text branch
        text commit_sha
        timestamptz scanned_at
        text phase
        int finding_count
        text model_version
    }
    FINDING {
        uuid id PK
        uuid scan_id FK
        text fingerprint
        text source
        text category
        text severity
        text file
        int line
        text symbol
        text reason
        text status
        text rule_id
        numeric metric_value
        numeric threshold
    }
    FILE_SCORE {
        uuid id PK
        uuid scan_id FK
        text file
        numeric risk_score
        numeric churn_factor
    }
    SCORE_PROFILE {
        uuid id PK
        uuid workspace_id FK
        text name
        jsonb weights
        numeric trust_s
        bool is_preset
    }
```

*Figure 10. Multi-tenant data model.* In Figure 10, RLS policies key every tenant-owned table on `workspace_id`. `SCAN` rows are append-only, so trend, history and delta are all queries over existing rows rather than updates to them. Every table here must match the shared data contract.

**The schema stores facts, not scores.** This is the most important rule in the data view (SRS FR-21, SP-7).

`FINDING` keeps the evidence — where the issue is, what triggered it, the measured value and the threshold it crossed. `FILE_SCORE` keeps the two per-file inputs: `risk_score` from ML-2 and `churn_factor` computed from the commit-anchored window. All of these are properties of the code at that commit, so they are facts and they are stored.

**Priority, file debt, health score, grade, delta and the category breakdown are not columns.** They are functions of the active profile, so they are computed on every read by `ScoringEngine` and are never written to the database. Without this rule, an editable profile would leave every stored score stale the moment a slider moved, or would force an update that breaks the append-only property the trend chart depends on.

**Scoring is computed in Python, not in SQL.** The database returns rows; `ScoringEngine` turns them into scores. This is a deliberate decision, recorded here so it is not quietly reversed later. The reasons are:

- The scoring formula in SRS FR-11 has five factors, bounded ranges and a visibility-floor override. Expressed in SQL it becomes hard to read and harder to change.
- SRS SP-11 requires the detection and scoring path to be deterministic and exactly testable. A Python function can be unit-tested against the worked-example fixture in SRS TC-11 with no database at all.
- SRS SP-8 requires thresholds, base points and weights to live in configuration. A Python function reads that configuration naturally; a SQL view would embed the numbers in schema objects and turn recalibration into a migration.

**A cache is not a source of truth, and the difference is the line this schema must not cross.**

Deriving scores on every read raises an obvious question: is the system recomputing the same answer over and over? It may be, and caching that answer is allowed. What matters is *what kind of thing* gets stored.

Because scoring is a pure function over immutable snapshot facts, the same inputs always produce the same output. That single property makes caching safe with no invalidation logic at all — there is nothing to check, because a stale answer is impossible. The cache key is simply the two things the output depends on:

```
cache_key = (scan_id, profile_fingerprint)

  scan_id             identifies the immutable snapshot
  profile_fingerprint hash of the six weights and trust_s
```

**The key is the inputs, never the session.** A session-keyed cache would put derived state in server memory, which SRS FR-1 and FR-21 both forbid, and would make two browser tabs or two teammates compute the same result twice. Keying on the inputs means every tab, every user and every reload share one entry automatically.

The rule that keeps this honest:

> A cached value may be deleted at any moment without losing information, because it can be rebuilt from stored facts. The moment a derived value would be *missed* if deleted, it has stopped being a cache and has become a second source of truth — and that is what SRS FR-21 forbids.

Two things follow from this, and both are permitted:

- **Response caching** — an ETag or a Redis entry holding a computed `HealthReport`. Pure derivation, discardable, rebuildable. The mechanisms are described in §10.
- **Per-group aggregates** — two sums per `(category, source)` group per scan. These contain no weights and no profile values, only stored severity, churn and risk, so they are *facts* in exactly the same sense that `churn_factor` is a fact. Storing them is not storing a score. The arithmetic is in §10.

What remains forbidden is unchanged: `priority`, `debt_score`, `health_score`, `grade`, `delta` and the category breakdown are never columns, because each of them is a function of a profile the user can change at any time.

**Two columns deserve a note.**

`FINDING.severity` and `FINDING.category` are written once at detection and never updated, so a stored finding always renders and ranks the same way (SRS FR-8.1). `FINDING.source` is constrained to `rule` or `satd` (SRS FR-8.2). `SCORE_PROFILE.weights` is a JSON object keyed by the **six** category values (SRS FR-9.3), and `trust_s` is the scalar that replaced the old `w_ml` weight.

**The active profile belongs to the workspace, not to the session.** `WORKSPACE.active_profile_id` is a nullable foreign key to `SCORE_PROFILE`, and it is the only thing `PUT /api/profiles/active` moves besides the weights themselves. Holding it on `WORKSPACE` rather than as an `is_active` flag on `SCORE_PROFILE` makes "exactly one active profile per workspace" a structural guarantee instead of a constraint somebody has to remember to enforce. It also means the read path resolves the active profile through a join it is already making for RLS.

**Not in the v1.0 schema.** There is no `SUPPRESSION` table and no finding-action history, because v1.0 is view-only (SRS FR-17b). `FINDING.status` exists and every v1.0 finding is `open`, which is what SRS FR-11 means by "the sum of open finding priorities". Accept-debt, resolve and false-positive actions arrive in v1.1 and will add rows, not change these ones. There is also no webhook-event table and no role or permission tables beyond `MEMBERSHIP.role`, since neither event-driven scanning nor RBAC is in v1.0.

**TEAM TODO:** finalise the column types, the indexes — at minimum on `(repo_id, branch, scanned_at)` for the trend query and on `(scan_id, category)` for the breakdown — and write out the exact RLS policies.

---

# 10. Size and Performance

**What the system is sized for.** SRS PERF-06 sets the v1.0 baseline at **50 single-user workspaces, so 50 registered users**, while still meeting the interactive response times in SRS Table 3.41. This follows from SRS FR-2: in v1.0 a workspace has exactly one active user, and multi-user workspaces arrive in v2. The tenant column is in the schema from day one (§9), so raising this baseline later is a capacity question rather than a migration.

SRS PERF-07 sets the concurrency baseline separately: **at least three repository analyses running at once**, with further requests queued rather than blocking the interface. That requirement, not the user count, is what sizes the worker fleet — three concurrent scans at ~2 GB of clone disk each is the figure to provision against.

**How the architecture meets it.**

- **Analysis never blocks the API.** Scans run on Celery workers, so an expensive repository does not slow anybody else's dashboard (SRS PERF-05, PERF-08).
- **Reads are cheap.** A dashboard read is a database query over one stored snapshot plus an in-memory scoring pass. A profile change or a drill-in re-scores from rows already stored — no scan, no clone, no model call (SRS FR-20).
- **Workers scale horizontally.** Concurrent scan capacity is the number of worker containers, and each needs about 2 GB of local disk while it runs.
- **GitHub rate limits are avoided rather than managed.** The pipeline reads the repository through `git clone`, which uses no REST quota. The only REST calls are for repository and branch metadata, and they use ETag-based conditional requests.

| Characteristic | Target | Source |
|---|---|---|
| Registered users at baseline | 50 (50 single-user workspaces) | SRS PERF-06 |
| Concurrent analyses | At least 3, further requests queued | SRS PERF-07 |
| Interaction feedback | Visible within 0.1 s | SRS PERF-01 |
| Non-analysis interactions | Complete within 1 s | SRS PERF-02 |
| Scan enqueue | Within 1 s of the user clicking Scan | SRS PERF-03 |
| Progress reporting | For any operation over 10 s | SRS PERF-04 |
| Scan progress polling | Once per second | SRS Table 3.97 (Communications interfaces) |
| Worker disk | ~2 GB per concurrent scan, released on completion | SRS Table 3-20 |

## 10.1 What a dashboard read actually costs

Deriving every score on read invites the question of whether the system is doing too much work per request. The operation count answers it.

Per finding the formula is four multiplications and three lookups. The findings are then grouped and summed by file, and repo health is one division. So the work is linear in the number of findings in one snapshot.

| Repo size | Findings, realistically | Scoring in Python |
|---|---|---|
| Typical target repo (~50 KLOC) | 500 – 1,000 | about 1 ms |
| Large repo | 5,000 | about 5 ms |
| Pessimistic upper bound | 10,000 | 10 – 50 ms |

The middle column follows from the project's own figures: 6.54% of the 62,275 labelled comments are debt at all (SRS FR-9.3 and the reader's note in SRS §4), and rule findings land on a small percentage of functions. A 50 KLOC repository produces several hundred findings, not tens of thousands.

**The important consequence:** reading 10,000 rows out of PostgreSQL and deserialising them costs roughly 20–80 ms, which is *more* than the arithmetic performed on them. The database read dominates, so optimising the multiplication would be optimising the wrong half. Against the one-second budget in SRS PERF-02, scoring uses a few percent.

*These are order-of-magnitude estimates derived from operation counts, not measurements. They are among the numbers the team must measure.*

## 10.2 The trend chart is the one real cost

SRS FR-14 redraws every point of the trend under the active profile. Fifty snapshots of a thousand findings means **fifty thousand findings read** for one chart — again, the reading is what hurts.

The fix is exact rather than approximate, and it falls out of the formula:

```
priority = base × cat_weight × src_trust × churn × (1 + ml_trust × risk)
         = cat_weight × src_trust × [ (base × churn) + ml_trust × (base × churn × risk) ]
                                        └──── A ────┘             └────── B ──────┘
```

Within one `(category, source)` group, `cat_weight` and `src_trust` are constant, and neither `A` nor `B` contains any profile value — only stored severity, stored churn and stored risk. So storing two sums per group per scan reproduces the total exactly under **any** profile:

```
6 categories × 2 sources = 12 groups × 2 sums = 24 numbers per snapshot

total = Σ over groups [ cat_weight[g] × src_trust[g] × (A_g + ml_trust × B_g) ]
```

A fifty-point trend becomes 1,200 multiply-adds instead of fifty thousand row reads. As §9 explains, `A` and `B` are facts rather than scores, so storing them does not conflict with SRS FR-21.

## 10.3 Caching, cheapest measure first

| Stage | Measure | When to build it |
|---|---|---|
| 0 | Pure Python scoring on every read | **v1.0 baseline** — ships as described |
| 1 | ETag and `304 Not Modified` on the health endpoint | **v1.0** — cheap, stateless, removes the cost of a refresh |
| 2 | Redis entry keyed on `(scan_id, profile_fingerprint)` | Only if measurement shows it is needed |
| 3 | Per-group aggregates for the trend | When the trend becomes slow, which it will do first |

**Stage 1 is worth building in v1.0 because it costs almost nothing.** The server computes `ETag = hash(scan_id + profile_fingerprint)` from two small lookups, without reading a single finding. A browser sends `If-None-Match` automatically on refresh, so when neither the snapshot nor the profile has changed the server replies `304 Not Modified` with an empty body: no findings read, no scoring performed, no payload sent. It needs no new infrastructure and adds no server-side state.

**Stage 2** reuses the Redis instance already present for Celery. On an ETag miss, a hit here means a result another user or tab already computed is reused rather than recalculated.

All four stages remain consistent with SRS FR-21 and SP-7, because every one of them stores something rebuildable from the snapshot facts.

**TEAM TODO:** measure and record four numbers before the final submission — scan time per KLOC, maximum concurrent scans per worker, p95 dashboard read latency, and database size per snapshot. These are the numbers that will be asked about, and they cannot be guessed.

---

# 11. Quality

| Attribute | How the architecture delivers it |
|---|---|
| **Security and privacy** | Read-only repository access; only repositories the user connects; HTTPS everywhere; secrets held server-side and never sent to the client; PostgreSQL Row-Level Security for tenant isolation (SRS SEC-03, SEC-05, DBR-3). |
| **Reliability** | Snapshots are immutable, so a failed scan can never damage the last good one. A snapshot is written only after every stage succeeds (SRS REL-05). The rule engine is deterministic. If the ML service is down, the scan still completes with rule findings only — degraded, but valid. |
| **Scalability** | Stateless API and workers, independently scalable containers, queue-based load absorption. Pending work queues rather than blocking the interface (SRS PERF-09). |
| **Maintainability and extensibility** | One shared contract; a layered monorepo; volatile libraries behind single boundaries; models as swappable artifacts; scoring as a pure function. Adding a rule is one threshold entry plus one message template; adding a detector is a new `source` value (SRS SP-17). |
| **Usability** | Ranked, low-noise output; a one-line reason on every finding; a health score and grade a non-technical reader can interpret; finding detail rendered **in place** so the file tree stays visible and triage does not mean opening and closing a panel per finding (SRS FR-17). |
| **Portability** | Extraction and scoring are language-agnostic; deployment is containerised; a new language needs a rule pack and recalibration, not an engine change. |
| **Testability** | The frontend runs fully against mock handlers, the same ones used in development, unit tests and end-to-end tests (SRS SP-10). Detection is deterministic, so regression tests are exact rather than statistical (SRS SP-11). Scoring is a pure function, so it is tested against fixtures with no database. Model quality is reported as precision, recall, F1 and AUC against a rule baseline (SRS FR-25). |
| **Traceability and diagnosability** | Every log line across the API, broker, workers and ML service carries the same scan identifier, so one scan is traceable end to end (SRS SP-12). Every scan's final phase and error are stored in the database, so a user-reported failure is diagnosable without reading logs (SRS SP-13). Every snapshot records its `model_version`, so trend points stay comparable after re-training (SRS SP-15). |

---

# 12. References

References follow IEEE style. Tools are cited by their official web page with an accessed date, matching SRS §1.4 and Appendix D.

The document-level references are listed in §1.4 above. The tool and library references — Lizard, PyDriller, Tree-sitter, scikit-learn, FastAPI, Redis, Celery, PostgreSQL, Next.js and Tailwind CSS — are given in SRS §1.4 [1]–[10] and are not repeated here.

**TEAM TODO:** add the diagram tool reference once the final figures are drawn.

---

*End of SAD v0.7 draft. Section 6 is complete. Redraw the remaining figures per the template's figure rules, draw Figure 9, add the UC-4 and UC-5 scenario tables, and fill in the four measured performance numbers before promoting this to v1.0.*
