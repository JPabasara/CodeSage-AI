# CodeSage-AI Endpoint Reference

> Generated from the current implementation on 2026-08-28. File and line references may move when the source is edited.

This document maps every implemented HTTP endpoint to its router, business logic, schemas, and frontend caller. It covers both the public CodeSage API and the private ML inference API.

## 1. Route protection

The main API has two router groups in `apps/api/src/codesage_api/routers/__init__.py`:

- `public_router` at line 12 contains login, callback, logout, and liveness routes.
- `api_router` at line 19 contains the authenticated product routes.

The authenticated router is protected as a whole in `apps/api/src/codesage_api/main.py:57`:

```python
app.include_router(api_router, dependencies=[Depends(get_current_user_id)])
```

This means a newly added product endpoint is authenticated automatically when it is included through `api_router`.

After authentication, `get_db()` in `apps/api/src/codesage_api/deps.py:55` binds the caller's workspace to the PostgreSQL transaction. Row-Level Security then enforces tenant isolation.

## 2. Endpoint summary

### Public and operational API

| Method | Endpoint | Authentication | Status |
|---|---|---|---|
| `GET` | `/api/auth/login` | Public | Implemented |
| `GET` | `/api/auth/callback` | Public | Implemented |
| `POST` | `/api/auth/logout` | Public by design | Implemented |
| `GET` | `/api/healthz` | Public | Implemented |
| `GET` | `/readyz` | Public operational route | Returns `501` |
| `GET` | `/version` | Public operational route | Returns `501` |

### Authenticated product API

| Method | Endpoint | Main purpose |
|---|---|---|
| `GET` | `/api/auth/session` | Return the signed-in user and workspace |
| `GET` | `/api/projects` | List connected repositories |
| `POST` | `/api/projects` | Connect a public GitHub repository |
| `GET` | `/api/repos/{repo_id}/branches` | Refresh and list repository branches |
| `POST` | `/api/repos/{repo_id}/scan` | Queue a repository scan |
| `GET` | `/api/repos/{repo_id}/scan/{scan_id}` | Poll scan phase and progress |
| `POST` | `/api/repos/{repo_id}/scan/{scan_id}/stop` | Request cooperative cancellation |
| `GET` | `/api/repos/{repo_id}/scans` | Return repository scan history |
| `GET` | `/api/repos/{repo_id}/health` | Return a scored health report |
| `GET` | `/api/profiles` | List scoring presets |
| `GET` | `/api/profiles/active` | Return the active scoring profile |
| `PUT` | `/api/profiles/active` | Apply a complete scoring profile |

### Private ML API

| Method | Endpoint | Main purpose |
|---|---|---|
| `POST` | `/classify` | Classify source comments as SATD |
| `POST` | `/risk` | Predict per-file bug risk |
| `GET` | `/version` | Return loaded model versions |
| `GET` | `/healthz` | ML process liveness |

The ML service is reachable by workers on the private container network. It is not intended to be called by browsers.

---

## 3. Authentication endpoints

## `GET /api/auth/login`

**Purpose:** Begin the OIDC Authorization Code flow with PKCE.

| Concern | Location |
|---|---|
| Router | `apps/api/src/codesage_api/routers/auth.py:34` |
| Main function | `begin_sign_in()` at `auth.py:35` |
| Configuration | `apps/api/src/codesage_api/config.py:13` |
| Frontend entry | `apps/web/src/app/(auth)/login/page.tsx:3` |

**How it works:**

1. Verifies that the Asgardeo base URL and client ID are configured.
2. Generates a random OIDC `state` value.
3. Generates a PKCE verifier and SHA-256 challenge.
4. Places the state and verifier in a signed, HTTP-only handshake cookie valid for ten minutes.
5. Responds with `302 Found` and redirects the browser to Asgardeo's authorization endpoint.

This is a browser navigation, not a `fetch()` request, because the browser must leave CodeSage and visit the identity provider.

**Success response:** `302` redirect to Asgardeo.

**Important failures:** Misconfigured identity-provider settings produce the application's sign-in configuration error.

## `GET /api/auth/callback`

**Purpose:** Complete authentication after Asgardeo redirects the browser back.

| Concern | Location |
|---|---|
| Router | `apps/api/src/codesage_api/routers/auth.py:84` |
| Main function | `complete_sign_in()` at `auth.py:85` |
| Code exchange | `apps/api/src/codesage_api/services/auth.py:72` |
| Session creation | `apps/api/src/codesage_api/services/auth.py:139` |
| New-user provisioning | `apps/api/src/codesage_api/services/auth.py:166` |

**Query parameters:**

- `code`: single-use authorization code issued by Asgardeo.
- `state`: value that must match the signed handshake cookie.

**How it works:**

1. Reads and verifies the signed handshake cookie.
2. Compares the returned state using a timing-safe comparison.
3. Exchanges the authorization code and PKCE verifier with Asgardeo server-to-server.
4. Loads or provisions the user and workspace.
5. Creates a server-side `UserSession` row.
6. Places only the opaque session UUID in an HTTP-only cookie.
7. Deletes the temporary handshake cookie.
8. Redirects the browser to `/projects`.

Identity tokens remain on the backend; they are not stored in browser-accessible JavaScript state.

**Success response:** `302` redirect to the frontend projects page.

**Failure behaviour:** Invalid, expired, mismatched, or replayed handshakes redirect back to the login page with an error reason.

## `GET /api/auth/session`

**Purpose:** Return the currently authenticated user's display information and workspace.

| Concern | Location |
|---|---|
| Router | `apps/api/src/codesage_api/routers/auth.py:156` |
| Main function | `current_user()` at `auth.py:157` |
| Response schema | `apps/api/src/codesage_api/schemas/auth.py:11` |
| Session validation | `apps/api/src/codesage_api/services/auth.py:241` |
| Frontend client | `apps/web/src/lib/api/client.ts:83` |
| Frontend hook | `apps/web/src/hooks/use-session.ts:8` |

**How it works:**

1. The authentication dependency validates the opaque cookie against the server-side session table.
2. It obtains the trusted `user_id` and `workspace_id` from that row.
3. The endpoint loads the user's display fields.
4. It returns identifiers, email, name, avatar, and identity-provider information.

**Success response:** `200` with `SessionOut`.

**Important failure:** `401` when the cookie is missing, invalid, expired, or refers to a deleted session.

## `POST /api/auth/logout`

**Purpose:** End the local session and the Asgardeo SSO session.

| Concern | Location |
|---|---|
| Router | `apps/api/src/codesage_api/routers/auth.py:216` |
| Main function | `sign_out()` at `auth.py:217` |
| Session deletion | `apps/api/src/codesage_api/services/auth.py:277` |
| Frontend form | `apps/web/src/components/layout/app-rail.tsx:85` |

**How it works:**

1. Reads the opaque session cookie if one exists.
2. Deletes the corresponding server-side session row.
3. Deletes the browser session cookie using the same path and domain attributes used to create it.
4. Redirects the browser to Asgardeo's logout endpoint.
5. Asgardeo redirects the user back to the CodeSage login page.

This endpoint is deliberately public and idempotent. A user must still be able to clear an expired or already-revoked cookie.

**Success response:** `302` redirect.

---

## 4. Project and repository endpoints

## `GET /api/projects`

**Purpose:** List repositories connected to the caller's workspace.

| Concern | Location |
|---|---|
| Router | `apps/api/src/codesage_api/routers/projects.py:18` |
| Main function | `list_projects()` at `projects.py:19` |
| Service | `apps/api/src/codesage_api/services/repositories.py:88` |
| Response schema | `apps/api/src/codesage_api/schemas/repo.py:25` |
| Frontend client | `apps/web/src/lib/api/client.ts:106` |
| Frontend hook | `apps/web/src/hooks/use-projects.ts:8` |
| Main UI | `apps/web/src/app/(app)/projects/page.tsx:27` |

**How it works:**

1. Loads repositories belonging to the active workspace.
2. Loads the active scoring profile when repositories exist.
3. Obtains the latest available health summary for each repository.
4. Returns repository metadata plus its latest-health hint.

The health hint is derived under the active profile. Raw repository rows do not contain an authoritative health grade.

**Success response:** `200` with an array of `RepoOut`.

## `POST /api/projects`

**Purpose:** Connect a public GitHub repository to the current workspace.

| Concern | Location |
|---|---|
| Router | `apps/api/src/codesage_api/routers/projects.py:33` |
| Main function | `connect_repository()` at `projects.py:34` |
| Service | `apps/api/src/codesage_api/services/repositories.py:34` |
| GitHub URL parsing | `apps/api/src/codesage_api/integrations/github.py:36` |
| GitHub metadata | `apps/api/src/codesage_api/integrations/github.py:56` |
| Request/response schema | `apps/api/src/codesage_api/schemas/repo.py:13` |
| Frontend client | `apps/web/src/lib/api/client.ts:96` |
| Frontend form | `apps/web/src/components/projects/connect-repo.tsx:20` |

**Request body:**

```json
{
  "url": "https://github.com/owner/repository"
}
```

**How it works:**

1. Parses and normalizes the GitHub URL.
2. Calls the GitHub REST API for repository metadata.
3. Rejects non-public repositories because private-repository authorization is not implemented in version 1.
4. Checks whether the repository is already connected in the workspace.
5. Stores the repository and its default branch.
6. Records an audit event.
7. Returns the created repository representation.

**Success response:** `201 Created` with `RepoOut`.

**Important failures:** Invalid URL, unreachable repository, private repository, GitHub rate limiting, missing default branch, or an already-connected repository.

## `GET /api/repos/{repo_id}/branches`

**Purpose:** Refresh and list the branches of one connected repository.

| Concern | Location |
|---|---|
| Router | `apps/api/src/codesage_api/routers/branches.py:18` |
| Main function | `list_branches()` at `branches.py:19` |
| Service | `apps/api/src/codesage_api/services/repositories.py:156` |
| GitHub integration | `apps/api/src/codesage_api/integrations/github.py:132` |
| Response schema | `apps/api/src/codesage_api/schemas/branch.py:8` |
| Frontend client | `apps/web/src/lib/api/client.ts:112` |
| Frontend hook | `apps/web/src/hooks/use-branches.ts:8` |

**Path parameter:** `repo_id`, the internal repository UUID.

**How it works:**

1. Uses the workspace-scoped repository lookup to prevent access to another tenant's repository.
2. Requests current branch metadata from the GitHub REST API.
3. Inserts or updates stored branch rows and head commit SHAs.
4. Marks the default branch.
5. Returns the branch list.

**Success response:** `200` with an array of `BranchOut`.

---

## 5. Scan endpoints

## `POST /api/repos/{repo_id}/scan`

**Purpose:** Start an asynchronous analysis of a repository branch.

| Concern | Location |
|---|---|
| Router | `apps/api/src/codesage_api/routers/scans.py:20` |
| Main function | `start_scan()` at `scans.py:21` |
| Orchestration service | `apps/api/src/codesage_api/services/analysis.py:59` |
| Attempt repository | `apps/api/src/codesage_api/db/repositories/attempts.py:107` |
| Celery pipeline | `apps/api/src/codesage_api/tasks/scan_pipeline.py:73` |
| Request/response schemas | `apps/api/src/codesage_api/schemas/scan.py:11` |
| Frontend client | `apps/web/src/lib/api/client.ts:163` |
| Frontend hook | `apps/web/src/hooks/use-scan.ts:21` |

**Path parameter:** `repo_id`, the connected repository UUID.

**Request body:**

```json
{
  "branch": "main"
}
```

**How it works:**

1. Confirms the repository and branch belong to the active workspace.
2. Refreshes/reads the branch head commit SHA.
3. Prevents a second active scan for the same branch.
4. Applies skip-if-unchanged behaviour when appropriate.
5. Creates an `AnalysisAttempt` row in PostgreSQL.
6. Commits the attempt before publishing the Celery message.
7. Queues `codesage.scan` through Redis.
8. Returns immediately instead of waiting for analysis.

The worker subsequently performs `clone -> extract -> detect -> finalize` and queues score-cache warming.

**Success response:** `202 Accepted` with `ScanStatusOut`.

**Important failure:** A scan is already active for the branch, or the repository/branch cannot be found in the caller's workspace.

## `GET /api/repos/{repo_id}/scan/{scan_id}`

**Purpose:** Poll the phase and percentage of an analysis attempt.

| Concern | Location |
|---|---|
| Router | `apps/api/src/codesage_api/routers/scans.py:39` |
| Main function | `get_scan_status()` at `scans.py:40` |
| Service | `apps/api/src/codesage_api/services/analysis.py:113` |
| Status conversion | `apps/api/src/codesage_api/services/analysis.py:25` |
| Redis progress read | `apps/api/src/codesage_api/tasks/progress.py:57` |
| Frontend client | `apps/web/src/lib/api/client.ts:172` |
| Polling implementation | `apps/web/src/hooks/use-scan.ts:21` |

**How it works:**

1. Loads the attempt through the repository/workspace ownership chain.
2. Reads the durable phase and failure information from PostgreSQL.
3. For active scans, reads the temporary percentage from Redis.
4. Converts those values to `ScanStatusOut`.

PostgreSQL stores durable terminal information; losing a Redis progress value does not lose the final scan result.

**Success response:** `200` with phase such as `queued`, `running`, `done`, `error`, or `cancelled`.

## `POST /api/repos/{repo_id}/scan/{scan_id}/stop`

**Purpose:** Request cooperative cancellation of a queued or running scan.

| Concern | Location |
|---|---|
| Router | `apps/api/src/codesage_api/routers/scans.py:61` |
| Main function | `stop_scan()` at `scans.py:62` |
| Service | `apps/api/src/codesage_api/services/analysis.py:147` |
| Set Redis flag | `apps/api/src/codesage_api/tasks/progress.py:67` |
| Worker cancellation check | `apps/api/src/codesage_api/tasks/cancel.py:37` |
| Frontend client | `apps/web/src/lib/api/client.ts:181` |

**How it works:**

1. Verifies that the scan belongs to the requested repository and active workspace.
2. Sets a cancellation flag in Redis.
3. Returns the current status immediately.
4. The worker checks the flag between pipeline stages.
5. At the next safe boundary, the worker marks the attempt `cancelled` and removes its clone.

Cancellation does not interrupt atomic finalization once database writes have begun.

**Success response:** `200` with `ScanStatusOut`. The phase may temporarily remain `running`; the frontend continues polling until it becomes `cancelled`.

## `GET /api/repos/{repo_id}/scans`

**Purpose:** Return scan history for a repository, optionally filtered by branch.

| Concern | Location |
|---|---|
| Router | `apps/api/src/codesage_api/routers/scans.py:87` |
| Main function | `list_scan_history()` at `scans.py:88` |
| Service | `apps/api/src/codesage_api/services/analysis.py:133` |
| Dashboard history builder | `apps/api/src/codesage_api/services/dashboard.py:493` |
| Response schema | `apps/api/src/codesage_api/schemas/scan.py:27` |
| Frontend client | `apps/web/src/lib/api/client.ts:128` |
| Frontend hook | `apps/web/src/hooks/use-scan-history.ts:19` |
| History UI | `apps/web/src/components/history/scan-history.tsx:73` |

**Optional query parameter:** `branch`. When omitted, history covers the entire repository.

**How it works:**

1. Loads completed snapshots belonging to the requested repository/workspace.
2. Optionally restricts them to one branch.
3. Resolves the active scoring profile.
4. Uses cached profile-specific scores where available.
5. Enqueues missing score calculations.
6. Returns commit SHA, date, score, grade, change, and finding count.

**Success response:** `200` with an array of `ScanSummaryOut`.

---

## 6. Dashboard endpoint

## `GET /api/repos/{repo_id}/health`

**Purpose:** Return the dashboard's complete health report for the latest or selected snapshot.

| Concern | Location |
|---|---|
| Router | `apps/api/src/codesage_api/routers/health.py:16` |
| Main function | `get_health_report()` at `health.py:17` |
| Report builder | `apps/api/src/codesage_api/services/dashboard.py:367` |
| Snapshot scoring | `apps/api/src/codesage_api/services/dashboard.py:146` |
| Pure scoring engine | `apps/api/src/codesage_api/scoring/engine.py:16` |
| Formula | `apps/api/src/codesage_api/scoring/formula.py:106` |
| Response schema | `apps/api/src/codesage_api/schemas/health.py:57` |
| Frontend client | `apps/web/src/lib/api/client.ts:118` |
| Frontend hook | `apps/web/src/hooks/use-health-report.ts:8` |
| Dashboard component | `apps/web/src/components/dashboard/dashboard-view.tsx:21` |

**Required query parameter:** `branch`.

**Optional query parameter:** `snapshot_id`. When omitted, the latest completed snapshot is selected.

**How it works:**

1. Loads the active workspace scoring profile.
2. Finds the selected or latest finalized snapshot for the branch.
3. Builds a profile fingerprint.
4. Returns a ready cached score when available.
5. If scoring is missing, creates/enqueues the required cache work as defined by the dashboard service.
6. Builds findings, file health, directory tree, category breakdown, trend, provenance, and repository health.
7. Returns one `HealthReportOut` for rendering the dashboard.

The authoritative stored data consists of findings, metrics, predictions, and provenance. Score payloads are derived and may be cached for performance.

**Success response:** `200` with `HealthReportOut`.

**Important conditions:** No completed snapshot, missing repository/branch, or a score that is still pending.

---

## 7. Scoring profile endpoints

## `GET /api/profiles`

**Purpose:** List preset scoring profiles and the workspace's current/custom profile information.

| Concern | Location |
|---|---|
| Router | `apps/api/src/codesage_api/routers/profiles.py:21` |
| Main function | `list_profiles()` at `profiles.py:22` |
| Service | `apps/api/src/codesage_api/services/profiles.py:95` |
| Preset loader | `apps/api/src/codesage_api/scoring/config_loader.py:59` |
| Response schema | `apps/api/src/codesage_api/schemas/profile.py:47` |
| Frontend client | `apps/web/src/lib/api/client.ts:155` |
| Frontend hook | `apps/web/src/hooks/use-profiles.ts:8` |

**How it works:**

1. Loads preset definitions from the scoring configuration.
2. Loads the workspace's active stored profile.
3. Marks the matching preset as active when applicable.
4. Returns profile weights and the trust slider value.

**Success response:** `200` with an array of `ScoreProfileOut`.

## `GET /api/profiles/active`

**Purpose:** Return the exact scoring profile currently applied to the workspace.

| Concern | Location |
|---|---|
| Router | `apps/api/src/codesage_api/routers/profiles.py:30` |
| Main function | `get_active_profile()` at `profiles.py:31` |
| Service output | `apps/api/src/codesage_api/services/profiles.py:88` |
| Domain profile loading | `apps/api/src/codesage_api/services/profiles.py:78` |
| Frontend client | `apps/web/src/lib/api/client.ts:135` |
| Frontend hook | `apps/web/src/hooks/use-profiles.ts:18` |

**How it works:** Loads the one active `ScoringProfile` row allowed for the current workspace and serializes its five category weights and trust value.

**Success response:** `200` with `ScoreProfileOut`.

## `PUT /api/profiles/active`

**Purpose:** Atomically replace the workspace's active scoring profile.

| Concern | Location |
|---|---|
| Router | `apps/api/src/codesage_api/routers/profiles.py:43` |
| Main function | `apply_profile()` at `profiles.py:44` |
| Service | `apps/api/src/codesage_api/services/profiles.py:122` |
| Clamp formula | `apps/api/src/codesage_api/scoring/formula.py:139` |
| Request schema | `apps/api/src/codesage_api/schemas/profile.py:28` |
| Frontend client | `apps/web/src/lib/api/client.ts:146` |
| Profiles screen | `apps/web/src/app/(app)/profiles/page.tsx:66` |

**Request body:** A complete profile containing all category weights, the source-trust value, and profile name.

**How it works:**

1. Clamps category weights to the configured range and trust to `0..1`.
2. Deactivates the previous profile and stores the new active profile atomically.
3. Records the actor for auditing.
4. Commits before publishing cache work.
5. Queues `codesage.warm_workspace_scores` so existing snapshots are scored for the new profile.
6. Returns the values actually stored after clamping.

`PUT` is used because the body is a complete replacement and repeated identical requests are idempotent.

**Success response:** `200` with the stored `ScoreProfileOut`.

---

## 8. System endpoints

## `GET /api/healthz`

**Purpose:** Report whether the API process is alive.

| Concern | Location |
|---|---|
| Router | `apps/api/src/codesage_api/routers/system.py:23` |
| Main function | `liveness()` at `system.py:24` |
| Docker health check | `infra/docker-compose.yml:105` |

**How it works:** Returns `{"status": "ok"}` without checking PostgreSQL, Redis, or ML. A dependency outage should not cause the orchestrator to restart an otherwise healthy API process.

**Success response:** `200`.

## `GET /readyz`

**Purpose:** Intended to report whether the process can serve traffic by checking required dependencies.

| Concern | Location |
|---|---|
| Router | `apps/api/src/codesage_api/routers/system.py:30` |
| Main function | `readiness()` at `system.py:31` |

**Current status:** Not implemented. The function raises `NotImplementedError`, which the application converts to a `501` response.

The intended check covers PostgreSQL and Redis but deliberately excludes ML because ML unavailability is a supported degraded mode.

## `GET /version`

**Purpose:** Intended to report build and analysis-engine versions.

| Concern | Location |
|---|---|
| Router | `apps/api/src/codesage_api/routers/system.py:41` |
| Main function | `version()` at `system.py:42` |

**Current status:** Not implemented. It raises `NotImplementedError` and returns `501` through the exception handler.

---

## 9. Private ML inference endpoints

The ML service has a separate FastAPI application at `apps/ml/src/codesage_ml/main.py:32`. Workers call it through the private network; browsers and the main API request handlers do not call it directly.

## `POST /classify`

**Purpose:** ML-1 batch classification of source comments as self-admitted technical debt.

| Concern | Location |
|---|---|
| ML endpoint | `apps/ml/src/codesage_ml/main.py:35` |
| Main function | `classify()` at `main.py:36` |
| Request/response models | `apps/ml/src/codesage_ml/schemas.py:8` |
| Model loading | `apps/ml/src/codesage_ml/registry.py:79` |
| Label mapping | `apps/ml/src/codesage_ml/satd/labels.py:42` |
| Worker-side client | `apps/api/src/codesage_api/detection/satd/client.py` |

**How it works:**

1. Loads the versioned SATD pipeline.
2. Extracts comment text into a batch.
3. Predicts debt/non-debt and the dataset category.
4. Obtains confidence using `predict_proba` when available.
5. Maps dataset labels to CodeSage categories.
6. Returns predictions plus the model version.

It does not predict severity. The worker assigns severity deterministically using `apps/api/src/codesage_api/detection/satd/severity_markers.py:66`.

## `POST /risk`

**Purpose:** ML-2 prediction of per-file bug proneness.

| Concern | Location |
|---|---|
| ML endpoint | `apps/ml/src/codesage_ml/main.py:80` |
| Main function | `risk()` at `main.py:81` |
| Request/response models | `apps/ml/src/codesage_ml/schemas.py:31` |
| Model loading | `apps/ml/src/codesage_ml/registry.py:105` |
| Feature vector contract | `apps/ml/src/codesage_ml/risk/features.py:41` |
| Worker-side client | `apps/api/src/codesage_api/detection/risk/client.py:25` |

**How it works:**

1. Loads the versioned bug-risk model.
2. Converts every file's metric dictionary into the canonical 13-value feature order.
3. Uses class-one probability when `predict_proba` is supported, otherwise uses the model's direct prediction.
4. Returns one risk score per file plus the model version.

The result is a score, not a finding. It influences finding priority through the scoring risk factor.

## `GET /version` — ML service

**Purpose:** Return the SATD and bug-risk artifact versions currently loaded.

| Concern | Location |
|---|---|
| Endpoint | `apps/ml/src/codesage_ml/main.py:115` |
| Main function | `version()` at `main.py:116` |
| Response model | `apps/ml/src/codesage_ml/schemas.py:51` |

Workers persist model provenance so historical results identify which model versions produced them.

## `GET /healthz` — ML service

**Purpose:** Report whether the ML process is alive.

| Concern | Location |
|---|---|
| Endpoint | `apps/ml/src/codesage_ml/main.py:132` |
| Docker health check | `infra/docker-compose.yml:48` |

Returns `{"status": "ok"}`. This checks the process, not model quality.

---

## 10. Common request lifecycle

An authenticated endpoint normally follows this path:

```text
Browser fetch(credentials="include")
    -> FastAPI protected router
    -> get_current_user_id validates server-side session
    -> get_workspace_id obtains trusted tenant
    -> get_db opens transaction and sets PostgreSQL RLS context
    -> router validates HTTP input
    -> service performs the use case
    -> repository/SQLAlchemy accesses tenant-filtered rows
    -> Pydantic serializes the response
    -> transaction commits or rolls back
```

The frontend API wrapper is `apps/web/src/lib/api/client.ts`. Non-2xx responses are converted to `ApiRequestError` at line 39, preserving the backend's stable error code and human-readable detail.

## 11. Endpoint evaluation questions

### Why are login and logout navigations instead of normal API fetches?

OIDC requires the browser to visit Asgardeo. Logout must also visit the identity provider so its SSO cookie is cleared. A background fetch cannot perform that visible cross-site navigation correctly.

### Why does scan creation return `202`?

The request has been accepted, but repository analysis runs asynchronously. The client receives a scan ID and polls the status endpoint.

### Why is progress split between PostgreSQL and Redis?

The phase and error are durable facts and remain in PostgreSQL. The percentage is temporary and inexpensive to lose, so Redis is appropriate.

### Why use polling instead of WebSockets?

Polling provides sufficient version-1 progress feedback with a simpler deployment and failure model. The frontend stops polling when it receives `done`, `error`, or `cancelled`.

### Why does the health endpoint need a branch?

Each branch has its own commit history, snapshots, trends, and current health. Repository health without selecting a branch would be ambiguous.

### Why does changing a profile not trigger a new scan?

The snapshot stores measured facts and findings. Scoring is derived from those facts under the selected profile, so existing snapshots can be rescored.

### Why are readiness and liveness separate?

Liveness answers whether the process should be restarted. Readiness answers whether it can currently serve traffic. A temporary database outage should remove a process from traffic but should not necessarily restart it.

## 12. Known endpoint limitations

- `/readyz` is declared but currently returns `501`.
- The main API `/version` is declared but currently returns `501`.
- Version 1 connects public GitHub repositories only.
- Version 1 analysis targets Java repositories.
- The ML endpoints are private service endpoints and do not implement end-user authentication; network isolation is their boundary.
- The root README contains an outdated statement that profile endpoints return `501`; the current profile endpoints are implemented.

