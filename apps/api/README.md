# apps/api — FastAPI + Celery

The backend API process and the asynchronous scan workers. **One codebase, one
image, two entrypoints** (SAD §7): they share the domain model, the ORM and the
data contract, so splitting them would mean maintaining the same shapes on both
sides of a network boundary.

```
uvicorn codesage_api.main:app                    # API container
celery -A codesage_api.worker worker             # worker container
```

## Layout

```
src/codesage_api/
├── routers/       HTTP edge — the 16 operations of docs/api/openapi.yaml. No domain logic.
├── schemas/       Pydantic wire shapes; snake_case on the wire (locked decision 1)
├── services/      domain layer — orchestrates db + scoring + queue. No FastAPI imports.
├── scoring/       ★ PURE. No db, no io, no web. The read path's whole output.
├── tasks/         Celery — the write path: clone → extract → detect → finalize
├── extractors/    dataclass SHAPES only so far (CK / history / comments output)
├── detection/     rule engine · SATD markers · ML clients · reason templates
├── db/            models, session, RLS context
└── integrations/  GitHub gateway (metadata + cloning only — never identity)
```

> **The contract is `docs/api/openapi.yaml`, not the frontend's TypeScript.** Field
> names are snake_case everywhere — one spelling from the PostgreSQL column to the
> browser. `schemas/base.py` therefore sets no `alias_generator`.

> **Most handlers are still `raise NotImplementedError`.** The database models, the
> migration, the scoring formula, the enums, config, RLS helpers, error classes and
> sign-in are real; the route bodies are not.

## Four rules the code is arranged around

**1. Detection and scoring happen on the server; the dashboard only reads and draws.**
If a number on screen cannot be traced to a row in PostgreSQL or to a function of
those rows, it does not go on screen.

**2. Store facts, derive opinions.** `FINDING` and `SOURCE_FILE` hold what was true
of the code at one commit. Priority, file debt, health, grade, delta and the
category breakdown are *not columns* — they are functions of the active profile,
computed on every read (FR-21). This is what lets a profile change re-rank
instantly and never re-scan.

**3. Scoring is pure, and the workers never call it.** The write path ends at
"persist the snapshot"; scoring runs in the API process on the read path. Both
halves are enforced by import-linter contracts in `pyproject.toml` — run
`lint-imports` (3 contracts). This repo has **no CI pipeline yet**, so that is a
command someone has to run, not a gate that runs itself.

**4. Severity is system-owned; weights are user-owned.** `severity` and `category`
are written once at detection and no later process or user setting touches them.
The profile carries weights only. This separation is what makes the FR-24
visibility floor safe.

## Running it

```bash
cp .env.example .env          # then fill in the Asgardeo values (see below)
pip install -e ".[dev]"
alembic upgrade head
uvicorn codesage_api.main:app --reload
```

Or the whole stack: `docker compose -f ../../infra/docker-compose.yml up`.

### Signing in

**Asgardeo is the only identity provider** (locked decision 4), and **FastAPI — not
Next.js — completes the flow** (locked decision 5). GitHub is federated *inside*
Asgardeo, so this service never runs a GitHub OAuth exchange and never holds a
GitHub token.

The browser is redirected to `/api/auth/login`, comes back to `/api/auth/callback`,
and leaves with an httpOnly cookie holding a **session row id and nothing else**. No
token ever reaches client JavaScript (SEC-08, SEC-09), and signing out deletes the
row, so revocation is immediate.

Fill `CODESAGE_ASGARDEO_CLIENT_ID` and `CODESAGE_ASGARDEO_CLIENT_SECRET` from the
Asgardeo console; `.env.example` documents every value. `/api/auth/login`,
`/api/auth/callback` and `/api/healthz` are the **only** unauthenticated routes —
everything else returns `401` without a valid cookie.

### Watching a scan — `scripts/trigger_scan.py`

A development tool, not part of the service and imported by nothing. It enqueues one
attempt and follows it to a terminal phase:

```bash
python scripts/trigger_scan.py <attempt_id> --workspace <workspace_id>
python scripts/trigger_scan.py <attempt_id> --workspace <workspace_id> --watch
```

```
attempt  6f1c…   commit a1e6e5e   phase queued
enqueued codesage.scan
  queued      0%
  running    35%
  running    80%
  done      100%

done after 41.7s
```

Three things it shows that are easy to get wrong when reading the code:

- **It takes an attempt id, not a repository URL.** `POST /api/repos/{repo_id}/scan`
  creates the ANALYSIS_ATTEMPT row; the worker carries it out. A scan is never
  "analyse this URL" — which is what makes a cancelled attempt structurally unable
  to produce a snapshot (locked decision 9).
- **Phase comes from PostgreSQL, percent from Redis, neither from Celery.**
  `tasks/app.py` sets `backend=None`: a scan's outcome is the attempt row and its
  snapshot, not a task return value. `result.ready()` and `result.state` have
  nothing to read here.
- **`--workspace` is required** because ANALYSIS_ATTEMPT sits behind RLS. A caller
  from the wrong workspace gets the same answer as one asking for a row that never
  existed — running the script by hand earns no exemption.

## Tests

```bash
pytest tests/unit          # no database, no broker — pure functions
pytest tests/integration   # real PostgreSQL via testcontainers
lint-imports               # the architecture contracts
```

**Testing Celery tasks: set `task_always_eager=True`** and the task runs inline, in
the calling process, with no broker and no worker — so a pipeline test is an ordinary
unit test. This came from Nathasha's work on `feature/setup-celery-redis` and is the
right pattern to reuse here.

The database suite follows a red-green-refactor workflow:

1. Add or change a schema-contract test under `tests/unit/db` and run it to see
   the expected failure (red).
2. Add the migration and ORM change, then run `pytest tests/unit/db` (green).
3. Add a PostgreSQL behavior test under `tests/integration` for constraints,
   indexes, transactions, or RLS that cannot be proven from ORM metadata.
4. Refactor only while both suites remain green. Commit the failing test and the
   implementation separately when the project assessment requires auditable TDD
   evidence.

The unit tests prove the declared schema contract without Docker. Integration
tests use PostgreSQL 16 through Testcontainers and skip if Docker is unavailable.

## Things that are deliberately not here

No suppression or finding-action tables — v1.0 is view-only (FR-17b). No webhook
endpoint — scans are user-initiated only (FR-6). No RBAC beyond `Membership.role`
— roles are v2 (DBR-5). No private-repository support — that needs a GitHub App
installation (FR-3).

## Open items

- **`k` is a placeholder.** FR-11 requires it to be calibrated against reference
  repositories before release, with the value and method recorded in the SAD.
  No grade is meaningful until that is done.
- ~~**RLS policies are not written yet.**~~ **Done** — the migration enables row-level
  security and writes the policies. `session` is deliberately excluded: it is the
  table that *tells us* which workspace the caller is in, so it cannot be filtered by
  the workspace it has not yet reported. `app_workspace_for_user()` is the one
  `SECURITY DEFINER` function in the system, and it exists for the same reason.
- **Preset weights are not normative.** FR-20 names the three presets but no longer
  publishes their weight table — see the note in `scoring/config/presets.yaml`.
- **The CK jar version is unpinned.** Pin it and record it on
  `AnalysisEngineVersion.ck_version`, or REL-10's consistency claim is unverifiable.
- **The frontend's hand-written types are stale.** `docs/api/openapi.yaml` is the
  contract and `apps/web/src/lib/types/api.ts` is generated from it
  (`pnpm gen:types`) — both agree with `scoring/enums.py`. But the components still
  import the hand-written `apps/web/src/lib/types/index.ts`, which has the
  pre-CR-001 enums and camelCase field names. Phase 10.6 switches them over.
- **Nothing checks the API against the contract.** `pnpm gen:types:check` keeps the
  *frontend* honest, but no job yet diffs FastAPI's generated `/openapi.json`
  against `docs/api/openapi.yaml`. That only becomes meaningful once the handlers
  have bodies — and there is no CI pipeline to run it in yet.
