-- Bootstrap for the Code Sage AI database.
--
-- ⚠️ THE POINT OF THIS FILE: create a NON-SUPERUSER, NON-OWNER application role.
--
-- PostgreSQL Row-Level Security is silently bypassed by superusers and by the
-- owner of the table. If the application connects as `postgres` or as the role
-- that created the tables, every policy is ignored, every cross-tenant query
-- succeeds, and the isolation required by SRS DBR-3 exists only on paper — while
-- appearing to work perfectly in development.
--
-- So there are two roles:
--   codesage_owner  runs migrations and owns the schema
--   codesage_app    what the API and workers connect as; subject to RLS
--
-- The policies themselves are created in the Alembic migration that creates the
-- tables, because a policy cannot exist before its table.

CREATE ROLE codesage_app WITH LOGIN PASSWORD 'devpassword' NOSUPERUSER NOCREATEDB NOCREATEROLE;

GRANT CONNECT ON DATABASE codesage TO codesage_app;
GRANT USAGE ON SCHEMA public TO codesage_app;

-- Table-level rights for tables that do not exist yet.
ALTER DEFAULT PRIVILEGES FOR ROLE codesage_owner IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO codesage_app;
ALTER DEFAULT PRIVILEGES FOR ROLE codesage_owner IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO codesage_app;

-- TEAM TODO: the RLS policies themselves are still owed (SAD §9). Each
-- tenant-owned table needs:
--
--   ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;
--   ALTER TABLE <t> FORCE ROW LEVEL SECURITY;
--   CREATE POLICY tenant_isolation ON <t>
--       USING (workspace_id = current_setting('app.workspace_id')::uuid);
--
-- FORCE matters: without it the policy still does not apply to the table owner.
-- The setting is bound per transaction by db/rls.py.
--
-- Write a test that asserts a cross-tenant SELECT returns zero rows. A policy
-- nobody tested is a policy nobody has.
