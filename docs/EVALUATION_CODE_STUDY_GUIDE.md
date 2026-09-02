# CodeSage-AI Code Evaluation Study Guide

> Generated from the working tree on 2026-08-28. Line numbers refer to the code as it exists on that date and may move after edits.

## 1. Thirty-second project explanation

CodeSage-AI is an AI-assisted technical-debt analysis platform for Java repositories. A user signs in, connects a public GitHub repository, selects a branch, and starts an asynchronous scan. The worker clones the exact commit, extracts static and historical metrics, detects deterministic and ML-assisted findings, stores an immutable snapshot, and computes a configurable health score. The Next.js dashboard then shows repository health, file-level debt, trends, and prioritized refactoring recommendations.

## 2. System architecture

```text
Browser / Next.js
        |
        | HTTP + opaque session cookie
        v
FastAPI API --------------------> PostgreSQL
        |
        | enqueue jobs
        v
      Redis <-------------------- Celery workers
                                      |
                                      | private HTTP
                                      v
                               ML inference service
```

The project is best described as a **modular monolith with asynchronous workers and one extracted inference service**, not as a collection of independent domain microservices.

### Deployment services

| Service | Purpose | Code/config reference |
|---|---|---|
| `postgres` | Persistent relational data and Row-Level Security | `infra/docker-compose.yml:10` |
| `redis` | Celery broker, progress, and cancellation signals | `infra/docker-compose.yml:30` |
| `ml` | Stateless SATD and bug-risk inference | `infra/docker-compose.yml:42` |
| `migrate` | Runs Alembic migrations before the app starts | `infra/docker-compose.yml:59` |
| `api` | FastAPI HTTP process | `infra/docker-compose.yml:70` |
| `worker` | Scan queue consumer | `infra/docker-compose.yml:118` |
| `score-worker` | Score-cache queue consumer | `infra/docker-compose.yml:155` |
| `web` | Next.js frontend | `infra/docker-compose.yml:179` |

Important point: `api`, `worker`, and `score-worker` use the same backend image with different startup commands.

## 3. Repository map

| Directory | Responsibility |
|---|---|
| `apps/web/` | Next.js frontend, hooks, UI components, MSW mocks, Vitest and Playwright tests |
| `apps/api/` | FastAPI, authentication, database, extraction, detection, scoring, Celery tasks |
| `apps/ml/` | Inference API, model loading, feature contracts, and offline training |
| `infra/` | Docker Compose and PostgreSQL initialization |
| `docs/api/` | OpenAPI contract used to generate frontend types |
| `docs/Deliverables/` | SRS, SAD and project documents |

## 4. Backend application startup

Start at `apps/api/src/codesage_api/main.py`.

| What to study | Reference | Explanation |
|---|---|---|
| Application lifespan | `apps/api/src/codesage_api/main.py:17` | Configures startup/shutdown behaviour |
| FastAPI factory | `apps/api/src/codesage_api/main.py:23` | Creates and configures the app |
| Public routes | `apps/api/src/codesage_api/main.py:56` | Authentication callback and liveness do not require a session |
| Protected routes | `apps/api/src/codesage_api/main.py:57` | All routes in this group use `get_current_user_id` |
| Operational routes | `apps/api/src/codesage_api/main.py:58` | Readiness/version-style endpoints |
| Router composition | `apps/api/src/codesage_api/routers/__init__.py:13` | Shows public routers |
| Protected router composition | `apps/api/src/codesage_api/routers/__init__.py:20` | Shows authenticated routers |
| Settings model | `apps/api/src/codesage_api/config.py:13` | Environment-driven configuration |
| Exception handlers | `apps/api/src/codesage_api/errors.py:157` | Converts domain errors into stable API envelopes |

Backend layer direction:

```text
routers -> services -> repositories/models
```

Celery tasks call extraction, detection, and persistence code. The pure scoring package is deliberately isolated from FastAPI, Celery, SQLAlchemy, and HTTP.

## 5. Authentication and tenant isolation

### Authentication flow

1. The browser navigates to the sign-in endpoint.
2. The API generates state, PKCE values, and a signed short-lived handshake cookie.
3. Asgardeo performs authentication and redirects to the callback.
4. The API validates the callback and exchanges the authorization code server-side.
5. The API provisions/loads the user and stores a server-side session.
6. The browser receives only an opaque HTTP-only session cookie.

| Concern | Reference |
|---|---|
| Start OIDC sign-in | `apps/api/src/codesage_api/routers/auth.py:44` |
| Complete callback | `apps/api/src/codesage_api/routers/auth.py:94` |
| Current-session endpoint | `apps/api/src/codesage_api/routers/auth.py:165` |
| Sign out | `apps/api/src/codesage_api/routers/auth.py:226` |
| Authorization-code exchange | `apps/api/src/codesage_api/services/auth.py:72` |
| Establish server-side session | `apps/api/src/codesage_api/services/auth.py:139` |
| Provision a new user | `apps/api/src/codesage_api/services/auth.py:166` |
| Resolve user's workspace | `apps/api/src/codesage_api/services/auth.py:221` |
| Validate session cookie | `apps/api/src/codesage_api/services/auth.py:241` |
| Revoke/end session | `apps/api/src/codesage_api/services/auth.py:277` |
| FastAPI authentication dependency | `apps/api/src/codesage_api/deps.py:24` |
| Workspace dependency | `apps/api/src/codesage_api/deps.py:55` |
| Tenant-aware DB dependency | `apps/api/src/codesage_api/deps.py:67` |
| Set PostgreSQL RLS context | `apps/api/src/codesage_api/db/rls.py:9` |
| Frontend route middleware | `apps/web/src/middleware.ts:10` |
| Frontend login page | `apps/web/src/app/(auth)/login/page.tsx:3` |

### Why the session cookie is opaque

Tokens remain on the backend. The cookie only identifies a server-side session row, so logout can revoke the session immediately and browser JavaScript cannot read identity tokens.

### Why there are two database roles

The migration role owns the schema. The runtime application role does not own tables, which is necessary for PostgreSQL Row-Level Security policies to apply correctly.

## 6. Connecting and browsing repositories

| Action | HTTP router | Service/integration |
|---|---|---|
| List projects | `apps/api/src/codesage_api/routers/projects.py:18` | `apps/api/src/codesage_api/services/repositories.py:88` |
| Connect repository | `apps/api/src/codesage_api/routers/projects.py:33` | `apps/api/src/codesage_api/services/repositories.py:34` |
| List branches | `apps/api/src/codesage_api/routers/branches.py:18` | `apps/api/src/codesage_api/services/repositories.py:156` |
| Parse GitHub URL | — | `apps/api/src/codesage_api/integrations/github.py:36` |
| Fetch repository metadata | — | `apps/api/src/codesage_api/integrations/github.py:56` |
| Fetch branches | — | `apps/api/src/codesage_api/integrations/github.py:132` |
| Fetch one branch/SHA | — | `apps/api/src/codesage_api/integrations/github.py:198` |

Version 1 supports public GitHub repositories. Private-repository authorization is not part of this implementation.

## 7. Complete scan lifecycle

This is the most important section for the evaluation.

### 7.1 HTTP layer

| Endpoint behaviour | Reference |
|---|---|
| Start a scan | `apps/api/src/codesage_api/routers/scans.py:20` |
| Poll scan status | `apps/api/src/codesage_api/routers/scans.py:39` |
| Request cancellation | `apps/api/src/codesage_api/routers/scans.py:61` |
| List scan history | `apps/api/src/codesage_api/routers/scans.py:87` |

### 7.2 Analysis orchestration service

| Function | Reference | Responsibility |
|---|---|---|
| `_status_out` | `apps/api/src/codesage_api/services/analysis.py:25` | Converts DB status plus Redis progress to API output |
| `start` | `apps/api/src/codesage_api/services/analysis.py:59` | Validates branch, creates attempt, queues worker job |
| `get_status` | `apps/api/src/codesage_api/services/analysis.py:113` | Loads one attempt and returns current state |
| `get_history` | `apps/api/src/codesage_api/services/analysis.py:133` | Returns repository scan history |
| `cancel` | `apps/api/src/codesage_api/services/analysis.py:147` | Records a cooperative cancellation request |

### 7.3 Worker pipeline

The pipeline is:

```text
clone -> extract -> detect -> finalize -> enqueue score warm-up
```

| Stage | Reference | What happens |
|---|---|---|
| Celery task entry | `apps/api/src/codesage_api/tasks/scan_pipeline.py:73` | Runs the complete scan and handles terminal states |
| Clone repository | `apps/api/src/codesage_api/tasks/repository_clone.py:47` | Clones the exact commit into isolated scratch space |
| Extract facts | `apps/api/src/codesage_api/extractors/pipeline.py:34` | Coordinates CK, PyDriller, and comment extraction |
| Detect findings | `apps/api/src/codesage_api/detection/rules/engine.py:162` | Combines file, method, and security-pattern findings |
| Atomic finalization | `apps/api/src/codesage_api/tasks/scan_pipeline.py:191` | Stores a complete snapshot in one transaction |
| Error/cancel terminal state | `apps/api/src/codesage_api/tasks/scan_pipeline.py:438` | Marks an attempt cancelled or failed |
| Cleanup | `apps/api/src/codesage_api/tasks/cancel.py:46` | Clears Redis state and removes clone data |

### 7.4 Progress and cancellation

| Behaviour | Reference |
|---|---|
| Publish progress | `apps/api/src/codesage_api/tasks/progress.py:44` |
| Read progress | `apps/api/src/codesage_api/tasks/progress.py:57` |
| Set cancellation flag | `apps/api/src/codesage_api/tasks/progress.py:67` |
| Read cancellation flag | `apps/api/src/codesage_api/tasks/progress.py:76` |
| Clear temporary state | `apps/api/src/codesage_api/tasks/progress.py:84` |
| Raise cooperative cancellation | `apps/api/src/codesage_api/tasks/cancel.py:37` |

Cancellation is cooperative: the worker checks between expensive stages. The API can acknowledge the request before the worker reaches the final `cancelled` state.

### 7.5 Atomic finalization

`_finalize` at `apps/api/src/codesage_api/tasks/scan_pipeline.py:191` creates:

- A `Snapshot`
- `SourceFile` rows
- Static and process metrics
- Bug-risk predictions
- Rule findings
- SATD predictions and findings
- Model-version provenance links
- The final `done` status

Because this happens inside one session transaction, a failure should roll back the entire snapshot instead of publishing partial analysis results.

## 8. Extraction subsystem

### Extractor coordinator

| Symbol | Reference |
|---|---|
| `ExtractionResult` | `apps/api/src/codesage_api/extractors/pipeline.py:16` |
| Repository comment traversal | `apps/api/src/codesage_api/extractors/pipeline.py:23` |
| Combined extraction | `apps/api/src/codesage_api/extractors/pipeline.py:34` |

### CK static metrics

| Symbol | Reference |
|---|---|
| Per-file metrics | `apps/api/src/codesage_api/extractors/ck_metrics.py:14` |
| Per-method metrics | `apps/api/src/codesage_api/extractors/ck_metrics.py:29` |
| Run and parse CK | `apps/api/src/codesage_api/extractors/ck_metrics.py:69` |

CK provides Java metrics such as LOC, cyclomatic complexity, nesting depth, method count, and longest-method length. This dependency is the main reason version 1 analyses Java only.

### Process metrics

| Symbol | Reference |
|---|---|
| Stored process facts | `apps/api/src/codesage_api/extractors/process_metrics.py:16` |
| Extract history metrics | `apps/api/src/codesage_api/extractors/process_metrics.py:40` |

PyDriller derives values such as recent commits, author count, file age, and recency from Git history.

### Comment extraction

| Symbol | Reference |
|---|---|
| Comment value object | `apps/api/src/codesage_api/extractors/comments.py:13` |
| Filter license headers | `apps/api/src/codesage_api/extractors/comments.py:30` |
| Generic entry point | `apps/api/src/codesage_api/extractors/comments.py:46` |
| Java Tree-sitter extraction | `apps/api/src/codesage_api/extractors/comments.py:52` |

Comments are transient ML inputs. Debt-positive comments become persisted SATD findings.

## 9. Deterministic detection

| Detection area | Reference |
|---|---|
| Finding value object | `apps/api/src/codesage_api/detection/rules/engine.py:19` |
| File-level metric rules | `apps/api/src/codesage_api/detection/rules/engine.py:45` |
| Method-level metric rules | `apps/api/src/codesage_api/detection/rules/engine.py:87` |
| Security-pattern rules | `apps/api/src/codesage_api/detection/rules/engine.py:125` |
| Combined detector | `apps/api/src/codesage_api/detection/rules/engine.py:162` |
| Convert stored rule to domain rule | `apps/api/src/codesage_api/detection/rules/registry.py:16` |
| Rule fingerprint | `apps/api/src/codesage_api/detection/fingerprint.py:8` |
| SATD fingerprint | `apps/api/src/codesage_api/detection/fingerprint.py:12` |
| Hardcoded-secret detector | `apps/api/src/codesage_api/detection/rules/security_rules.py:80` |
| SQL-concatenation detector | `apps/api/src/codesage_api/detection/rules/security_rules.py:136` |

Current rule families:

- Large file
- Complex function
- Long method
- Deep nesting
- Hardcoded secret
- SQL string concatenation

Fingerprints provide deterministic identity across scans and stable ordering when priorities are equal.

## 10. ML inference

The ML application entry point is `apps/ml/src/codesage_ml/main.py`.

| Endpoint/function | Reference | Purpose |
|---|---|---|
| SATD classification | `apps/ml/src/codesage_ml/main.py:35` | Classifies source comments |
| Bug-risk inference | `apps/ml/src/codesage_ml/main.py:80` | Produces per-file risk scores |
| Model versions | `apps/ml/src/codesage_ml/main.py:115` | Reports loaded artifact versions |
| Liveness | `apps/ml/src/codesage_ml/main.py:132` | Reports process availability |
| Load SATD model | `apps/ml/src/codesage_ml/registry.py:79` | Loads versioned SATD artifact/fallback |
| Load risk model | `apps/ml/src/codesage_ml/registry.py:105` | Loads versioned risk artifact/fallback |
| Canonical risk vector | `apps/ml/src/codesage_ml/risk/features.py:41` | Preserves training/inference feature order |
| Map dataset label | `apps/ml/src/codesage_ml/satd/labels.py:42` | Maps dataset classes to domain categories |

### ML-1: SATD

- Input: extracted source-code comments.
- Output: debt/non-debt, debt category, confidence, and model version.
- Categories: code/design, requirements, documentation, and testing.
- It does **not** predict severity.
- Severity is assigned by deterministic markers at `apps/api/src/codesage_api/detection/satd/severity_markers.py:66`.

### ML-2: bug risk

- Input: static and historical per-file metrics.
- Output: continuous risk score from 0 to 1 and model version.
- It changes prioritization through the scoring risk factor.
- It does not directly create a finding or assign a category/severity.

### Graceful degradation

The worker catches ML-service failures in `apps/api/src/codesage_api/tasks/scan_pipeline.py:73`. It continues with rule-based findings, empty SATD results, and no ML-2 risk result. This makes an ML outage a loss of analysis richness rather than a complete scan outage.

## 11. Scoring system

### Core data types

| Type | Reference |
|---|---|
| Input finding | `apps/api/src/codesage_api/scoring/models.py:22` |
| Per-file facts | `apps/api/src/codesage_api/scoring/models.py:38` |
| User profile | `apps/api/src/codesage_api/scoring/models.py:46` |
| Scored finding | `apps/api/src/codesage_api/scoring/models.py:52` |
| Scored file | `apps/api/src/codesage_api/scoring/models.py:59` |
| Complete scoring result | `apps/api/src/codesage_api/scoring/models.py:74` |
| Categories/severity/source | `apps/api/src/codesage_api/scoring/enums.py:20` |

### Formula functions

| Formula | Reference |
|---|---|
| Severity base points | `apps/api/src/codesage_api/scoring/formula.py:31` |
| Churn factor | `apps/api/src/codesage_api/scoring/formula.py:42` |
| Risk factor | `apps/api/src/codesage_api/scoring/formula.py:56` |
| Rule source trust | `apps/api/src/codesage_api/scoring/formula.py:78` |
| ML source trust | `apps/api/src/codesage_api/scoring/formula.py:83` |
| Choose source trust | `apps/api/src/codesage_api/scoring/formula.py:88` |
| Finding priority | `apps/api/src/codesage_api/scoring/formula.py:106` |
| Repository health | `apps/api/src/codesage_api/scoring/formula.py:117` |
| Letter grade | `apps/api/src/codesage_api/scoring/formula.py:131` |
| Clamp profile values | `apps/api/src/codesage_api/scoring/formula.py:139` |

Conceptual formula:

```text
finding priority =
    base points
    * category weight
    * source trust
    * churn factor
    * risk factor

file debt = sum(priority of findings in the file)

repository health =
    100 * (1 - min(1, total debt / (k * KLOC)))
```

### Scoring orchestration

| Function | Reference |
|---|---|
| Score snapshot facts | `apps/api/src/codesage_api/scoring/engine.py:16` |
| Aggregate directory/subtree debt | `apps/api/src/codesage_api/scoring/engine.py:111` |
| Visibility-floor decision | `apps/api/src/codesage_api/scoring/floor.py:30` |
| Apply visibility floor | `apps/api/src/codesage_api/scoring/floor.py:38` |
| Load scoring configuration | `apps/api/src/codesage_api/scoring/config_loader.py:40` |
| Load presets | `apps/api/src/codesage_api/scoring/config_loader.py:59` |

The scoring module is a functional core: it accepts plain domain values and returns a result without using FastAPI, SQLAlchemy, Celery, Redis, or HTTP.

### Score cache

Facts and findings remain the source of truth. Derived results can be cached for a snapshot/profile combination.

| Cache behaviour | Reference |
|---|---|
| Profile fingerprint | `apps/api/src/codesage_api/scoring/cache.py:13` |
| Score one snapshot | `apps/api/src/codesage_api/tasks/score_cache.py:24` |
| Warm workspace scores | `apps/api/src/codesage_api/tasks/score_cache.py:62` |
| Warm one snapshot | `apps/api/src/codesage_api/tasks/score_cache.py:92` |
| Cached score model | `apps/api/src/codesage_api/db/models/score.py:24` |

Changing the active profile changes its fingerprint, so an old cache entry cannot be mistaken for the new profile's score.

## 12. Dashboard read path

| Behaviour | Reference |
|---|---|
| Health HTTP endpoint | `apps/api/src/codesage_api/routers/health.py:16` |
| Prepare score inputs | `apps/api/src/codesage_api/services/dashboard.py:53` |
| Calculate score | `apps/api/src/codesage_api/services/dashboard.py:86` |
| Lightweight latest-health hint | `apps/api/src/codesage_api/services/dashboard.py:106` |
| Transform DB snapshot to scoring model | `apps/api/src/codesage_api/services/dashboard.py:146` |
| Build finding API outputs | `apps/api/src/codesage_api/services/dashboard.py:186` |
| Build file tree | `apps/api/src/codesage_api/services/dashboard.py:215` |
| Build cached result payload | `apps/api/src/codesage_api/services/dashboard.py:290` |
| Enqueue pending score | `apps/api/src/codesage_api/services/dashboard.py:321` |
| Enqueue missing trend scores | `apps/api/src/codesage_api/services/dashboard.py:342` |
| Build complete health report | `apps/api/src/codesage_api/services/dashboard.py:367` |
| Build trend | `apps/api/src/codesage_api/services/dashboard.py:459` |
| Build scan history | `apps/api/src/codesage_api/services/dashboard.py:493` |

The dashboard read path combines stored facts, the active profile, cached scoring results, provenance, tree structure, and scan history into the `HealthReport` response.

## 13. Scoring profiles

| Behaviour | Reference |
|---|---|
| List presets endpoint | `apps/api/src/codesage_api/routers/profiles.py:21` |
| Read active profile endpoint | `apps/api/src/codesage_api/routers/profiles.py:30` |
| Apply active profile endpoint | `apps/api/src/codesage_api/routers/profiles.py:43` |
| Load active profile domain object | `apps/api/src/codesage_api/services/profiles.py:78` |
| List available profiles | `apps/api/src/codesage_api/services/profiles.py:95` |
| Validate and apply profile | `apps/api/src/codesage_api/services/profiles.py:122` |
| Stored profile model | `apps/api/src/codesage_api/db/models/profile.py:32` |

Applying a profile changes weighting, not stored scan facts. Existing snapshots can therefore be rescored without cloning and scanning again.

## 14. Database model map

### Tenancy and authentication

| Model | Reference |
|---|---|
| User | `apps/api/src/codesage_api/db/models/tenancy.py:22` |
| Workspace | `apps/api/src/codesage_api/db/models/tenancy.py:54` |
| Membership | `apps/api/src/codesage_api/db/models/tenancy.py:65` |
| Security audit record | `apps/api/src/codesage_api/db/models/tenancy.py:79` |
| User session | `apps/api/src/codesage_api/db/models/tenancy.py:92` |

### Repository and analysis

| Model | Reference |
|---|---|
| Repository | `apps/api/src/codesage_api/db/models/repository.py:27` |
| Branch | `apps/api/src/codesage_api/db/models/repository.py:44` |
| Analysis attempt | `apps/api/src/codesage_api/db/models/analysis.py:23` |
| Immutable snapshot | `apps/api/src/codesage_api/db/models/analysis.py:53` |

An `AnalysisAttempt` represents execution state: queued, running, done, error, or cancelled. A `Snapshot` exists only for a successfully finalized analysis result.

### Source facts

| Model | Reference |
|---|---|
| Source file | `apps/api/src/codesage_api/db/models/source.py:30` |
| Code symbol | `apps/api/src/codesage_api/db/models/source.py:45` |
| Source location | `apps/api/src/codesage_api/db/models/source.py:55` |
| Static metric | `apps/api/src/codesage_api/db/models/source.py:73` |
| Process metric | `apps/api/src/codesage_api/db/models/source.py:83` |
| File-tree node | `apps/api/src/codesage_api/db/models/source.py:94` |

### Findings and ML provenance

| Model | Reference |
|---|---|
| Debt category | `apps/api/src/codesage_api/db/models/finding.py:22` |
| Finding | `apps/api/src/codesage_api/db/models/finding.py:31` |
| ML model version | `apps/api/src/codesage_api/db/models/ml.py:25` |
| SATD prediction | `apps/api/src/codesage_api/db/models/ml.py:39` |
| Bug-risk prediction | `apps/api/src/codesage_api/db/models/ml.py:57` |
| Analysis-engine version | `apps/api/src/codesage_api/db/models/provenance.py:18` |
| Engine/model link | `apps/api/src/codesage_api/db/models/provenance.py:31` |

Provenance is important because scores from different model or extraction versions may not be directly comparable.

### Rules and scoring

| Model | Reference |
|---|---|
| Rule definition | `apps/api/src/codesage_api/db/models/rules.py:19` |
| SATD marker pattern | `apps/api/src/codesage_api/db/models/rules.py:30` |
| Scoring preset | `apps/api/src/codesage_api/db/models/profile.py:21` |
| Active/stored scoring profile | `apps/api/src/codesage_api/db/models/profile.py:32` |
| Cached snapshot score | `apps/api/src/codesage_api/db/models/score.py:24` |

## 15. Frontend architecture

The typical frontend dependency flow is:

```text
Next.js route -> feature component -> custom hook -> API client -> FastAPI
```

### Routes

| Screen | Reference |
|---|---|
| Root redirect/entry | `apps/web/src/app/page.tsx:3` |
| Root layout | `apps/web/src/app/layout.tsx:30` |
| Authenticated layout | `apps/web/src/app/(app)/layout.tsx:9` |
| Login | `apps/web/src/app/(auth)/login/page.tsx:3` |
| Projects | `apps/web/src/app/(app)/projects/page.tsx:27` |
| Dashboard | `apps/web/src/app/(app)/dashboard/[repoId]/page.tsx:6` |
| Scan history | `apps/web/src/app/(app)/dashboard/[repoId]/history/page.tsx:3` |
| Profiles | `apps/web/src/app/(app)/profiles/page.tsx:66` |

### API client

| Call | Reference |
|---|---|
| Structured API error | `apps/web/src/lib/api/client.ts:39` |
| Get current session | `apps/web/src/lib/api/client.ts:83` |
| Connect repository | `apps/web/src/lib/api/client.ts:96` |
| List projects | `apps/web/src/lib/api/client.ts:106` |
| List branches | `apps/web/src/lib/api/client.ts:112` |
| Get health report | `apps/web/src/lib/api/client.ts:118` |
| Get scan history | `apps/web/src/lib/api/client.ts:128` |
| Get active profile | `apps/web/src/lib/api/client.ts:135` |
| Apply profile | `apps/web/src/lib/api/client.ts:146` |
| List profiles | `apps/web/src/lib/api/client.ts:155` |
| Start scan | `apps/web/src/lib/api/client.ts:163` |
| Poll scan status | `apps/web/src/lib/api/client.ts:172` |
| Stop scan | `apps/web/src/lib/api/client.ts:181` |

Every API request uses `credentials: "include"` because the deployed frontend and API are different origins and the session cookie must be sent explicitly.

### Custom hooks

| Hook | Reference | Responsibility |
|---|---|---|
| Shared query engine | `apps/web/src/hooks/use-query.ts:35` | Loading, error, cancellation and reload state |
| Session | `apps/web/src/hooks/use-session.ts:8` | Current authenticated user |
| Projects | `apps/web/src/hooks/use-projects.ts:8` | Connected repositories |
| Branches | `apps/web/src/hooks/use-branches.ts:8` | Branches for a repository |
| Health report | `apps/web/src/hooks/use-health-report.ts:8` | Current dashboard report |
| Scan lifecycle | `apps/web/src/hooks/use-scan.ts:21` | Starts, polls, stops, and handles completion |
| Scan history | `apps/web/src/hooks/use-scan-history.ts:19` | Historical attempts/snapshots |

`useScan` is especially important: it continues polling after the user presses Stop because cancellation is cooperative and is complete only when the backend reports a terminal state.

### Main UI components

| Component | Reference |
|---|---|
| Dashboard coordinator | `apps/web/src/components/dashboard/dashboard-view.tsx:21` |
| Scan control | `apps/web/src/components/layout/scan-control.tsx:18` |
| Overall health card | `apps/web/src/components/dashboard/overall-health-card.tsx:35` |
| Trend graph | `apps/web/src/components/dashboard/health-graph-card.tsx:20` |
| Prioritized findings | `apps/web/src/components/dashboard/refactor-first-list.tsx:41` |
| Finding details | `apps/web/src/components/dashboard/finding-detail-panel.tsx:27` |
| File tree | `apps/web/src/components/dashboard/file-tree/file-tree.tsx:36` |
| Scan history table | `apps/web/src/components/history/scan-history.tsx:73` |
| Connect repository form | `apps/web/src/components/projects/connect-repo.tsx:20` |
| Project list | `apps/web/src/components/projects/project-list.tsx:15` |

## 16. API contract and schemas

The OpenAPI source of truth is `docs/api/openapi.yaml`. Frontend API types are generated into `apps/web/src/lib/types/api.ts`; that generated file should not be edited manually.

Important backend response/input models:

| Schema | Reference |
|---|---|
| Scan start/status/history | `apps/api/src/codesage_api/schemas/scan.py:11` |
| Repository input/output | `apps/api/src/codesage_api/schemas/repo.py:13` |
| Profile input/output | `apps/api/src/codesage_api/schemas/profile.py:10` |
| Health report | `apps/api/src/codesage_api/schemas/health.py:57` |
| Finding output | `apps/api/src/codesage_api/schemas/finding.py:9` |
| Session output | `apps/api/src/codesage_api/schemas/auth.py:11` |

Why generate frontend types: it makes contract drift visible during CI instead of allowing the frontend and backend to silently disagree.

## 17. Testing strategy

### Backend tests

| Area | Test location |
|---|---|
| Scoring formula/engine/cache | `apps/api/tests/unit/scoring/` |
| Scan pipeline, progress, clone, cache | `apps/api/tests/unit/tasks/` |
| Routers and HTTP behaviour | `apps/api/tests/unit/routers/` |
| Services | `apps/api/tests/unit/services/` |
| Extractors | `apps/api/tests/unit/extractors/` |
| Rule and ML clients | `apps/api/tests/unit/detection/` |
| ORM models and repositories | `apps/api/tests/unit/db/` |
| Database constraints | `apps/api/tests/integration/test_database_constraints.py` |
| Row-Level Security | `apps/api/tests/integration/test_rls.py` |

### Frontend tests

| Test level | Location |
|---|---|
| Component/hook unit tests | Files ending in `.test.ts` or `.test.tsx` under `apps/web/src/` |
| Browser end-to-end tests | `apps/web/e2e/` |
| Mock API handlers | `apps/web/src/lib/mocks/handlers.ts` |
| Mock scoring implementation | `apps/web/src/lib/mocks/scoring.ts` |

### ML tests

| Area | Location |
|---|---|
| Inference API tests | `apps/ml/tests/test_main.py` |

### Quality checks

- Backend: pytest, Ruff, mypy strict mode, and import-linter architecture contracts.
- Frontend: TypeScript typecheck, ESLint, Prettier, Vitest, Playwright, production build, and generated-type drift check.

## 18. Strong design answers for the viva

### Why use Celery instead of scanning in the HTTP request?

Cloning and analysing a repository is slow, CPU/memory intensive, and failure-prone. An asynchronous job prevents HTTP timeouts, allows progress polling and cancellation, and lets scan capacity scale by adding worker replicas.

### Why Redis?

Redis is the Celery broker and also stores short-lived progress and cancellation flags. Durable analysis facts belong in PostgreSQL, not Redis.

### Why is ML a separate service?

It isolates model dependencies and inference workload from the domain/API process. It also creates an explicit degraded-mode boundary: if inference is unavailable, rule analysis can still complete.

### Why store findings and metrics instead of only the health score?

Findings and metrics are reproducible facts. The health score is derived under a scoring profile. Keeping facts allows users to change weights and rescore old snapshots without repeating the expensive repository scan.

### Why is scoring pure?

A pure scoring function is deterministic, easy to test, independent of infrastructure, and usable both by dashboard reads and asynchronous cache warming.

### Why use a score cache if scores are derived?

Derivation remains the source-of-truth rule, but recalculating every historical snapshot can be expensive. The cache is keyed by snapshot and profile fingerprint, so it improves response time without making cached values authoritative facts.

### How are partial snapshots prevented?

The worker's finalization function persists the snapshot and all related facts inside a single database transaction. On failure, the transaction rolls back and the attempt is marked as an error.

### How is cross-tenant access prevented?

The application resolves a workspace from the authenticated server-side session. It sets that workspace as PostgreSQL transaction context, and Row-Level Security restricts tenant-owned rows. The application connects as a non-owner role so it cannot bypass the policies by table ownership.

### Why Java only?

Version 1 uses CK for static code metrics and a Java Tree-sitter grammar. Adding a language needs an equivalent extractor, grammar/rules, normalization, tests, and score calibration.

### How does cancellation work?

It is cooperative. The API writes a cancellation flag to Redis. The worker checks that flag between clone, extraction, detection, and finalization boundaries, then marks the attempt cancelled and cleans up its clone.

### How does the system remain reproducible when models change?

Snapshots store analysis-engine and ML-model provenance. This identifies which tool/model versions produced the stored facts and helps explain discontinuities across historical scans.

## 19. Limitations and honest review notes

1. Version 1 analyses Java only.
2. The normalization constant used by repository health needs empirical calibration against known repositories.
3. ML model loading contains fallback pipelines when production artifacts are unavailable; distinguish prototype behaviour from trained-model performance.
4. `apps/api/src/codesage_api/integrations/ml_service.py:1` is a placeholder. The active worker integrations are `detection/satd/client.py` and `detection/risk/client.py`.
5. The root README currently says profile endpoints return `501`, but the present code implements those endpoints at `apps/api/src/codesage_api/routers/profiles.py:21`.
6. Older documentation says scores are never stored. The precise current statement is: raw facts are authoritative, while derived score payloads may be cached asynchronously by snapshot and profile fingerprint.
7. Security pattern rules are useful targeted checks, not a replacement for a full security scanner or data-flow analysis.
8. Cooperative cancellation cannot interrupt every operation instantly; it takes effect at a stage boundary.

## 20. Recommended study order

### Pass 1: understand the product

1. `README.md`
2. `infra/docker-compose.yml:10`
3. `apps/api/src/codesage_api/main.py:23`
4. `apps/web/src/components/dashboard/dashboard-view.tsx:21`

### Pass 2: master one complete scan

1. `apps/web/src/hooks/use-scan.ts:21`
2. `apps/web/src/lib/api/client.ts:163`
3. `apps/api/src/codesage_api/routers/scans.py:20`
4. `apps/api/src/codesage_api/services/analysis.py:59`
5. `apps/api/src/codesage_api/tasks/scan_pipeline.py:73`
6. `apps/api/src/codesage_api/extractors/pipeline.py:34`
7. `apps/api/src/codesage_api/detection/rules/engine.py:162`
8. `apps/api/src/codesage_api/tasks/scan_pipeline.py:191`

### Pass 3: master scoring and the dashboard

1. `apps/api/src/codesage_api/scoring/formula.py:106`
2. `apps/api/src/codesage_api/scoring/engine.py:16`
3. `apps/api/src/codesage_api/services/dashboard.py:146`
4. `apps/api/src/codesage_api/services/dashboard.py:367`
5. `apps/web/src/hooks/use-health-report.ts:8`
6. `apps/web/src/components/dashboard/dashboard-view.tsx:21`

### Pass 4: master security and data

1. `apps/api/src/codesage_api/routers/auth.py:44`
2. `apps/api/src/codesage_api/services/auth.py:72`
3. `apps/api/src/codesage_api/deps.py:24`
4. `apps/api/src/codesage_api/db/rls.py:9`
5. `apps/api/src/codesage_api/db/models/`

### Pass 5: prepare evidence

Read the tests next to every important subsystem. For each feature, be ready to show:

- The endpoint or UI entry point
- The main business/service function
- The persistent model involved
- At least one success test
- At least one failure or edge-case test

## 21. Final revision checklist

You should be able to answer all of these without opening the code:

- [ ] What problem does CodeSage-AI solve?
- [ ] Why is the architecture a modular monolith rather than microservices?
- [ ] What are the six/eight Compose services and why are they separate?
- [ ] How does sign-in create and validate a session?
- [ ] How does RLS isolate workspaces?
- [ ] What happens from clicking Scan until the dashboard reloads?
- [ ] What does CK extract?
- [ ] What does PyDriller extract?
- [ ] Why is Tree-sitter used?
- [ ] Which findings are deterministic rules?
- [ ] What does ML-1 predict, and what does it not predict?
- [ ] What does ML-2 predict, and how does scoring use it?
- [ ] What happens when the ML service is down?
- [ ] Why is finalization one transaction?
- [ ] How does cancellation work?
- [ ] How is finding priority calculated?
- [ ] How is repository health normalized by KLOC?
- [ ] Why can a profile change rescore an old snapshot?
- [ ] Why is there a score cache and how is it invalidated?
- [ ] How does the frontend poll a scan?
- [ ] How does the OpenAPI contract protect frontend/backend compatibility?
- [ ] What is unit tested, integration tested, and end-to-end tested?
- [ ] What are the current limitations and documentation mismatches?

