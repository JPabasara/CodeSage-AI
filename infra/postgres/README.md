# infra/postgres/

`init/01-init.sql` is mounted at `/docker-entrypoint-initdb.d` and runs **once, on an empty data
directory**. Editing it does nothing to a database that already exists:

```powershell
docker compose down -v      # -v deletes the volume and all your data
docker compose up -d postgres
```

## Why this file exists

It creates a second, non-owner role.

```sql
CREATE ROLE codesage_app WITH LOGIN PASSWORD 'devpassword'
    NOSUPERUSER NOCREATEDB NOCREATEROLE;
```

**PostgreSQL Row-Level Security is silently bypassed by superusers and by the owner of the table.**
If the application connected as `postgres`, or as the role that created the tables, every policy
would be ignored, every cross-tenant query would succeed — and it would all look perfect in
development. The isolation SRS DBR-3 requires would exist only on paper.

| Role | Can | Used by |
|---|---|---|
| `codesage_owner` | create and alter tables — owns the schema | Alembic, via `CODESAGE_MIGRATION_DATABASE_URL` |
| `codesage_app` | read and write rows only; **subject to RLS** | API and workers, via `CODESAGE_DATABASE_URL` |

`ALTER DEFAULT PRIVILEGES` grants `codesage_app` rights on tables **that do not exist yet**, which is
why this can run before any migration.

> If you ever "fix" a permissions error by connecting the app as the owner — stop. That error is the
> security model working.

## Where the policies actually live

Not here. A policy cannot exist before its table, so they are installed by the migration that creates
the tables (`alembic/versions/20260812_0001_complete_erd.py`):

```sql
ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;
ALTER TABLE <t> FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON <t> USING (<predicate>);
```

**`FORCE` is the line that matters** — `ENABLE` alone still exempts the table's owner.

The predicate is `workspace_id = app_current_workspace_id()` on the five tables that carry a
workspace directly, and an `EXISTS` join back up to `repository` on the deeper ones. A snapshot has
no `workspace_id` of its own; its tenancy is inherited through the chain, and the policy says so
rather than trusting the application to remember.

`app_current_workspace_id()` reads a per-transaction setting bound by `db/rls.py` with
`set_config(..., true)` — transaction-local, so it cannot leak into the next request that borrows the
same pooled connection.

### The one deliberate exception: `membership`

Migration `20260825_0002` runs `ALTER TABLE membership NO FORCE ROW LEVEL SECURITY`.

Chicken and egg: to bind a workspace you must first find which workspace the user belongs to, and
that answer is in `membership` — itself filtered by a workspace not yet bound. A narrow
`SECURITY DEFINER` function, `app_workspace_for_user()`, is the only thing allowed to see past that
filter, and `NO FORCE` is what lets it. Read the migration's docstring before changing anything here.

`user_session` is deliberately unpolicied too: it is the table that *tells us* which workspace the
caller belongs to, holds no tenant data, and its rows are found by an unguessable random id.

## Inspecting it

Postgres is not published to the host — go in through the container:

```powershell
docker compose exec postgres psql -U codesage_owner codesage
```

```sql
\dt                                          -- 27 tables after migration
SELECT relname, relrowsecurity, relforcerowsecurity
  FROM pg_class WHERE relrowsecurity;        -- RLS on, and FORCEd
SELECT tablename, policyname FROM pg_policies;
```

## Production

**This file never runs on Neon.** Neon gives you `neondb_owner`; `codesage_app` was created there
**by hand** during Phase 1, and the grants applied manually. The two-role split is identical; only
the bootstrap differs. If the Neon database is ever recreated, that hand-work must be repeated — it
is not automated anywhere.

## Tests

`tests/integration/test_rls.py` spins up a throwaway Postgres, runs the real migrations, and connects
as a non-owner role that is `GRANT`ed membership in `codesage_app` — so it inherits exactly what the
migration grants, rather than keeping a copy that drifts. **8 passing.** They spent a week silently
skipping because a broken migration chain made the fixture give up; see the deployment log.
