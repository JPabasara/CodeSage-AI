# infra/postgres/

Database bootstrap for the local stack.

```
postgres/
└── init/
    └── 01-init.sql     runs ONCE, on a brand-new data volume
```

`docker-compose.yml` mounts this directory at `/docker-entrypoint-initdb.d` (read-only). The
official Postgres image runs everything in there **only when the data directory is empty** — so
editing `01-init.sql` does nothing to a database that already exists. To re-run it:

```powershell
docker compose down -v      # -v deletes the volume, and with it all your data
docker compose up -d postgres
```

---

## What the file does, and why it is the most important file in `infra/`

It creates a second role.

```sql
CREATE ROLE codesage_app WITH LOGIN PASSWORD 'devpassword'
    NOSUPERUSER NOCREATEDB NOCREATEROLE;
```

**PostgreSQL Row-Level Security is silently bypassed by superusers and by the owner of the
table.** If the application connected as `postgres`, or as the role that created the tables, every
policy would be ignored, every cross-tenant query would succeed — and everything would look
perfect in development. The isolation SRS DBR-3 requires would exist only on paper.

So there are two roles, and the split is the point:

| Role | Can | Used by |
|---|---|---|
| `codesage_owner` | create and change tables — it owns the schema | Alembic, via `CODESAGE_MIGRATION_DATABASE_URL` |
| `codesage_app` | read and write rows only; **subject to RLS** | The API and the workers, via `CODESAGE_DATABASE_URL` |

`ALTER DEFAULT PRIVILEGES` grants `codesage_app` its rights on tables **that do not exist yet**,
which is why this file can run before any migration.

> If you ever find yourself "fixing" a permissions error by connecting the app as the owner, stop.
> That error is the security model working.

---

## Where the policies actually live

Not here. A policy cannot exist before its table, so they are installed by the Alembic migration
that creates the tables — `apps/api/alembic/versions/20260812_0001_complete_erd.py`.

For each tenant-owned table it runs:

```sql
ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;
ALTER TABLE <t> FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON <t> USING (<predicate>);
```

**`FORCE` is the line that matters.** `ENABLE` alone still exempts the table's owner. `FORCE`
applies the policy to the owner too.

The predicate is `workspace_id = app_current_workspace_id()` on the five tables that carry a
workspace directly, and an `EXISTS` join back up to `repository` on the deeper ones — `branch`,
`analysis_attempt`, `snapshot`, `source_file`, `finding` and the rest. A snapshot has no
`workspace_id` column of its own; its tenancy is inherited through the chain, and the policy says
so explicitly rather than trusting the application to remember.

`app_current_workspace_id()` reads a per-transaction setting bound by
`apps/api/src/codesage_api/db/rls.py`:

```python
session.execute(text("SELECT set_config('app.current_workspace_id', :wid, true)"), ...)
```

The `true` is "local to this transaction" — so the binding cannot leak into the next request that
borrows the same pooled connection.

### The one deliberate exception: `membership`

Migration `20260825_0002_membership_definer_lookup.py` runs:

```sql
ALTER TABLE membership NO FORCE ROW LEVEL SECURITY
```

There is a chicken-and-egg problem: to bind a workspace you must first find out which workspace
the signed-in user belongs to — and that answer is in `membership`, which is itself filtered by a
workspace that has not been bound yet. A narrow `SECURITY DEFINER` function,
`app_workspace_for_user(p_user_id)`, is the only thing allowed to see past that filter, and
`NO FORCE` is what lets it. Read the migration's own docstring before changing anything here.

`user_session` is deliberately not policy-protected either: it is the table that *tells us* which
workspace the caller belongs to, it holds no tenant data — only a pointer to a tenant — and its
rows are found by an unguessable random id.

---

## Getting into the database

Postgres is **not published to the host**, on purpose — an open database port is the easiest thing
to forget before a demo. Go in through the container:

```powershell
docker compose exec postgres psql -U codesage_owner codesage
```

Handy once you are in:

```sql
\dt                                          -- 27 tables after the migration
\du                                          -- both roles should be listed
SELECT relname, relrowsecurity, relforcerowsecurity
  FROM pg_class WHERE relrowsecurity;        -- RLS on, and FORCEd
SELECT tablename, policyname FROM pg_policies;
```

To point a GUI at it, use the opt-in override rather than editing the compose file:

```powershell
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres
# 127.0.0.1:5433 — this machine only
```

---

## Production

**This file never runs on Neon.** Neon gives you `neondb_owner`; the `codesage_app` role was
created there **by hand** during Phase 1 (team plan §6a, step 4a), and the grants were applied
manually. The two-role split is identical; only the bootstrap mechanism differs.

If the Neon database is ever recreated, that hand-work has to be repeated — it is not automated
anywhere. See [deployment log, Entry 4](../../docs/Project%20Management%20&%20Planning/deployment-implementation-log.md#entry-4--2021-aug-2026--phase-1-deploy--complete).

---

## Known gap

**Six Row-Level Security tests do not actually run.** They report as skipped, saying
*"Docker/PostgreSQL is unavailable"*; the real reason is `role "codesage_app" does not exist`,
because the test database never runs this file. The suite looks healthy while checking none of the
tenant isolation. CI passes `-rs` to pytest so the skips are at least visible.

The fix is in `apps/api/tests/conftest.py`. See
[deployment log, Entry 3](../../docs/Project%20Management%20&%20Planning/deployment-implementation-log.md#entry-3--20-aug-2026--j05-j06-and-j07-ci).
