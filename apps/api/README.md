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
├── routers/       HTTP edge — the 13 endpoints of SRS Table 3.106. No domain logic.
├── schemas/       Pydantic wire shapes; camelCase on the wire (contract is TS-first)
├── services/      domain layer — orchestrates db + scoring + queue. No FastAPI imports.
├── scoring/       ★ PURE. No db, no io, no web. The read path's whole output.
├── tasks/         Celery — the write path: clone → extract → detect → finalize
├── extractors/    CK (Java metrics) · PyDriller (history) · Tree-sitter (comments)
├── detection/     rule engine · SATD markers · ML clients · reason templates
├── db/            models, repositories, session, RLS context
└── integrations/  GitHub gateway · ML service client
```

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
halves are enforced in CI by import-linter contracts in `pyproject.toml` — run
`lint-imports`.

**4. Severity is system-owned; weights are user-owned.** `severity` and `category`
are written once at detection and no later process or user setting touches them.
The profile carries weights only. This separation is what makes the FR-24
visibility floor safe.

## Running it

```bash
cp .env.example .env          # then fill in the GitHub OAuth values
pip install -e ".[dev]"
alembic upgrade head
uvicorn codesage_api.main:app --reload
```

Or the whole stack: `docker compose -f ../../infra/docker-compose.yml up`.

## Tests

```bash
pytest tests/unit          # no database, no broker — pure functions
pytest tests/integration   # real PostgreSQL via testcontainers
lint-imports               # the architecture contracts
```

## Things that are deliberately not here

No suppression or finding-action tables — v1.0 is view-only (FR-17b). No webhook
endpoint — scans are user-initiated only (FR-6). No RBAC beyond `Membership.role`
— roles are v2 (DBR-5). No private-repository support — that needs a GitHub App
installation (FR-3).

## Open items

- **`k` is a placeholder.** FR-11 requires it to be calibrated against reference
  repositories before release, with the value and method recorded in the SAD.
  No grade is meaningful until that is done.
- **RLS policies are not written yet.** `infra/postgres/init/01-init.sql` creates
  the non-superuser role; the policies belong in the migration that creates the
  tables.
- **Preset weights are not normative.** FR-20 names the three presets but no longer
  publishes their weight table — see the note in `scoring/config/presets.yaml`.
- **The CK jar version is unpinned.** Pin it and record it on
  `AnalysisEngineVersion.ck_version`, or REL-10's consistency claim is unverifiable.
- **The shared data contract is stale.** `apps/web/src/lib/types/index.ts` still
  has the pre-CR-001 enums and disagrees with `scoring/enums.py` on `Source`,
  `Category` and the profile shape.
